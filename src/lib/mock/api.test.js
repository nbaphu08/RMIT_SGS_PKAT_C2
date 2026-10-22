// Test backend mô phỏng (src/lib/api.preview.js) — lớp quyết định 401/403/404 mà demo gọi nhiều
// nhất. Đối chiếu với server/test/authz.test.js của backend thật: cùng luật (shared/authz.js),
// nên hai bên phải cho cùng kết quả.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Trình duyệt giả tối thiểu. Không có indexedDB → db.js tự rơi về bộ nhớ (xem noIdb()).
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
const { api, ApiError } = await import('../api.preview.js');

/** Đăng nhập = cấp token cho "tab" hiện tại (chụp role lúc này), như currentToken() đọc. */
const as = (username) => realm.mintToken(username);
const status = async (fn) => {
  try {
    await fn();
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : `throw: ${e.message}`;
  }
};

const CIPHERTEXT = 'preview-ciphertext';

beforeEach(() => {
  realm.resetRealm();
  resetDb();
  session = null;
});

test('chưa đăng nhập → 401 (như requireAuth của backend thật)', async () => {
  assert.equal(await status(() => api.papers()), 401);
  assert.equal(await status(() => api.getBlob('p1')), 401);
});

test('tác giả thấy cả 3 paper; người phản biện chỉ thấy paper có role', async () => {
  as('owner');
  assert.deepEqual((await api.papers()).map((p) => p.id), ['p1', 'p2', 'p3']);

  as('reviewer'); // pivot.sh cấp sẵn p3-reader, chưa có p1
  assert.deepEqual((await api.papers()).map((p) => p.id), ['p3']);

  as('operator'); // Operator không có role đọc paper nào
  assert.deepEqual(await api.papers(), []);
});

test('chỉ ps-author tải ciphertext lên được', async () => {
  as('reviewer');
  assert.equal(await status(() => api.putBlob('p1', CIPHERTEXT)), 403);
  as('operator');
  assert.equal(await status(() => api.putBlob('p1', CIPHERTEXT)), 403);
  as('owner');
  assert.equal((await api.putBlob('p1', CIPHERTEXT)).blob_size, CIPHERTEXT.length);
});

test('IDOR: role phải khớp ĐÚNG :id (mục 3.3)', async () => {
  as('owner');
  await api.putBlob('p1', CIPHERTEXT);
  await api.putBlob('p2', CIPHERTEXT);

  as('reviewer');
  assert.equal(await status(() => api.getBlob('p1')), 403, 'chưa được duyệt thì chưa đọc được p1');
  assert.equal(await status(() => api.getBlob('p2')), 403, 'p2 không chia sẻ cho ai');
});

test('p3 đã hết hạn: có role vẫn 403; tác giả thì vẫn đọc được (mục 3.4)', async () => {
  as('owner');
  await api.putBlob('p3', CIPHERTEXT);

  as('reviewer'); // có ps-paper-p3-reader nhưng review_until đã qua
  assert.ok(realm.rolesOf('reviewer').includes('ps-paper-p3-reader'));
  assert.equal(await status(() => api.getBlob('p3')), 403);

  as('owner');
  assert.equal(await api.getBlob('p3'), CIPHERTEXT);
});

test('luồng đầy đủ: mời → 2/3 duyệt → Refresh token → đọc được p1 (plan mục 4)', async () => {
  as('owner');
  await api.putBlob('p1', CIPHERTEXT);
  const cr = realm.createRoleRequest('owner', 'reviewer', 'ps-paper-p1-reader');

  const reviewerToken = as('reviewer');
  assert.equal(await status(() => api.getBlob('p1')), 403, '1/2 phiếu thì vẫn chặn (T13)');

  realm.approveRequest('approver2', cr.id);

  // Role đã được gán trong realm, NHƯNG token cũ chưa có nó — vẫn 403, đúng như JWT thật.
  assert.ok(realm.rolesOf('reviewer').includes('ps-paper-p1-reader'));
  assert.ok(realm.tokenIsStale(reviewerToken), 'app phải nhắc bấm Refresh token');
  assert.equal(await status(() => api.getBlob('p1')), 403, 'token cũ thì chưa đọc được');

  as('reviewer'); // = bấm Refresh token
  assert.equal(await api.getBlob('p1'), CIPHERTEXT, 'token mới thì đọc được');
});

