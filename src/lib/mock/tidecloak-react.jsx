// tidecloak-react.jsx — thay @tidecloak/react khi chạy Plan C (npm run preview:ui).
// Mô phỏng đúng 3 thứ BTC yêu cầu (https://tide.org/unlocked/#plan-c): đăng nhập, role, kiểm quyền.
//
// Điểm quan trọng: TOKEN CHỤP ROLE TẠI THỜI ĐIỂM CẤP. Role mới được quorum duyệt không tự vào
// token — phải bấm "Refresh token", đúng như JWT thật (plan mục 4 bước 3).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  IDENTITIES,
  QUORUM,
  approveRequest,
  changeRequests,
  clearSession,
  getSession,
  isAdmin,
  resetRealm,
  rolesOf,
  setSession,
  subscribe,
} from "./realm.js";
import { resetDb } from "./db.js";

const Ctx = createContext(null);

/** Token giả: chụp role một lần, như JWT do Tide ký (accessTokenLifespan 600s ở realm thật). */
const mint = (username) => ({ username, roles: rolesOf(username), issuedAt: Date.now() });

export function TideCloakContextProvider({ children }) {
  const [username, setUsername] = useState(getSession);
  const [token, setToken] = useState(() => (getSession() ? mint(getSession()) : null));
  const [picking, setPicking] = useState(false);
  const [realmTick, setRealmTick] = useState(0);

  useEffect(() => subscribe(() => setRealmTick((n) => n + 1)), []);

  const signIn = useCallback((name) => {
    setSession(name);
    setUsername(name);
    setToken(mint(name));
    setPicking(false);
  }, []);

  const value = useMemo(
    () => ({
      username,
      token,
      stale: token ? rolesOf(token.username).length !== token.roles.length : false,
      login: () => setPicking(true),
      logout: () => { clearSession(); setUsername(null); setToken(null); },
      forceRefreshToken: async () => setToken(mint(username)),
      signIn,
    }),
    // realmTick: role đổi ở tab khác thì tính lại `stale` để hiện nhắc Refresh token.
    [username, token, realmTick, signIn],
  );

  const [console_, setConsole] = useState(false);

  return (
    <Ctx.Provider value={value}>
      <PlanCBadge stale={value.stale} onOpenConsole={() => setConsole(true)} />
      {children}
      {picking && <IdentityPicker onPick={signIn} onClose={() => setPicking(false)} />}
      {console_ && <ApprovalsConsole actor={username} tick={realmTick} onClose={() => setConsole(false)} />}
    </Ctx.Provider>
  );
}

export function useTideCloak() {
  const ctx = useContext(Ctx) ?? {};
  return {
    isInitializing: false,
    initError: null,
    login: ctx.login ?? (() => {}),
    logout: ctx.logout ?? (() => {}),
    forceRefreshToken: ctx.forceRefreshToken ?? (async () => {}),
    getValueFromToken: (key) => (key === "preferred_username" ? ctx.token?.username : undefined),
    getVendorId: () => "simulated-vendor",
  };
}

export function useAuthCallback() {
  return { isCallback: false, isProcessing: false, error: null };
}

export function Authenticated({ children }) {
  return useContext(Ctx)?.token ? children : null;
}

export function Unauthenticated({ children }) {
  return useContext(Ctx)?.token ? null : children;
}

/** Token của phiên hiện tại — api.preview.js đọc để kiểm quyền, như backend đọc JWT. */
export function currentToken() {
  try {
    const username = getSession();
    return username ? { username, roles: rolesOf(username) } : null;
  } catch {
    return null;
  }
}

// --- Giao diện riêng của bản mô phỏng ----------------------------------------------------------

function PlanCBadge({ stale, onOpenConsole }) {
  return (
    <div style={badge.wrap}>
      <span style={badge.pill}>
        SIMULATED TIDECLOAK · <a href="https://tide.org/unlocked/#plan-c" target="_blank" rel="noreferrer" style={badge.link}>Plan C</a>
      </span>
      <button type="button" style={{ ...badge.pill, ...badge.button }} onClick={onOpenConsole}>
        QEA Approvals
      </button>
      {stale && <span style={{ ...badge.pill, ...badge.warn }}>Role đã đổi — bấm Refresh token</span>}
    </div>
  );
}

/**
 * tide-console → QEA Approvals, mô phỏng. Ở bản thật đây là ứng dụng RIÊNG của TideCloak, không
 * phải Papersec — nên nó nằm ngoài App.jsx, đúng ranh giới thật (plan mục 4 bước 2).
 */
