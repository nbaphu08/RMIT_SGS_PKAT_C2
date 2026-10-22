// Chạy trọn luồng demo (plan mục 4) qua đúng các hàm mà App.jsx gọi: ký policy → mã hóa → tải
// lên → mời → 2/3 duyệt → refresh token → giải mã → nhận xét → Operator thử phá.
//
// Mục đích: bắt lỗi "ráp vào nhau thì hỏng" mà test từng lớp không thấy. Không thay cho việc bấm
// tay trên trình duyệt (nút bị khoá, bố cục hỏng... thì chỉ mắt người mới thấy).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
let session = null;
globalThis.sessionStorage = {
  getItem: () => session,
  setItem: (_k, v) => { session = v; },
  removeItem: () => { session = null; },
};
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
globalThis.Event = class {};

const realm = await import('./realm.js');
const { resetDb } = await import('./db.js');
const { api, policyFor } = await import('../api.preview.js');
const rel = await import('../relationship.preview.js');

const as = (username) => realm.mintToken(username);
const PDF = new TextEncoder().encode('%PDF-1.4 bản thảo chưa công bố\n%%EOF');

/** Đúng 9 policy của plan mục 3.2 — cùng bảng GRANTS mà tab Policy Signing dùng. */
const GRANTS = [
  { name: 'A-doc-p1', paper: 'p1', record: 'doc', subject: 'ps-author', access: 'read-write' },
  { name: 'A-doc-p2', paper: 'p2', record: 'doc', subject: 'ps-author', access: 'read-write' },
  { name: 'A-doc-p3', paper: 'p3', record: 'doc', subject: 'ps-author', access: 'read-write' },
  { name: 'A-fb-p1', paper: 'p1', record: 'fb', subject: 'ps-author', access: 'read' },
  { name: 'A-fb-p3', paper: 'p3', record: 'fb', subject: 'ps-author', access: 'read' },
  { name: 'R-doc-p1', paper: 'p1', record: 'doc', subject: 'ps-paper-p1-reader', access: 'read', expires: 7 },
  { name: 'R-fb-p1', paper: 'p1', record: 'fb', subject: 'ps-paper-p1-reader', access: 'write', expires: 7 },
  { name: 'R-doc-p3', paper: 'p3', record: 'doc', subject: 'ps-paper-p3-reader', access: 'read', expires: -1 },
  { name: 'R-fb-p3', paper: 'p3', record: 'fb', subject: 'ps-paper-p3-reader', access: 'write', expires: -1 },
];

async function signAll() {
  for (const g of GRANTS) {
    const policy = await rel.signRelationshipPolicy({
      vendorId: 'sim',
      subject: { type: 'Role', id: g.subject },
      recordId: `${g.record}:${g.paper}`,
      access: g.access,
      ...(g.expires ? { expiry: Math.floor(Date.now() / 1000) + g.expires * 86_400 } : {}),
    });
    await api.savePolicy(g.paper, { record: g.record, subject_kind: 'Role', subject: g.subject, policy });
  }
}

test('luồng demo chạy trọn từ đầu đến cuối', async () => {
  realm.resetRealm();
  resetDb();

  // --- Chuẩn bị: một tác giả ký 9 policy rồi mã hóa, tải 3 paper lên ---
  as('owner');
  await signAll();
  assert.equal((await api.policies('p1', 'doc')).length, 1, 'tác giả thấy policy A-doc-p1');

  for (const id of ['p1', 'p2', 'p3']) {
    const policy = await policyFor(id, 'doc');
    await api.putBlob(id, await rel.encryptForRecord(PDF, `doc:${id}`, policy));
  }
  assert.ok((await api.papers()).every((p) => p.blob_size > 0), 'cả 3 paper đã mã hóa');

  // --- Cảnh 1–2: mời phản biện, cần 2/3 duyệt ---
  const cr = realm.createRoleRequest('owner', 'reviewer', 'ps-paper-p1-reader');
  as('reviewer');
  await assert.rejects(() => api.getBlob('p1'), /403/, 'mới 1/2 phiếu thì chưa đọc được');

  realm.approveRequest('approver2', cr.id);

  // --- Cảnh 3: refresh token rồi đọc p1 ---
  as('reviewer');
  const policyDoc = await policyFor('p1', 'doc');
  const pdf = await rel.decryptBytesForRecord(await api.getBlob('p1'), 'doc:p1', policyDoc);
  assert.deepEqual([...pdf], [...PDF], 'ra đúng từng byte của PDF gốc');

  // --- Cảnh 3b: gửi nhận xét mã hóa; chỉ tác giả đọc được ---
  const policyFb = await policyFor('p1', 'fb');
  await api.postFeedback('p1', await rel.encryptForRecord('xin xem lại mục 3', 'fb:p1', policyFb));
  await assert.rejects(() => api.feedback('p1'), /403/, 'người phản biện không đọc hộp thư');

  as('owner');
  const [note] = await api.feedback('p1');
  assert.equal(
    await rel.decryptForRecord(note.ciphertext, 'fb:p1', await policyFor('p1', 'fb')),
    'xin xem lại mục 3',
  );

  // --- Cảnh 4: chỉ đúng paper, đúng hạn ---
  as('reviewer');
  await assert.rejects(() => api.getBlob('p2'), /403/, 'p2 không chia sẻ');
  await assert.rejects(() => api.getBlob('p3'), /403/, 'p3 đã hết hạn ở backend');

  // --- Cảnh 5: Operator thử mọi cách ---
  as('operator');
  const files = (await api.operatorStorage()).files;
  assert.ok(files.length >= 3 && files.every((f) => !f.is_pdf), 'trên đĩa không có %PDF');

  const [p2policy] = await api.operatorPolicies('p2');
  const p2cipher = await api.operatorBlob('p2');
  await assert.rejects(
    () => rel.decryptBytesForRecord(p2cipher, 'doc:p2', p2policy.policy),
    /VVK ORKs/,
    'cầm cả ciphertext lẫn policy vẫn bị ORK từ chối (T9)',
  );

  // T16: "gia hạn" p3 trong DB — backend mở ra, nhưng ORK vẫn chặn.
  await api.operatorSetReviewUntil('p3', new Date(Date.now() + 7 * 86_400_000).toISOString());
  as('reviewer');
  const p3cipher = await api.getBlob('p3');
  assert.ok(p3cipher, 'backend thôi chặn sau khi Operator sửa DB');
  const p3policy = await policyFor('p3', 'doc');
  await assert.rejects(
    () => rel.decryptBytesForRecord(p3cipher, 'doc:p3', p3policy),
    /VVK ORKs/,
    'hạn nằm trong policy đã ký — sửa DB không gia hạn được (T16)',
  );

  // --- Cảnh 7: thu hồi chặn về sau ---
  const revoke = realm.createRevokeRequest('owner', 'reviewer', 'ps-paper-p1-reader');
  realm.approveRequest('approver3', revoke.id);
  as('reviewer');
  await assert.rejects(() => api.getBlob('p1'), /403/, 'token mới thì hết quyền đọc p1');
});