test('T14: Operator sửa DB không tự cấp quyền cho mình', async () => {
  as('owner');
  await api.putBlob('p2', CIPHERTEXT);

  as('operator');
  // Operator mở hạn cho p2 trong DB — quyền đọc vẫn đến từ role trong token, không từ DB.
  await api.operatorSetReviewUntil('p2', new Date(Date.now() + 86_400_000).toISOString());
  assert.equal(await status(() => api.getBlob('p2')), 403);
  assert.deepEqual(await api.papers(), [], 'sửa DB không làm p2 hiện ra');

  // Nhưng Operator VẪN lấy được ciphertext qua đường hạ tầng — cố ý, và vô dụng vì ORK chặn (T9).
  assert.equal(await api.operatorBlob('p2'), CIPHERTEXT);
});

test('nhận xét: người phản biện gửi được, chỉ tác giả đọc (D3)', async () => {
  as('owner');
  await api.putBlob('p1', CIPHERTEXT);
  const cr = realm.createRoleRequest('owner', 'reviewer', 'ps-paper-p1-reader');
  realm.approveRequest('approver3', cr.id);

  as('reviewer'); // token cấp sau khi CR đã APPLIED nên đã có role đọc p1
  await api.postFeedback('p1', 'nhan-xet-ma-hoa');
  assert.equal(await status(() => api.feedback('p1')), 403, 'người phản biện không đọc hộp thư');

  as('owner');
  assert.equal((await api.feedback('p1'))[0].ciphertext, 'nhan-xet-ma-hoa');

  as('operator');
  assert.equal(await status(() => api.feedback('p1')), 403);
});

test('route Operator chỉ ps-operator gọi được', async () => {
  as('owner');
  assert.equal(await status(() => api.operatorStorage()), 403);
  assert.equal(await status(() => api.operatorSetReviewUntil('p3', new Date().toISOString())), 403);
  as('operator');
  assert.equal((await api.operatorStorage()).files.length, 0);
});

test('ký policy: chỉ tide-realm-admin', async () => {
  const body = { record: 'doc', subject_kind: 'Role', subject: 'ps-author', policy: 'p' };
  as('reviewer');
  assert.equal(await status(() => api.savePolicy('p1', body)), 403);
  as('operator');
  assert.equal(await status(() => api.savePolicy('p1', body)), 403);
  as('owner');
  assert.equal((await api.savePolicy('p1', body)).record, 'doc:p1');
});

test('paper không tồn tại → 404', async () => {
  as('owner');
  assert.equal(await status(() => api.getBlob('p9')), 404);
  assert.equal(await status(() => api.putBlob('p9', CIPHERTEXT)), 404);
});

test('T10: thu hồi chặn truy cập VỀ SAU, không chặn token đang cầm', async () => {
  as('owner');
  await api.putBlob('p1', CIPHERTEXT);
  const grant = realm.createRoleRequest('owner', 'reviewer', 'ps-paper-p1-reader');
  realm.approveRequest('approver2', grant.id);

  as('reviewer');
  assert.equal(await api.getBlob('p1'), CIPHERTEXT, 'đọc được sau khi 2/3 duyệt');

  // 2/3 duyệt thu hồi — nhưng người phản biện vẫn đang cầm token cũ.
  const revoke = realm.createRevokeRequest('owner', 'reviewer', 'ps-paper-p1-reader');
  realm.approveRequest('approver3', revoke.id);

  assert.equal(
    await api.getBlob('p1'),
    CIPHERTEXT,
    'token cũ vẫn chạy đến khi hết hạn — đây là độ trễ thật, README nói rõ',
  );

  as('reviewer'); // token mới (refresh, hoặc token cũ hết hạn sau 10 phút)
  assert.equal(await status(() => api.getBlob('p1')), 403, 'từ đây trở đi thì chặn');
});

test('token hết hạn → 401 (không phải 403)', async () => {
  const token = as('owner');
  assert.equal(await status(() => api.papers()), 200);

  // Giả lập 10 phút trôi qua: ghi đè token bằng bản đã quá hạn.
  sessionStorage.setItem(
    'papersec.session.v1',
    JSON.stringify({ ...token, expiresAt: Date.now() - 1 }),
  );
  assert.equal(await status(() => api.papers()), 401);
});