function ApprovalsConsole({ actor, onClose }) {
  const [error, setError] = useState("");
  const crs = changeRequests();

  function approve(id) {
    setError("");
    try {
      approveRequest(actor, id);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={picker.backdrop} onClick={onClose}>
      <div style={{ ...picker.card, width: "min(620px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={picker.title}>tide-console → QEA Approvals (mô phỏng)</h2>
        <p style={picker.lede}>
          Đang xem với tư cách <strong>{actor ?? "chưa đăng nhập"}</strong>
          {actor && !isAdmin(actor) && " — không phải tide-realm-admin, bấm duyệt sẽ bị từ chối."}
          {" "}Cần {QUORUM}/3 tác giả duyệt thì role mới được gán.
        </p>
        {error && <p style={{ ...picker.lede, color: "#b91c1c", margin: 0 }}>{error}</p>}
        {crs.length === 0 && <p style={picker.lede}>Chưa có change request nào. Vào tab Author Workspace, bấm "Mời phản biện" để tạo.</p>}
        {crs.map((cr) => (
          <div key={cr.id} style={picker.row}>
            <strong>{cr.role} → {cr.username}</strong>
            <span style={{ ...picker.user, color: cr.status === "APPLIED" ? "#15803d" : "#b45309" }}>
              {cr.status} · {cr.approvals.length}/{QUORUM}
            </span>
            <span style={picker.note}>
              {cr.id} · tạo bởi {cr.createdBy}
              {cr.approvals.length > 0 && ` · đã duyệt: ${cr.approvals.join(", ")}`}
            </span>
            {cr.status === "PENDING" && (
              <button type="button" style={{ ...picker.approve, gridColumn: "1 / -1" }} onClick={() => approve(cr.id)}>
                Duyệt với tư cách {actor}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          style={{ ...picker.reset, marginTop: 4 }}
          onClick={() => { resetRealm(); resetDb(); onClose(); }}
        >
          Reset toàn bộ dữ liệu mô phỏng (realm + database)
        </button>
      </div>
    </div>
  );
}

function IdentityPicker({ onPick, onClose }) {
  return (
    <div style={picker.backdrop} onClick={onClose}>
      <div style={picker.card} onClick={(e) => e.stopPropagation()}>
        <h2 style={picker.title}>Đăng nhập (mô phỏng)</h2>
        <p style={picker.lede}>
          Mỗi tab là một người, thay cho 5 Chrome profile ở bản thật. Mở thêm tab để đóng vai khác.
        </p>
        {Object.entries(IDENTITIES).map(([username, meta]) => (
          <button key={username} type="button" style={picker.row} onClick={() => onPick(username)}>
            <strong>{meta.label}</strong>
            <span style={picker.user}>{username}</span>
            <span style={picker.note}>{meta.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const badge = {
  wrap: { position: "fixed", top: 8, right: 8, zIndex: 9999, display: "flex", gap: 6 },
  pill: { background: "#1f2937", color: "#f9fafb", borderRadius: 999, padding: "4px 12px", fontSize: 11, letterSpacing: ".04em", fontFamily: "ui-monospace, monospace" },
  warn: { background: "#b45309" },
  link: { color: "#93c5fd" },
  button: { border: 0, cursor: "pointer", font: "inherit", fontSize: 11, letterSpacing: ".04em" },
};

const picker = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", display: "grid", placeItems: "center", zIndex: 10000 },
  card: { background: "#fff", borderRadius: 14, padding: 24, width: "min(460px, 92vw)", display: "grid", gap: 8, boxShadow: "0 24px 60px rgba(0,0,0,.3)" },
  title: { margin: 0, fontSize: 20 },
  lede: { margin: "0 0 8px", fontSize: 13, color: "#475569", lineHeight: 1.5 },
  row: { display: "grid", gridTemplateColumns: "1fr auto", gap: 2, textAlign: "left", padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc", cursor: "pointer", font: "inherit" },
  user: { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#0f172a" },
  note: { gridColumn: "1 / -1", fontSize: 12, color: "#64748b" },
  approve: { marginTop: 8, padding: "8px 12px", borderRadius: 8, border: 0, background: "#0f172a", color: "#fff", cursor: "pointer", font: "inherit", fontSize: 13 },
  reset: { padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer", font: "inherit", fontSize: 12 },
};
