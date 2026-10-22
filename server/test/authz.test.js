// T14 [MOCK]: quyền chỉ đến từ role trong JWT. Role sai :id → 403; sửa DB không cấp được quyền.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, identity, json, authorRoles } from './helpers.mjs';

const author = await identity({ realmRoles: authorRoles, username: 'owner' });
const reviewer = await identity({
  realmRoles: ['_tide_encryptor', '_tide_decryptor', 'ps-paper-p1-reader'],
  username: 'reviewer',
});
const operator = await identity({ realmRoles: ['ps-operator'], approver: true, username: 'operator' });
const approver2 = await identity({ approver: true, username: 'approver2' });
const stranger = await identity({ username: 'stranger' });

const CIPHERTEXT = 'VGhpcyBpcyBub3QgYSBQREYsIGl0IGlzIGNpcGhlcnRleHQ=';
const put = (body) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/octet-stream' },
  body,
});

test('GET /api/papers: tác giả thấy 3 paper, người phản biện chỉ thấy p1, người lạ thấy 0', async () => {
  for (const [who, expected] of [
    [author, ['p1', 'p2', 'p3']],
    [reviewer, ['p1']],
    [stranger, []],
  ]) {
    const res = await who.fetch('/api/papers');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).papers.map((p) => p.id), expected);
  }
});

test('PUT blob: chỉ ps-author', async () => {
  for (const id of ['p1', 'p2']) {
    const res = await author.fetch(`/api/papers/${id}/blob`, put(CIPHERTEXT));
    assert.equal(res.status, 200);
  }
  assert.equal((await reviewer.fetch('/api/papers/p1/blob', put(CIPHERTEXT))).status, 403);
  assert.equal((await operator.fetch('/api/papers/p1/blob', put(CIPHERTEXT))).status, 403);
});

test('PUT blob > 15 MB → 413', async () => {
  const res = await author.fetch('/api/papers/p1/blob', put(Buffer.alloc(16 * 1024 * 1024)));
  assert.equal(res.status, 413);
});

test('GET blob: role phải khớp đúng :id (IDOR)', async () => {
  assert.equal((await reviewer.fetch('/api/papers/p1/blob')).status, 200);
  assert.equal((await reviewer.fetch('/api/papers/p2/blob')).status, 403);
  assert.equal((await stranger.fetch('/api/papers/p1/blob')).status, 403);
  assert.equal((await operator.fetch('/api/papers/p1/blob')).status, 403);
  assert.equal((await author.fetch('/api/papers/p3/blob')).status, 404); // chưa upload
  assert.equal((await author.fetch('/api/papers/p9/blob')).status, 404); // không có paper
});

test('sửa DB để tự cấp quyền không có hiệu lực', async () => {
  db.prepare(
    `insert into policies (paper_id, record, subject_kind, subject, policy, created_at, created_by)
     values ('p2', 'doc', 'Role', 'ps-paper-p2-reader', 'forged', '2026-10-22', 'operator')`,
  ).run();
  db.prepare(
    `insert into invites (paper_id, reviewer, status, created_at)
     values ('p2', 'operator', 'approved', '2026-10-22')`,
  ).run();
  assert.equal((await operator.fetch('/api/papers/p2/blob')).status, 403);
  assert.equal((await operator.fetch('/api/papers/p2/policy?for=doc')).status, 403);
  assert.deepEqual((await (await operator.fetch('/api/papers')).json()).papers, []);
});

test('POST policies: chỉ approver (tide-realm-admin)', async () => {
  const p = (record, kind, subject) =>
    json({ record, subject_kind: kind, subject, policy: 'c2lnbmVkLXBvbGljeQ==' });
  assert.equal((await author.fetch('/api/papers/p1/policies', p('doc', 'User', author.tideuserkey))).status, 403);
  assert.equal((await reviewer.fetch('/api/papers/p1/policies', p('doc', 'User', reviewer.tideuserkey))).status, 403);
  for (const [record, kind, subject] of [
    ['doc', 'User', author.tideuserkey],
    ['doc', 'Role', 'ps-paper-p1-reader'],
    ['fb', 'User', author.tideuserkey],
    ['fb', 'Role', 'ps-paper-p1-reader'],
  ]) {
    const res = await approver2.fetch(`/api/papers/p1/policies`, p(record, kind, subject));
    assert.equal(res.status, 201);
  }
});

