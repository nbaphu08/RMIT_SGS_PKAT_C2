// realm.js — TideCloak giả lập cho Plan C (https://tide.org/unlocked/#plan-c): danh tính, realm
// role, và change request cần 2/3 tác giả duyệt. Thay cho realm thật khi mạng ORK quá tải.
//
// Ba lớp của bản mô phỏng nằm ở ba file tách biệt, đúng như kiến trúc thật (plan mục 3.3):
//   realm.js — governance: ai có role gì, đổi role phải qua quorum  (thật: TideCloak + QEA)
//   ork.js   — mật mã: ai giải mã được, hạn nằm trong policy đã ký  (thật: mạng ORK)
//   db.js    — dữ liệu server: Operator sửa được thoải mái           (thật: SQLite + ổ đĩa)
//
// Dùng localStorage nên nhiều tab cùng thấy một realm: tab của tác giả duyệt CR thì tab của
// người phản biện bấm "Refresh token" là thấy role mới — giống hệt luồng thật.

const KEY = "papersec.realm.v1";
const SESSION_KEY = "papersec.session.v1"; // sessionStorage: mỗi tab là một người

export const ENCRYPT_ROLE = "_tide_encryptor";
export const DECRYPT_ROLE = "_tide_decryptor";
export const ADMIN_ROLE = "tide-realm-admin";

// 5 danh tính của plan mục 2. tide-realm-admin chỉ 3 tác giả — Operator CỐ Ý không có.
export const IDENTITIES = {
  owner: { label: "Lead author", note: "Tác giả chính · duyệt được CR", admin: true },
  approver2: { label: "Supervisor", note: "GV hướng dẫn · duyệt được CR", admin: true },
  approver3: { label: "Co-author", note: "Đồng tác giả · duyệt được CR", admin: true },
  reviewer: { label: "External reviewer", note: "Người phản biện ngoài", admin: false },
  operator: { label: "Platform operator", note: "Chạy server + master admin · KHÔNG duyệt được", admin: false },
};

export const QUORUM = 2; // 2/3 tác giả (plan D1). Realm thật: ngưỡng trong admin policy đã ký.

const INITIAL = {
  // Sau pivot.sh: 3 tác giả có ps-author, reviewer đã có sẵn p3-reader, operator không có _tide_*.
  roles: {
    owner: [ENCRYPT_ROLE, DECRYPT_ROLE, "ps-author", ADMIN_ROLE],
    approver2: [ENCRYPT_ROLE, DECRYPT_ROLE, "ps-author", ADMIN_ROLE],
    approver3: [ENCRYPT_ROLE, DECRYPT_ROLE, "ps-author", ADMIN_ROLE],
    reviewer: [ENCRYPT_ROLE, DECRYPT_ROLE, "ps-paper-p3-reader"],
    operator: ["ps-operator"],
  },
  changeRequests: [],
};

const read = () => {
  try {
    return { ...INITIAL, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...INITIAL };
  }
};

const write = (state) => {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("papersec:realm"));
};

/** Nghe thay đổi realm từ tab này và từ tab khác (sự kiện `storage`). */
export function subscribe(fn) {
  const onStorage = (e) => { if (!e.key || e.key === KEY) fn(); };
  window.addEventListener("papersec:realm", fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("papersec:realm", fn);
    window.removeEventListener("storage", onStorage);
  };
}

export const rolesOf = (username) => read().roles[username] ?? [];
export const isAdmin = (username) => Boolean(IDENTITIES[username]?.admin);
export const changeRequests = () => read().changeRequests;

/**
 * Tạo CR "gán <role> cho <username>". Người tạo được tính 1 phiếu ([PACK] mục 10), nhưng chỉ khi
 * họ là tide-realm-admin — Operator tạo CR thì CR vẫn PENDING với 0 phiếu.
 */
export function createRoleRequest(actor, username, role) {
  const state = read();
  if ((state.roles[username] ?? []).includes(role)) {
    throw new Error(`${username} đã có ${role}`);
  }
  return openRequest(state, { action: "GRANT_ROLE", username, role, createdBy: actor });
}

