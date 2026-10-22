// Test cho mạng ORK giả lập (Plan C). Chứng minh bản mô phỏng THỰC THI luật chứ không chỉ hiển
// thị: sai paper, hết hạn, thiếu role, policy bị sửa — đều bị từ chối.
// Chạy: npm run test:sim
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** assert.throws không trả error, nên bắt tay để soi `cause` (lý do thật từ ORK). */
const caught = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('không ném lỗi'); };

// ork.js chỉ cần btoa/atob (có sẵn trong node:global từ v16) — không cần DOM.
const { orkDecrypt, orkEncrypt, readPolicy, signPolicy } = await import('./ork.js');

const AUTHOR = ['_tide_encryptor', '_tide_decryptor', 'ps-author'];
const READER_P1 = ['_tide_encryptor', '_tide_decryptor', 'ps-paper-p1-reader'];
const OPERATOR = ['ps-operator'];
const hour = 3600;
const now = () => Math.floor(Date.now() / 1000);

const bytes = new TextEncoder().encode('%PDF-1.4 bản thảo chưa công bố');

const docP1 = signPolicy({ subject: 'ps-author', recordId: 'doc:p1', access: 'read-write' });
const readerP1 = signPolicy({ subject: 'ps-paper-p1-reader', recordId: 'doc:p1', access: 'read', expiry: now() + 7 * 24 * hour });
const expiredP3 = signPolicy({ subject: 'ps-paper-p3-reader', recordId: 'doc:p3', access: 'read', expiry: now() - hour });

const cipherP1 = orkEncrypt(bytes, 'doc:p1', docP1, AUTHOR);

test('tác giả mã hóa, người được cấp quyền giải mã ra đúng byte (T4, T5)', () => {
  const out = orkDecrypt(cipherP1, 'doc:p1', readerP1, READER_P1);
  assert.deepEqual([...out], [...bytes]);
});

test('sai paper: policy p1 không mở được record p2 (mục 3.3)', () => {
  assert.throws(() => orkDecrypt(cipherP1, 'doc:p2', readerP1, READER_P1), /VVK ORKs/);
});

test('thiếu role đúng paper thì bị từ chối (T9)', () => {
  const readerOfOther = ['_tide_encryptor', '_tide_decryptor', 'ps-paper-p2-reader'];
  assert.throws(() => orkDecrypt(cipherP1, 'doc:p1', readerP1, readerOfOther), /VVK ORKs/);
});

test('Operator không có _tide_decryptor → không giải mã được dù cầm cả ciphertext lẫn policy (T9)', () => {
  const err = caught(() => orkDecrypt(cipherP1, 'doc:p1', readerP1, OPERATOR));
  assert.match(err.cause.message, /ps-paper-p1-reader|_tide_decryptor/);
});

test('hết hạn: role vẫn còn nhưng policy đã quá expiry → từ chối (mục 3.4)', () => {
  const cipherP3 = orkEncrypt(bytes, 'doc:p3', signPolicy({ subject: 'ps-author', recordId: 'doc:p3', access: 'read-write' }), AUTHOR);
  const reader = ['_tide_encryptor', '_tide_decryptor', 'ps-paper-p3-reader'];
  const err = caught(() => orkDecrypt(cipherP3, 'doc:p3', expiredP3, reader));
  assert.match(err.cause.message, /hạn trong policy/);
});

test('T16: gia hạn bằng cách sửa policy đã ký → chữ ký sai, ORK từ chối', () => {
  const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(expiredP3), (c) => c.charCodeAt(0))));
  p.expiry = now() + 7 * 24 * hour; // "gia hạn" nhưng không ký lại được
  const forged = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(p))));
  const err = caught(() => readPolicy(forged));
  assert.match(err.cause.message, /chữ ký ngưỡng/);
});

test('hộp thư: policy write cho reader thì không dùng để đọc được (D3)', () => {
  const fbWrite = signPolicy({ subject: 'ps-paper-p1-reader', recordId: 'fb:p1', access: 'write', expiry: now() + hour });
  const note = orkEncrypt('nhận xét', 'fb:p1', fbWrite, READER_P1);
  assert.throws(() => orkDecrypt(note, 'fb:p1', fbWrite, READER_P1), /VVK ORKs/);

  const fbRead = signPolicy({ subject: 'ps-author', recordId: 'fb:p1', access: 'read' });
  assert.equal(new TextDecoder().decode(orkDecrypt(note, 'fb:p1', fbRead, AUTHOR)), 'nhận xét');
});