test('GET policy: chỉ trả policy có subject khớp người gọi', async () => {
  const authorDoc = await (await author.fetch('/api/papers/p1/policy?for=doc')).json();
  assert.deepEqual(authorDoc.policies.map((p) => p.subject), [author.tideuserkey]);

  const reviewerDoc = await (await reviewer.fetch('/api/papers/p1/policy?for=doc')).json();
  assert.deepEqual(reviewerDoc.policies.map((p) => p.subject), ['ps-paper-p1-reader']);

  const reviewerFb = await (await reviewer.fetch('/api/papers/p1/policy?for=fb')).json();
  assert.deepEqual(reviewerFb.policies.map((p) => p.subject), ['ps-paper-p1-reader']);

  assert.equal((await stranger.fetch('/api/papers/p1/policy?for=doc')).status, 403);
  assert.equal((await author.fetch('/api/papers/p1/policy?for=nope')).status, 400);
});

test('nhận xét (D3): người phản biện gửi được, chỉ nhóm tác giả đọc', async () => {
  const body = json({ ciphertext: 'ZmVlZGJhY2stY2lwaGVydGV4dA==' });
  assert.equal((await reviewer.fetch('/api/papers/p1/feedback', body)).status, 201);
  assert.equal((await author.fetch('/api/papers/p1/feedback', body)).status, 403);
  assert.equal((await operator.fetch('/api/papers/p1/feedback', body)).status, 403);

  assert.equal((await reviewer.fetch('/api/papers/p1/feedback')).status, 403);
  const read = await author.fetch('/api/papers/p1/feedback');
  assert.equal(read.status, 200);
  assert.deepEqual(
    (await read.json()).feedback.map((f) => f.ciphertext),
    ['ZmVlZGJhY2stY2lwaGVydGV4dA=='],
  );
});

test('invites: tác giả tạo, approver gắn change request', async () => {
  assert.equal((await reviewer.fetch('/api/papers/p1/invites', json({ reviewer: 'reviewer' }))).status, 403);
  const created = await author.fetch('/api/papers/p1/invites', json({ reviewer: 'reviewer' }));
  assert.equal(created.status, 201);
  const { id, status } = await created.json();
  assert.equal(status, 'requested');

  const patch = (who) =>
    who.fetch(`/api/invites/${id}`, { ...json({ change_request_id: 'cr-123' }), method: 'PATCH' });
  assert.equal((await patch(author)).status, 403);
  const ok = await patch(approver2);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).change_request_id, 'cr-123');
});

test('operator console: storage là ciphertext, không phải PDF', async () => {
  assert.equal((await author.fetch('/api/operator/storage')).status, 403);
  const res = await operator.fetch('/api/operator/storage');
  assert.equal(res.status, 200);
  const { files } = await res.json();
  assert.ok(files.length >= 2);
  assert.ok(files.every((f) => f.is_pdf === false));

  // Cố ý: Operator tải được ciphertext của paper bất kỳ — và vẫn không giải mã được.
  const blob = await operator.fetch('/api/operator/blob/p2');
  assert.equal(blob.status, 200);
  assert.equal(await blob.text(), CIPHERTEXT);
  assert.equal((await reviewer.fetch('/api/operator/blob/p2')).status, 403);
});

test('operator đọc được policy trong DB (T9 cần cả ciphertext lẫn policy để đi tới ORK)', async () => {
  assert.equal((await author.fetch('/api/operator/policy/p2')).status, 403);
  const res = await operator.fetch('/api/operator/policy/p2');
  assert.equal(res.status, 200);
  const { policies } = await res.json();
  assert.ok(Array.isArray(policies) && policies.length >= 1);
});
