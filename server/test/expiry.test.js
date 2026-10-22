// Hạn phản biện ở backend (mục 3.4) + T16 [MOCK]: Operator sửa DB thì backend trả ciphertext,
// nhưng hạn thật nằm trong policy đã ký — chỉ ORK mới chứng minh được (đo ở M-D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, identity, json, authorRoles } from './helpers.mjs';

const author = await identity({ realmRoles: authorRoles, username: 'owner' });
const p3Reader = await identity({
  realmRoles: ['_tide_encryptor', '_tide_decryptor', 'ps-paper-p3-reader'],
  username: 'reviewer',
});
const operator = await identity({ realmRoles: ['ps-operator'], username: 'operator' });

const CIPHERTEXT = 'cDMtY2lwaGVydGV4dA==';
await author.fetch('/api/papers/p3/blob', {
  method: 'PUT',
  headers: { 'content-type': 'application/octet-stream' },
  body: CIPHERTEXT,
});

test('p3 đã quá review_until → reader 403, tác giả vẫn đọc được', async () => {
  const res = await p3Reader.fetch('/api/papers/p3/blob');
  assert.equal(res.status, 403);
  assert.match((await res.json()).reason, /review window/);
  assert.equal((await p3Reader.fetch('/api/papers/p3/policy?for=doc')).status, 403);
  assert.equal(
    (await p3Reader.fetch('/api/papers/p3/feedback', json({ ciphertext: 'eA==' }))).status,
    403,
  );
  assert.equal((await author.fetch('/api/papers/p3/blob')).status, 200);
});

test('paper chưa chia sẻ (review_until null) → reader của paper khác 403', async () => {
  assert.equal((await p3Reader.fetch('/api/papers/p2/blob')).status, 403);
});

test('T16: Operator gia hạn p3 trong DB → backend mở lại, hạn trong policy thì không', async () => {
  const until = new Date(Date.now() + 86_400_000).toISOString();
  const patch = await operator.fetch('/api/papers/p3/review-until', {
    ...json({ review_until: until }),
    method: 'PATCH',
  });
  assert.equal(patch.status, 404, 'route operator nằm dưới /api/operator');

  const ok = await operator.fetch('/api/operator/papers/p3/review-until', {
    ...json({ review_until: until }),
    method: 'PATCH',
  });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare(`select review_until from papers where id = 'p3'`).get().review_until, until);

  // Lớp backend bị Operator mua đứt: ciphertext ra được. Lớp ORK thì không (ghi ở README).
  assert.equal((await p3Reader.fetch('/api/papers/p3/blob')).status, 200);

  // Nhưng sửa DB vẫn không tạo ra quyền: không có role thì vẫn 403.
  assert.equal((await operator.fetch('/api/papers/p3/blob')).status, 403);
  assert.equal(
    (await operator.fetch('/api/operator/papers/p3/review-until', { ...json({ review_until: 'nope' }), method: 'PATCH' })).status,
    400,
  );
});
