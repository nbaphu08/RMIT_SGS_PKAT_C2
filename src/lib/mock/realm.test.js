// Test luật governance của realm mô phỏng: quorum 2/3, Operator không duyệt được, mỗi người một
// phiếu. Đây là lời hứa trung tâm của bài ("không ai một mình vượt rào") nên phải có test.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// realm.js dùng localStorage + window; node không có, nên dựng bản tối thiểu trước khi import.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = { ...globalThis.localStorage };
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
globalThis.Event = class {};

const realm = await import('./realm.js');

const READER_P1 = 'ps-paper-p1-reader';
const caught = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('không ném lỗi'); };

beforeEach(() => realm.resetRealm());

test('người phản biện chưa có quyền đọc p1 trước khi được duyệt', () => {
  assert.ok(!realm.rolesOf('reviewer').includes(READER_P1));
});

test('một tác giả tạo CR = 1 phiếu, CHƯA đủ: quyền vẫn chưa được cấp (T13)', () => {
  const cr = realm.createRoleRequest('owner', 'reviewer', READER_P1);
  assert.equal(cr.status, 'PENDING');
  assert.deepEqual(cr.approvals, ['owner']);
  assert.ok(!realm.rolesOf('reviewer').includes(READER_P1), 'chưa đủ quorum thì chưa có role');
});

test('tác giả thứ hai duyệt → 2/2, role được gán (plan mục 4 bước 2)', () => {
  const cr = realm.createRoleRequest('owner', 'reviewer', READER_P1);
  const applied = realm.approveRequest('approver2', cr.id);
  assert.equal(applied.status, 'APPLIED');
  assert.ok(realm.rolesOf('reviewer').includes(READER_P1));
});

test('Operator duyệt bị 403 — không phải tide-realm-admin (T12)', () => {
  const cr = realm.createRoleRequest('owner', 'reviewer', READER_P1);
  const err = caught(() => realm.approveRequest('operator', cr.id));
  assert.equal(err.status, 403);
  assert.ok(!realm.rolesOf('reviewer').includes(READER_P1), 'CR vẫn PENDING sau khi Operator thử');
});

test('một tác giả KHÔNG tự đủ quorum bằng cách duyệt hai lần (mục 3.6)', () => {
  const cr = realm.createRoleRequest('owner', 'reviewer', READER_P1);
  assert.throws(() => realm.approveRequest('owner', cr.id), /đã duyệt/);
  assert.ok(!realm.rolesOf('reviewer').includes(READER_P1));
});

test('Operator tự tạo CR cho chính mình thì được 0 phiếu, vẫn cần 2 tác giả', () => {
  const cr = realm.createRoleRequest('operator', 'operator', 'ps-paper-p2-reader');
  assert.deepEqual(cr.approvals, []);
  assert.equal(cr.status, 'PENDING');
  assert.ok(!realm.rolesOf('operator').includes('ps-paper-p2-reader'));

  realm.approveRequest('owner', cr.id);
  assert.ok(!realm.rolesOf('operator').includes('ps-paper-p2-reader'), '1/2 vẫn chưa đủ');
  realm.approveRequest('approver3', cr.id);
  assert.ok(realm.rolesOf('operator').includes('ps-paper-p2-reader'), 'đủ 2/2 thì mới gán');
});

test('vai trò ban đầu đúng bảng plan mục 2: Operator không có _tide_decryptor', () => {
  assert.ok(!realm.rolesOf('operator').includes('_tide_decryptor'));
  assert.ok(!realm.rolesOf('operator').includes('tide-realm-admin'));
  for (const author of ['owner', 'approver2', 'approver3']) {
    assert.ok(realm.rolesOf(author).includes('tide-realm-admin'), `${author} phải duyệt được`);
  }
  assert.ok(realm.rolesOf('reviewer').includes('ps-paper-p3-reader'), 'p3 cấp sẵn, nhưng đã hết hạn');
});

// --- Thu hồi quyền (T10, đề bài: "any revocation stops future access") ------------------------

test('thu hồi cũng cần 2/3: một tác giả đơn lẻ không gỡ được quyền', () => {
  const grant = realm.createRoleRequest('owner', 'reviewer', READER_P1);
  realm.approveRequest('approver2', grant.id);
  assert.ok(realm.rolesOf('reviewer').includes(READER_P1));

  const revoke = realm.createRevokeRequest('owner', 'reviewer', READER_P1);
  assert.equal(revoke.action, 'REVOKE_ROLE');
  assert.equal(revoke.status, 'PENDING');
  assert.ok(realm.rolesOf('reviewer').includes(READER_P1), '1/2 phiếu thì chưa gỡ');

  realm.approveRequest('approver3', revoke.id);
  assert.ok(!realm.rolesOf('reviewer').includes(READER_P1), 'đủ 2/2 thì gỡ');
});

test('Operator không tự thu hồi quyền của người khác được', () => {
  const grant = realm.createRoleRequest('owner', 'reviewer', READER_P1);
  realm.approveRequest('approver2', grant.id);

  const cr = realm.createRevokeRequest('operator', 'reviewer', READER_P1);
  assert.deepEqual(cr.approvals, [], 'Operator tạo CR thì được 0 phiếu');
  const err = caught(() => realm.approveRequest('operator', cr.id));
  assert.equal(err.status, 403);
  assert.ok(realm.rolesOf('reviewer').includes(READER_P1), 'quyền vẫn còn nguyên');
});

test('thu hồi role không có thì báo lỗi, không tạo CR rác', () => {
  assert.throws(() => realm.createRevokeRequest('owner', 'reviewer', READER_P1), /không có/);
  assert.equal(realm.changeRequests().length, 0);
});

test('token hết hạn sau TOKEN_TTL_MS (realm thật: accessTokenLifespan 600s)', () => {
  const t0 = Date.now();
  const token = realm.mintToken('reviewer', t0);
  assert.equal(realm.tokenExpired(token, t0 + realm.TOKEN_TTL_MS - 1), false);
  assert.equal(realm.tokenExpired(token, t0 + realm.TOKEN_TTL_MS + 1), true);
});

test('sau khi thu hồi, token CŨ vẫn mang role — nên app phải nhắc refresh (T10)', () => {
  const grant = realm.createRoleRequest('owner', 'reviewer', READER_P1);
  realm.approveRequest('approver2', grant.id);
  const tokenTruocKhiThuHoi = realm.mintToken('reviewer');

  const revoke = realm.createRevokeRequest('owner', 'reviewer', READER_P1);
  realm.approveRequest('approver3', revoke.id);

  assert.ok(tokenTruocKhiThuHoi.roles.includes(READER_P1), 'token đã cấp không đổi được');
  assert.ok(realm.tokenIsStale(tokenTruocKhiThuHoi), 'phải phát hiện lệch để nhắc Refresh token');
  assert.ok(!realm.mintToken('reviewer').roles.includes(READER_P1), 'token mới thì hết quyền');
});
