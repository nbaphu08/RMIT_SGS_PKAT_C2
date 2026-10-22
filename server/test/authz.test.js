// T14 [MOCK]: quyền chỉ đến từ role trong JWT. Role sai :id → 403; sửa DB không cấp được quyền.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, identity, json, ownerRoles } from './helpers.mjs';

const owner = await identity({ realmRoles: ownerRoles, username: 'owner' });
const reviewer = await identity({
  realmRoles: ['_tide_encryptor', '_tide_decryptor', 'us-trk-t1-reviewer'],
  username: 'reviewer',
});
const operator = await identity({ realmRoles: ['us-operator'], approver: true, username: 'operator' });
const approver2 = await identity({ approver: true, username: 'approver2' });
const stranger = await identity({ username: 'stranger' });

const CIPHERTEXT = 'VGhpcyBpcyBub3QgYSBXQVYsIGl0IGlzIGNpcGhlcnRleHQ=';
const put = (id, body) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/octet-stream' },
  body,
});

test('GET /api/tracks: owner thấy 3 track, reviewer chỉ thấy t1, người lạ thấy 0', async () => {
  for (const [who, expected] of [
    [owner, ['t1', 't2', 't3']],
    [reviewer, ['t1']],
    [stranger, []],
  ]) {
    const res = await who.fetch('/api/tracks');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).tracks.map((t) => t.id), expected);
  }
});

test('PUT blob: chỉ us-owner', async () => {
  for (const id of ['t1', 't2']) {
    const res = await owner.fetch(`/api/tracks/${id}/blob`, put(id, CIPHERTEXT));
    assert.equal(res.status, 200);
  }
  assert.equal((await reviewer.fetch('/api/tracks/t1/blob', put('t1', CIPHERTEXT))).status, 403);
  assert.equal((await operator.fetch('/api/tracks/t1/blob', put('t1', CIPHERTEXT))).status, 403);
});

test('PUT blob > 15 MB → 413', async () => {
  const res = await owner.fetch('/api/tracks/t1/blob', put('t1', Buffer.alloc(16 * 1024 * 1024)));
  assert.equal(res.status, 413);
});

test('GET blob: role phải khớp đúng :id (IDOR)', async () => {
  assert.equal((await reviewer.fetch('/api/tracks/t1/blob')).status, 200);
  assert.equal((await reviewer.fetch('/api/tracks/t2/blob')).status, 403);
  assert.equal((await stranger.fetch('/api/tracks/t1/blob')).status, 403);
  assert.equal((await operator.fetch('/api/tracks/t1/blob')).status, 403);
  assert.equal((await owner.fetch('/api/tracks/t3/blob')).status, 404); // chưa upload
});

test('sửa DB để tự cấp quyền không có hiệu lực', async () => {
  db.prepare(
    `insert into policies (track_id, record, subject_kind, subject, policy, created_at, created_by)
     values ('t2', 'trk', 'Role', 'us-trk-t2-reviewer', 'forged', '2026-10-22', 'operator')`,
  ).run();
  db.prepare(
    `insert into share_requests (track_id, reviewer, status, created_at)
     values ('t2', 'operator', 'approved', '2026-10-22')`,
  ).run();
  assert.equal((await operator.fetch('/api/tracks/t2/blob')).status, 403);
  assert.equal((await operator.fetch('/api/tracks/t2/policy?for=trk')).status, 403);
  assert.deepEqual((await (await operator.fetch('/api/tracks')).json()).tracks, []);
});

test('POST policies: chỉ approver (tide-realm-admin)', async () => {
  const p = (record, kind, subject) =>
    json({ record, subject_kind: kind, subject, policy: 'c2lnbmVkLXBvbGljeQ==' });
  assert.equal((await owner.fetch('/api/tracks/t1/policies', p('trk', 'User', owner.tideuserkey))).status, 403);
  assert.equal((await reviewer.fetch('/api/tracks/t1/policies', p('trk', 'User', reviewer.tideuserkey))).status, 403);
  for (const [record, kind, subject] of [
    ['trk', 'User', owner.tideuserkey],
    ['trk', 'Role', 'us-trk-t1-reviewer'],
    ['fb', 'User', owner.tideuserkey],
    ['fb', 'Role', 'us-trk-t1-reviewer'],
  ]) {
    const res = await approver2.fetch(`/api/tracks/t1/policies`, p(record, kind, subject));
    assert.equal(res.status, 201);
  }
});

test('GET policy: chỉ trả policy có subject khớp người gọi', async () => {
  const ownerTrk = await (await owner.fetch('/api/tracks/t1/policy?for=trk')).json();
  assert.deepEqual(ownerTrk.policies.map((p) => p.subject), [owner.tideuserkey]);

  const reviewerTrk = await (await reviewer.fetch('/api/tracks/t1/policy?for=trk')).json();
  assert.deepEqual(reviewerTrk.policies.map((p) => p.subject), ['us-trk-t1-reviewer']);

  const reviewerFb = await (await reviewer.fetch('/api/tracks/t1/policy?for=fb')).json();
  assert.deepEqual(reviewerFb.policies.map((p) => p.subject), ['us-trk-t1-reviewer']);

  assert.equal((await stranger.fetch('/api/tracks/t1/policy?for=trk')).status, 403);
  assert.equal((await owner.fetch('/api/tracks/t1/policy?for=nope')).status, 400);
});

test('feedback F-a: reviewer gửi được, chỉ owner đọc', async () => {
  const body = json({ ciphertext: 'ZmVlZGJhY2stY2lwaGVydGV4dA==' });
  assert.equal((await reviewer.fetch('/api/tracks/t1/feedback', body)).status, 201);
  assert.equal((await owner.fetch('/api/tracks/t1/feedback', body)).status, 403);
  assert.equal((await operator.fetch('/api/tracks/t1/feedback', body)).status, 403);

  assert.equal((await reviewer.fetch('/api/tracks/t1/feedback')).status, 403);
  const read = await owner.fetch('/api/tracks/t1/feedback');
  assert.equal(read.status, 200);
  assert.deepEqual(
    (await read.json()).feedback.map((f) => f.ciphertext),
    ['ZmVlZGJhY2stY2lwaGVydGV4dA=='],
  );
});

test('shares: owner tạo, approver gắn change request', async () => {
  assert.equal((await reviewer.fetch('/api/tracks/t1/shares', json({ reviewer: 'reviewer' }))).status, 403);
  const created = await owner.fetch('/api/tracks/t1/shares', json({ reviewer: 'reviewer' }));
  assert.equal(created.status, 201);
  const { id, status } = await created.json();
  assert.equal(status, 'requested');

  const patch = (who) =>
    who.fetch(`/api/shares/${id}`, { ...json({ change_request_id: 'cr-123' }), method: 'PATCH' });
  assert.equal((await patch(owner)).status, 403);
  const ok = await patch(approver2);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).change_request_id, 'cr-123');
});

test('operator console: thấy storage là ciphertext, không phải WAV', async () => {
  assert.equal((await owner.fetch('/api/operator/storage')).status, 403);
  const res = await operator.fetch('/api/operator/storage');
  assert.equal(res.status, 200);
  const { files } = await res.json();
  assert.ok(files.length >= 2);
  assert.ok(files.every((f) => f.is_wav === false));

  // Cố ý: Operator tải được ciphertext bất kỳ track — và vẫn không giải mã được.
  const blob = await operator.fetch('/api/operator/blob/t2');
  assert.equal(blob.status, 200);
  assert.equal(await blob.text(), CIPHERTEXT);
  assert.equal((await reviewer.fetch('/api/operator/blob/t2')).status, 403);
});