/**
 * Tạo CR "gỡ <role> khỏi <username>" — thu hồi cũng đi qua quorum như cấp (plan mục 4 bước 7).
 * Một người không tự thu hồi được, cũng như không tự cấp được.
 */
export function createRevokeRequest(actor, username, role) {
  const state = read();
  if (!(state.roles[username] ?? []).includes(role)) {
    throw new Error(`${username} không có ${role}`);
  }
  return openRequest(state, { action: "REVOKE_ROLE", username, role, createdBy: actor });
}

function openRequest(state, { action, username, role, createdBy }) {
  const cr = {
    id: `cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    action,
    username,
    role,
    createdBy,
    approvals: isAdmin(createdBy) ? [createdBy] : [],
    status: "PENDING",
  };
  state.changeRequests = [cr, ...state.changeRequests];
  commitIfReady(state, cr);
  write(state);
  return cr;
}

/** Duyệt CR. Chỉ tide-realm-admin duyệt được; mỗi người một phiếu (plan mục 3.5, T12). */
export function approveRequest(actor, crId) {
  if (!isAdmin(actor)) {
    const err = new Error("403: không có tide-realm-admin — chỉ nhóm tác giả duyệt được");
    err.status = 403;
    throw err;
  }
  const state = read();
  const cr = state.changeRequests.find((c) => c.id === crId);
  if (!cr) throw new Error(`không có change request ${crId}`);
  if (cr.status !== "PENDING") throw new Error(`change request ${crId} đã ${cr.status}`);
  if (cr.approvals.includes(actor)) throw new Error(`${actor} đã duyệt CR này rồi`);
  cr.approvals.push(actor);
  commitIfReady(state, cr);
  write(state);
  return cr;
}

function commitIfReady(state, cr) {
  if (cr.approvals.length < QUORUM) return;
  cr.status = "APPLIED";
  const roles = state.roles[cr.username] ?? [];
  if (cr.action === "REVOKE_ROLE") {
    state.roles[cr.username] = roles.filter((r) => r !== cr.role);
  } else if (!roles.includes(cr.role)) {
    state.roles[cr.username] = [...roles, cr.role];
  }
}

export function resetRealm() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("papersec:realm"));
}

// --- Phiên đăng nhập: mỗi TAB là một người, như 5 Chrome profile lúc demo thật ----------------
//
// Token CHỤP role tại thời điểm cấp, đúng như JWT thật: role vừa được quorum duyệt KHÔNG tự vào
// token, phải bấm "Refresh token" (plan mục 4 bước 3). Backend mô phỏng đọc đúng bản chụp này,
// không đọc role sống — nếu đọc role sống thì demo sẽ bỏ qua mất bước refresh.

export const getSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    return null;
  }
};

// Realm thật đo được accessTokenLifespan = 600s (VERIFICATION_LOG). Token hết hạn là lý do
// thu hồi quyền có độ trễ: quyền bị gỡ chỉ chặn ở lần cấp token SAU (T10).
export const TOKEN_TTL_MS = 600_000;

/** Cấp token mới cho tab này: chụp role hiện tại của realm, kèm hạn sống. */
export function mintToken(username, now = Date.now()) {
  const token = { username, roles: rolesOf(username), issuedAt: now, expiresAt: now + TOKEN_TTL_MS };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(token));
  return token;
}

/** Token quá hạn → backend trả 401, người dùng phải đăng nhập/refresh lại (như JWT thật). */
export const tokenExpired = (token, now = Date.now()) =>
  Boolean(token?.expiresAt && now > token.expiresAt);

export const clearSession = () => sessionStorage.removeItem(SESSION_KEY);

/** Token của tab hiện tại — api.preview.js đọc để kiểm quyền, như backend đọc JWT. */
export const currentToken = () => getSession();

/**
 * Role trong realm đã khác role trong token chưa? Dùng để nhắc "bấm Refresh token".
 * Lệch theo CẢ HAI chiều: vừa được cấp thêm, hoặc vừa bị thu hồi (T10).
 */
export function tokenIsStale(token) {
  if (!token) return false;
  const live = rolesOf(token.username);
  return live.length !== token.roles.length
    || live.some((r) => !token.roles.includes(r))
    || token.roles.some((r) => !live.includes(r));
}
