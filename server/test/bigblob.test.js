// Payload cỡ thật qua backend [MOCK]. Test cũ chỉ dùng ciphertext vài chục byte, nên lớp
// ghi/đọc file và giới hạn 15 MB chưa bao giờ chạy với dữ liệu thật.
//
// Lý do có file này: 2026-10-22 đã bắt được lỗi P0 ở frontend chỉ xuất hiện với PDF ~1,7 MB
// (RangeError khi base64). Backend chưa có test tương đương — bịt nốt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { identity, authorRoles } from './helpers.mjs';

const author = await identity({ realmRoles: authorRoles, username: 'owner' });
const reader = await identity({
  realmRoles: ['_tide_encryptor', '_tide_decryptor', 'ps-paper-p1-reader'],
  username: 'reviewer',
});

const put = (body) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/octet-stream' },
  body,
});

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Ciphertext cỡ thật: PDF ~1,7 MB mã hóa rồi base64 là ~3 MB (đo được). */
const bigCiphertext = Buffer.from(
  Buffer.alloc(3 * 1024 * 1024).map((_, i) => 65 + ((i * 7) % 26)),
).toString('latin1');

test('PUT/GET blob ~3 MB: byte ra đúng byte vào (T5)', async () => {
  const body = Buffer.from(bigCiphertext, 'latin1');
  const saved = await author.fetch('/api/papers/p1/blob', put(body));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).blob_size, body.length);

  const res = await reader.fetch('/api/papers/p1/blob');
  assert.equal(res.status, 200);
  const out = Buffer.from(await res.arrayBuffer());
  assert.equal(out.length, body.length, 'không bị cắt ngắn');
  assert.equal(sha(out), sha(body), 'hash khớp — không hỏng byte nào');
});

test('đúng ngưỡng 15 MB: 15 MB qua được, 16 MB bị 413', async () => {
  assert.equal(
    (await author.fetch('/api/papers/p2/blob', put(Buffer.alloc(15 * 1024 * 1024)))).status,
    200,
    'đúng 15 MB vẫn phải nhận',
  );
  assert.equal(
    (await author.fetch('/api/papers/p2/blob', put(Buffer.alloc(16 * 1024 * 1024)))).status,
    413,
  );
});

test('tải lên lần hai thì ghi đè, blob_size cập nhật đúng', async () => {
  const nho = Buffer.from('ciphertext-ngan');
  await author.fetch('/api/papers/p1/blob', put(nho));

  const res = await reader.fetch('/api/papers/p1/blob');
  const out = Buffer.from(await res.arrayBuffer());
  assert.equal(sha(out), sha(nho), 'phải là bản mới, không còn sót bản 3 MB');

  const [paper] = (await (await author.fetch('/api/papers')).json()).papers.filter((p) => p.id === 'p1');
  assert.equal(paper.blob_size, nho.length);
});
