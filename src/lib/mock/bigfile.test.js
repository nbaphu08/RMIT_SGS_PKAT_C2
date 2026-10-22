// Hồi quy cho lỗi P0 đo được 2026-10-22: mã hóa PDF thật (~1,7 MB) ném RangeError
// "Maximum call stack size exceeded" vì `String.fromCharCode(...bytes)` spread cả triệu đối số.
// Lỗi này có ở CẢ hai đường (src/lib/relationship.js và mock/ork.js) và chặn ngay bước đầu demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const { orkDecrypt, orkEncrypt, signPolicy } = await import('./ork.js');

const AUTHOR = ['_tide_encryptor', '_tide_decryptor', 'ps-author'];
const policy = signPolicy({ subject: 'ps-author', recordId: 'doc:p1', access: 'read-write' });

test('PDF ~2 MB mã hóa rồi giải mã ra đúng từng byte (T5)', () => {
  // Không phụ thuộc samples/ (gitignored): tự dựng mảng 2 MB có pattern để so byte.
  const big = new Uint8Array(2 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 256;

  const cipher = orkEncrypt(big, 'doc:p1', policy, AUTHOR);
  const out = orkDecrypt(cipher, 'doc:p1', policy, AUTHOR);

  assert.equal(out.length, big.length);
  assert.ok(out.every((b, i) => b === big[i]), 'byte phải khớp hoàn toàn');
});

test('PDF mẫu thật chạy được, nếu đã sinh bằng scripts/make-sample-papers.mjs', (t) => {
  if (!existsSync('samples/p1.pdf')) return t.skip('chưa có samples/p1.pdf');
  const bytes = new Uint8Array(readFileSync('samples/p1.pdf'));
  const out = orkDecrypt(orkEncrypt(bytes, 'doc:p1', policy, AUTHOR), 'doc:p1', policy, AUTHOR);
  assert.deepEqual(Buffer.from(out).subarray(0, 8), Buffer.from(bytes).subarray(0, 8));
  assert.equal(out.length, bytes.length);
});
