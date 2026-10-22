import { useCallback, useEffect, useState } from "react";
import { Authenticated, Unauthenticated, useAuthCallback, useTideCloak } from "@tidecloak/react";
import { AdminAPI, IAMService } from "@tidecloak/js";
import { api, describeError, policyFor } from "./lib/api.js";
import {
  decryptBytesForRecord,
  decryptForRecord,
  encryptForRecord,
  signRelationshipPolicy,
} from "./lib/relationship.js";

const PAPER_IDS = ["p1", "p2", "p3"];
const AUTHOR_ROLE = "ps-author";
const OPERATOR_ROLE = "ps-operator";
const ADMIN_ROLE = "tide-realm-admin";
const readerRole = (paperId) => `ps-paper-${paperId}-reader`;

/** review_until có thể là epoch giây hoặc chuỗi ngày (do M-B quyết): nhận cả hai. */
function deadlineMs(reviewUntil) {
  if (reviewUntil === null || reviewUntil === undefined || reviewUntil === "") return null;
  const asNumber = Number(reviewUntil);
  if (Number.isFinite(asNumber)) return asNumber * 1000;
  const parsed = Date.parse(reviewUntil);
  return Number.isNaN(parsed) ? null : parsed;
}

function describeDeadline(reviewUntil) {
  const ms = deadlineMs(reviewUntil);
  if (ms === null) return "No deadline";
  const left = ms - Date.now();
  if (left <= 0) return `EXPIRED ${new Date(ms).toLocaleString("en-GB")}`;
  const hours = Math.floor(left / 3_600_000);
  return hours >= 24 ? `${Math.floor(hours / 24)} days remaining` : `${hours} hours remaining`;
}

// --- Nguyên liệu dùng chung --------------------------------------------------------------------

const ICONS = {
  authors: [
    "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19",
    "M17 11.5a3 3 0 0 0 0-6",
    "M20.5 19v-1.5a3.5 3.5 0 0 0-2.6-3.37",
  ],
  reviewer: ["M3 13h4.5l1.8 2.5h5.4L16.5 13H21", "M6 5h12l3 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"],
  operator: ["M7 9.5l3 2.5-3 2.5", "M13 15h4"],
  policies: ["M12 3l7.5 3v5.6c0 4.2-3.1 7.9-7.5 9.4-4.4-1.5-7.5-5.2-7.5-9.4V6z", "M9 12.2l2.3 2.3 4-4.3"],
  refresh: ["M20.5 12a8.5 8.5 0 1 1-2.6-6.1", "M19.5 2.5V7H15"],
  logout: ["M9.5 21h-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16.5 16.5L21 12l-4.5-4.5", "M21 12H9.5"],
  file: ["M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z", "M13.5 3v5.5H19"],
  lock: ["M7 10.5V7.5a5 5 0 0 1 10 0v3", "M5.5 10.5h13v9h-13z"],
};

/** Icon trang trí: luôn aria-hidden, nghĩa nằm ở nhãn chữ đi kèm. */
function Icon({ name, size = 18 }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "authors" && <circle cx="10" cy="7.5" r="3.5" />}
      {name === "operator" && <rect x="3" y="4" width="18" height="16" rx="2.5" />}
      {ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/**
 * Mọi kết quả do máy sinh ra. `deny` cố ý không dùng màu lỗi: trong Papersec, việc mạng ORK từ
 * chối giải mã là kết quả đúng của bài demo chứ không phải hỏng hóc.
 */
function Proof({ state, id }) {
  return (
    <output
      id={id}
      className={`proof${state ? ` proof--${state.tone}` : ""}`}
      aria-live="polite"
    >
      {state?.text ?? ""}
    </output>
  );
}

function Deadline({ reviewUntil }) {
  const ms = deadlineMs(reviewUntil);
  const text = describeDeadline(reviewUntil);
  if (ms === null) return <span>{text}</span>;
  return <time dateTime={new Date(ms).toISOString()}>{text}</time>;
}

// --- Vỏ ứng dụng -------------------------------------------------------------------------------

export default function App() {
  const { isInitializing, initError } = useTideCloak();
  const { isCallback, isProcessing, error: callbackError } = useAuthCallback({
    onSuccess: (returnUrl) => window.location.assign(returnUrl || "/"),
    onError: () => window.location.assign("/"),
    onMissingVerifierRedirectTo: "/",
  });

  if (isCallback) {
    if (callbackError) return <Gate>Sign-in failed: {callbackError.message}</Gate>;
    return <Gate>{isProcessing ? "Completing sign-in…" : "Redirecting…"}</Gate>;
  }
  if (isInitializing) return <Gate>Initializing TideCloak…</Gate>;
  if (initError) return <Gate>TideCloak could not be initialized: {initError.message}</Gate>;

  return (
    <>
      <Authenticated>
        <Shell />
      </Authenticated>
      <Unauthenticated>
        <Login />
      </Unauthenticated>
    </>
  );
}

function Gate({ children }) {
  return (
    <main className="gate">
      <p className="gate__status" role="status">{children}</p>
    </main>
  );
}

function Login() {
  const { login } = useTideCloak();
  return (
    <main className="gate">
      <article>
        <h1 className="gate__title">Papersec</h1>
        <p className="gate__lede">
          Deliver an unpublished manuscript to a single designated reviewer, for a defined
          period only.
        </p>
        <button type="button" className="btn btn--primary" onClick={login}>
          Sign in with Tide
        </button>
      </article>
    </main>
  );
}

const TAB_LABELS = {
  authors: "Author Workspace",
  reviewer: "Reviewer Inbox",
  operator: "Operator Console",
  policies: "Policy Signing",
};

function Shell() {
  const { logout, forceRefreshToken, getValueFromToken } = useTideCloak();
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState("");

  const load = useCallback(() => {
    api.me().then(setMe).catch((e) => setStatus(describeError(e)));
  }, []);
  useEffect(load, [load]);

  async function refresh() {
    setStatus("Refreshing token…");
    await forceRefreshToken();
    load();
    setStatus("Token refreshed");
  }

  // Tab hiện theo role trong token (plan mục 5.3). Tác giả cũng là tide-realm-admin (mục 2).
  const roles = me?.roles ?? [];
  const isAuthor = roles.includes(AUTHOR_ROLE);
  const isOperator = roles.includes(OPERATOR_ROLE);
  const hasReader = PAPER_IDS.some((id) => roles.includes(readerRole(id)));
  const tabs = [
    ...(isAuthor ? ["authors"] : []),
    ...(hasReader || (!isAuthor && !isOperator) ? ["reviewer"] : []),
    ...(isOperator ? ["operator"] : []),
    ...(isAuthor || roles.includes(ADMIN_ROLE) ? ["policies"] : []),
  ];
  const active = tabs.includes(tab) ? tab : tabs[0];
  const username = me?.username ?? getValueFromToken("preferred_username") ?? "…";

  return (
    <div className="app">
      <nav className="rail" aria-label="Workspace shortcuts">
        <ul className="rail__list">
          {tabs.map((id) => (
            <li key={id}>
              <button
                type="button"
                className="rail__btn"
                aria-selected={active === id}
                aria-label={TAB_LABELS[id]}
                onClick={() => setTab(id)}
              >
                <Icon name={id} />
              </button>
            </li>
          ))}
        </ul>
        <ul className="rail__list rail__list--end">
          <li>
            <button type="button" className="rail__btn" aria-label="Refresh token" onClick={refresh}>
              <Icon name="refresh" />
            </button>
          </li>
          <li>
            <button type="button" className="rail__btn" aria-label="Sign out" onClick={logout}>
              <Icon name="logout" />
            </button>
          </li>
        </ul>
      </nav>

      <main className="main">
        <div className="main__inner">
          <p className="session">
            <span className="session__dot" aria-hidden="true" />
            <span className="sr-only">Active Tide session — </span>
            {username}
            {roles.length > 0 && <span className="session__roles">· {roles.join(", ")}</span>}
          </p>

          <header className="hero">
            <p className="eyebrow">
              <span aria-hidden="true">—</span>
              {new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
              {" · "}
              {status || `${tabs.length} workspaces available`}
            </p>
            <h1 className="hero__title">
              Welcome, {username}.
              <span>Where would you like to begin?</span>
            </h1>

            <div className="tabs" role="tablist" aria-label="Workspaces">
              {tabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  className="tab"
                  aria-selected={active === id}
                  aria-controls={`panel-${id}`}
                  onClick={() => setTab(id)}
                >
                  <Icon name={id} size={16} />
                  {TAB_LABELS[id]}
                </button>
              ))}
            </div>
          </header>

          {active && (
            <section id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`} tabIndex={-1}>
              <h2 className="sr-only">{TAB_LABELS[active]}</h2>
              {active === "authors" && <AuthorRoom />}
              {active === "reviewer" && <ReviewerInbox />}
              {active === "operator" && <OperatorConsole />}
              {active === "policies" && <PolicySigner />}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function usePapers() {
  const [papers, setPapers] = useState([]);
  const [error, setError] = useState("");
  const reload = useCallback(
    () => api.papers().then(setPapers).catch((e) => setError(describeError(e))),
    [],
  );
  useEffect(() => { reload(); }, [reload]);
  return { papers, error, reload };
}

// --- 1. Phòng tác giả --------------------------------------------------------------------------

function AuthorRoom() {
  const { papers, error, reload } = usePapers();
  const [status, setStatus] = useState(null);
  const [reviewer, setReviewer] = useState("reviewer");
  const [notes, setNotes] = useState({});

  async function encryptAndUpload(paper, file) {
    setStatus({ tone: "pending", text: `${paper.id}: reading ${file.name} and encrypting it within the browser…` });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const policy = await policyFor(paper.id, "doc");
      const ciphertext = await encryptForRecord(bytes, `doc:${paper.id}`, policy);
      const saved = await api.putBlob(paper.id, ciphertext);
      setStatus({ tone: "ok", text: `${paper.id}: uploaded ${saved.blob_size} bytes of ciphertext (${bytes.length} bytes of plaintext never left the browser)` });
      reload();
    } catch (e) {
      setStatus({ tone: "deny", text: `${paper.id}: ${describeError(e)}` });
    }
  }

  /**
   * Tạo change request "gán ps-paper-<id>-reader" từ trình duyệt của chính tác giả (plan mục 4
   * bước 1, T8). Nếu CORS/quyền chặn thì gán trong tide-console rồi dán change_request_id vào ô
   * bên dưới. Quyền chỉ có hiệu lực sau khi 2/3 tác giả duyệt.
   */
  async function invite(paper) {
    setStatus({ tone: "pending", text: `${paper.id}: calling the admin API to create a change request granting ${readerRole(paper.id)} to "${reviewer}"…` });
    try {
      const admin = new AdminAPI(IAMService.getConfig()?.realm);
      const users = await admin.getUsers({ search: reviewer });
      const user = (users ?? []).find((u) => u.username === reviewer);
      if (!user) throw new Error(`the user "${reviewer}" was not found in the realm`);
      const role = await admin.getRole(readerRole(paper.id));
      const created = await admin.addUserRoles(user.id, [role]);
      const changeRequestId = created?.changeSetId ?? created?.draftRecordId ?? "";
      const invite = await api.invite(paper.id, { reviewer });
      if (changeRequestId) await api.patchInvite(invite.id, changeRequestId);
      setStatus({ tone: "pending", text: `${paper.id}: change request ${changeRequestId || "(no id returned — consult tide-console)"} is PENDING. Approval by 2 of 3 authors is required in tide-console → QEA Approvals.` });
    } catch (e) {
      setStatus({ tone: "deny", text: `${paper.id}: ${describeError(e)}` });
    }
  }

  async function recordInviteManually(paper, changeRequestId) {
    try {
      const invite = await api.invite(paper.id, { reviewer });
      await api.patchInvite(invite.id, changeRequestId);
      setStatus({ tone: "ok", text: `${paper.id}: invitation recorded against change request ${changeRequestId} (role granted in tide-console)` });
    } catch (e) {
      setStatus({ tone: "deny", text: `${paper.id}: ${describeError(e)}` });
    }
  }

  async function readFeedback(paper) {
    setStatus({ tone: "pending", text: `${paper.id}: decrypting feedback…` });
    try {
      const policy = await policyFor(paper.id, "fb");
      const rows = await api.feedback(paper.id);
      const texts = await Promise.all(
        rows.map((row) => decryptForRecord(row.ciphertext, `fb:${paper.id}`, policy)),
      );
      setNotes((prev) => ({ ...prev, [paper.id]: texts }));
      setStatus({ tone: "ok", text: `${paper.id}: decrypted ${texts.length} feedback entries` });
    } catch (e) {
      setStatus({ tone: "deny", text: `${paper.id}: ${describeError(e)}` });
    }
  }

  return (
    <>
      <div className="console">
        <label className="console__label" htmlFor="author-reviewer">
          Reviewer to invite
        </label>
        <input
          id="author-reviewer"
          className="field"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          autoComplete="off"
          aria-describedby="author-reviewer-hint"
        />
        <p className="console__hint" id="author-reviewer-hint">
          A username within the realm. Each invitation creates a change request that takes effect
          only once 2 of 3 authors have approved it.
        </p>
        <Proof state={status} />
      </div>

      <section className="section" aria-labelledby="authors-papers">
        <div className="section__head">
          <h3 className="section__title" id="authors-papers">Manuscripts held by the team</h3>
          <p className="section__meta">{papers.length} manuscripts</p>
        </div>

        {error && <p className="empty" role="alert">{error}</p>}

        <ul className="paper-grid">
          {papers.map((paper) => (
            <li key={paper.id}>
              <article className="paper-card">
                <div className="paper-card__top">
                  <p className="paper-card__id">{paper.id}</p>
                  <p className={`crypto-tag crypto-tag--${paper.blob_size ? "sealed" : "plain"}`}>
                    <Icon name="lock" size={12} />
                    {paper.blob_size ? `Encrypted · ${paper.blob_size} B` : "Not encrypted"}
                  </p>
                </div>

                <h4 className="paper-card__title">{paper.code_title ?? paper.id}</h4>
                <p className="paper-card__deadline">
                  Review deadline: <Deadline reviewUntil={paper.review_until} />
                </p>

                <div className="paper-card__actions">
                  <label className="file-field">
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) encryptAndUpload(paper, file);
                        e.target.value = "";
                      }}
                    />
                    <span className="btn file-field__btn">Encrypt &amp; upload PDF</span>
                  </label>
                  <button type="button" className="btn btn--block" onClick={() => invite(paper)}>
                    Invite a reviewer
                  </button>
                  <button type="button" className="btn btn--ghost btn--block" onClick={() => readFeedback(paper)}>
                    Read feedback
                  </button>
                  <ManualInvite paperId={paper.id} onSubmit={(id) => recordInviteManually(paper, id)} />
                </div>

                {(notes[paper.id] ?? []).length > 0 && (
                  <ul className="notes">
                    {notes[paper.id].map((note, i) => (
                      <li key={i}>“{note}”</li>
                    ))}
                  </ul>
                )}
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Phương án lùi khi admin API bị CORS chặn (plan mục 8, G3): gán role trong tide-console rồi dán id. */
function ManualInvite({ paperId, onSubmit }) {
  const [value, setValue] = useState("");
  const inputId = `manual-invite-${paperId}`;
  return (
    <form
      className="console__row"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        change_request_id for {paperId}, obtained from tide-console
      </label>
      <input
        id={inputId}
        className="field"
        placeholder="change_request_id from tide-console"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn btn--ghost" disabled={!value.trim()}>
        Record
      </button>
    </form>
  );
}

// --- 2. Hộp thư phản biện ----------------------------------------------------------------------

function ReviewerInbox() {
  const { papers, error } = usePapers();
  const [probe, setProbe] = useState(null);

  async function probePaper(paperId) {
    setProbe({ tone: "pending", text: `calling GET /api/papers/${paperId}/blob …` });
    try {
      await api.getBlob(paperId);
      setProbe({ tone: "ok", text: `${paperId}: 200 — the backend returned ciphertext. For a manuscript that was never granted, or one that has expired, this constitutes a failure: record it in VERIFICATION_LOG.` });
    } catch (e) {
      setProbe({ tone: "deny", text: `${paperId}: ${describeError(e)}` });
    }
  }

  return (
    <>
      <section className="section" aria-labelledby="reviewer-papers">
        <div className="section__head">
          <h3 className="section__title" id="reviewer-papers">Manuscripts granted to you</h3>
          <p className="section__meta">{papers.length} manuscripts</p>
        </div>

        {error && <p className="empty" role="alert">{error}</p>}

        {papers.length === 0 ? (
          <p className="empty">
            No manuscripts are available yet. The role <code>ps-paper-&lt;id&gt;-reader</code> enters
            your token only after 2 of 3 authors have approved the change request and you have
            refreshed the token.
          </p>
        ) : (
          <ul className="rows">
            {papers.map((paper) => (
              <li key={paper.id}>
                <ReviewerPaper paper={paper} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="probe" aria-labelledby="reviewer-probe">
        <div className="probe__head">
          <p className="row__icon row__icon--deny" aria-hidden="true">
            <Icon name="lock" size={15} />
          </p>
          <div>
            <h3 className="probe__title" id="reviewer-probe">Attempt to open another manuscript</h3>
            <p className="probe__lede">
              p2 was never shared → 403. p3 has expired → 403 at the backend, and the ORK network
              declines to decrypt it.
            </p>
          </div>
        </div>
        <div className="probe__actions">
          {PAPER_IDS.map((id) => (
            <button key={id} type="button" className="btn" onClick={() => probePaper(id)}>
              <span className="btn__dot btn__dot--deny" aria-hidden="true" />
              Attempt {id}
            </button>
          ))}
        </div>
        <Proof state={probe} />
      </section>
    </>
  );
}

function ReviewerPaper({ paper }) {
  const [status, setStatus] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [note, setNote] = useState("");
  const noteId = `note-${paper.id}`;

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function openPaper() {
    setStatus({ tone: "pending", text: "downloading ciphertext and decrypting it within the browser…" });
    try {
      const policy = await policyFor(paper.id, "doc");
      const ciphertext = await api.getBlob(paper.id);
      const pdf = await decryptBytesForRecord(ciphertext, `doc:${paper.id}`, policy);
      setPdfUrl(URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })));
      setStatus({ tone: "ok", text: `decrypted ${pdf.length} bytes` });
    } catch (e) {
      setStatus({ tone: "deny", text: describeError(e) });
    }
  }

  async function sendFeedback() {
    setStatus({ tone: "pending", text: "encrypting the feedback (readable by the author team alone)…" });
    try {
      const policy = await policyFor(paper.id, "fb");
      const ciphertext = await encryptForRecord(note, `fb:${paper.id}`, policy);
      await api.postFeedback(paper.id, ciphertext);
      setNote("");
      setStatus({ tone: "ok", text: "encrypted feedback submitted" });
    } catch (e) {
      setStatus({ tone: "deny", text: describeError(e) });
    }
  }

  return (
    <article className="row">
      <p className="row__icon" aria-hidden="true"><Icon name="file" size={15} /></p>
      <div className="row__body">
        <h4 className="row__title">{paper.code_title ?? paper.id}</h4>
        <p className="row__detail">
          {paper.id} · <Deadline reviewUntil={paper.review_until} />
        </p>

        <div className="console__row">
          <button type="button" className="btn btn--primary" onClick={openPaper}>
            Open manuscript
          </button>
        </div>

        {pdfUrl && (
          <iframe
            title={`Decrypted manuscript: ${paper.code_title ?? paper.id}`}
            src={pdfUrl}
            style={{ width: "100%", height: 520, marginTop: 12, border: 0, borderRadius: 9 }}
          />
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendFeedback();
          }}
        >
          <label className="console__label" htmlFor={noteId}>
            Feedback for the author team
          </label>
          <textarea
            id={noteId}
            className="field"
            placeholder="Encrypted before it leaves the browser — readable by the author team alone."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="console__row">
            <button type="submit" className="btn" disabled={!note}>
              Submit feedback
            </button>
          </div>
        </form>

        <Proof state={status} />
      </div>
    </article>
  );
}

// --- 3. Operator Console -----------------------------------------------------------------------

function OperatorConsole() {
  const [storage, setStorage] = useState(null);
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(null);
  const [extend, setExtend] = useState(null);

  useEffect(() => {
    api.operatorStorage().then(setStorage).catch((e) => setStatus(describeError(e)));
  }, []);

  async function tryDecrypt(paperId) {
    setAttempt({ tone: "pending", text: `loading ciphertext ${paperId} from disk (the operator holds full storage access) and attempting decryption…` });
    try {
      const ciphertext = await api.operatorBlob(paperId);
      const [row] = await api.operatorPolicies(paperId);
      if (!row) throw new Error(`no policy doc:${paperId} exists in the database — sign it in Policy Signing first`);
      const policy = row.policy;
      const pdf = await decryptBytesForRecord(ciphertext, `doc:${paperId}`, policy);
      setAttempt({ tone: "pending", text: `UNEXPECTED: ${pdf.length} bytes were decrypted. Record this in VERIFICATION_LOG (T9).` });
    } catch (e) {
      setAttempt({ tone: "deny", text: describeError(e) });
    }
  }

  /** T16: Operator sửa hạn trong DB. Backend thôi chặn, nhưng hạn thật nằm trong policy đã ký. */
  async function extendP3() {
    setExtend({ tone: "pending", text: "PATCH /api/operator/papers/p3/review-until …" });
    try {
      const sevenDays = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
      const row = await api.operatorSetReviewUntil("p3", sevenDays);
      setExtend({ tone: "deny", text: `database amended: review_until = ${row.review_until ?? sevenDays}. The backend no longer blocks p3 — yet the reviewer still cannot decrypt it, because the ORK network validates the expiry recorded in the threshold-signed policy (T16).` });
    } catch (e) {
      setExtend({ tone: "deny", text: describeError(e) });
    }
  }

  return (
    <>
      <section className="section" aria-labelledby="operator-storage">
        <div className="section__head">
          <h3 className="section__title" id="operator-storage">What the server operator sees on disk</h3>
          <p className="section__meta">{storage?.dir ?? "…"}</p>
        </div>

        {status && <p className="empty" role="alert">{status}</p>}

        <ul className="rows">
          {(storage?.files ?? []).map((file) => (
            <li className="row" key={file.name}>
              <p className="row__icon" aria-hidden="true"><Icon name="file" size={15} /></p>
              <div className="row__body">
                <h4 className="row__title">{file.name}</h4>
                <p className="row__detail">{file.head_hex}</p>
              </div>
              <p className="row__aside">
                {file.size} B · {file.is_pdf ? "IS %PDF (!)" : "not %PDF"}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="probe" aria-labelledby="operator-decrypt">
        <div className="probe__head">
          <p className="row__icon row__icon--deny" aria-hidden="true">
            <Icon name="lock" size={15} />
          </p>
          <div>
            <h3 className="probe__title" id="operator-decrypt">Download the ciphertext and attempt decryption</h3>
            <p className="probe__lede">
              The ORK network re-evaluates every decryption: without the reader role for that
              particular manuscript, and without <code>_tide_decryptor</code>, the request is
              refused. The underlying error is reproduced verbatim, together with its{" "}
              <code>cause</code>.
            </p>
          </div>
        </div>
        <div className="probe__actions">
          {PAPER_IDS.map((id) => (
            <button key={id} type="button" className="btn" onClick={() => tryDecrypt(id)}>
              <span className="btn__dot btn__dot--deny" aria-hidden="true" />
              Attempt to decrypt {id}
            </button>
          ))}
        </div>
        <Proof state={attempt} />
      </section>

      <section className="probe" aria-labelledby="operator-extend">
        <div className="probe__head">
          <p className="row__icon row__icon--deny" aria-hidden="true">
            <Icon name="refresh" size={15} />
          </p>
          <div>
            <h3 className="probe__title" id="operator-extend">Extend p3 by amending the database</h3>
            <p className="probe__lede">
              The operator is able to modify the <code>review_until</code> column in SQLite. The
              authoritative deadline resides in the signed policy: the ORK network refuses
              nonetheless.
            </p>
          </div>
        </div>
        <div className="probe__actions">
          <button type="button" className="btn" onClick={extendP3}>
            <span className="btn__dot btn__dot--pending" aria-hidden="true" />
            Extend p3 (+7 days)
          </button>
        </div>
        <Proof state={extend} />
      </section>

      <aside className="callout">
        <p className="callout__tag">Self-granted access</p>
        <p>
          Assigning <code>ps-paper-p2-reader</code> to oneself in tide-console merely creates a
          PENDING change request: the approval is attributed to the HTTP caller, and the operator
          is not a <code>tide-realm-admin</code> and therefore cannot approve it. Open tide-console
          → QEA Approvals to confirm.
        </p>
      </aside>
    </>
  );
}

// --- 4. Ký policy ------------------------------------------------------------------------------

// 9 policy của bảng plan mục 3.2. p2 chỉ cần A-doc (không chia sẻ ra ngoài).
const GRANTS = [
  { name: "A-doc-p1", paper: "p1", record: "doc", subject: "author", access: "read-write" },
  { name: "A-doc-p2", paper: "p2", record: "doc", subject: "author", access: "read-write" },
  { name: "A-doc-p3", paper: "p3", record: "doc", subject: "author", access: "read-write" },
  { name: "A-fb-p1", paper: "p1", record: "fb", subject: "author", access: "read" },
  { name: "A-fb-p3", paper: "p3", record: "fb", subject: "author", access: "read" },
  { name: "R-doc-p1", paper: "p1", record: "doc", subject: "reader", access: "read", expires: true },
  { name: "R-fb-p1", paper: "p1", record: "fb", subject: "reader", access: "write", expires: true },
  { name: "R-doc-p3", paper: "p3", record: "doc", subject: "reader", access: "read", expires: true },
  { name: "R-fb-p3", paper: "p3", record: "fb", subject: "reader", access: "write", expires: true },
];

const toLocalInput = (ms) =>
  new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Chỉ dùng lúc chuẩn bị, trong trình duyệt của một tide-realm-admin (plan mục 5.3 tab 4). */
function PolicySigner() {
  const { getVendorId } = useTideCloak();
  const [adminPolicy, setAdminPolicy] = useState("");
  // expiry là Unix GIÂY [PACK]. p1: hạn phản biện 7 ngày. p3: hạn đã qua lúc demo.
  const [deadlines, setDeadlines] = useState({
    p1: toLocalInput(Date.now() + 7 * 24 * 3_600_000),
    p3: toLocalInput(Date.now() - 3_600_000),
  });
  const [status, setStatus] = useState({});

  // Gọi thẳng từ click: await trước khi mở enclave làm popup bị chặn (pack: troubleshooting T-27).
  function sign(grant) {
    const subject = grant.subject === "reader" ? readerRole(grant.paper) : AUTHOR_ROLE;
    const recordId = `${grant.record}:${grant.paper}`;
    const expiry = grant.expires
      ? Math.floor(new Date(deadlines[grant.paper]).getTime() / 1000)
      : undefined;
    const note = (tone, text) => setStatus((prev) => ({ ...prev, [grant.name]: { tone, text } }));

    note("pending", "opening the enclave for approval…");
    signRelationshipPolicy(
      {
        vendorId: getVendorId(),
        subject: { type: "Role", id: subject },
        recordId,
        access: grant.access,
        ...(expiry ? { expiry } : {}),
      },
      Uint8Array.from(atob(adminPolicy.trim()), (c) => c.charCodeAt(0)),
    )
      .then((policy) =>
        api.savePolicy(grant.paper, { record: grant.record, subject_kind: "Role", subject, policy }),
      )
      .then(() => note("ok", `signed and stored ${recordId} for Role ${subject}`))
      .catch((e) => note("deny", describeError(e)));
  }

  return (
    <>
      <div className="console">
        <label className="console__label" htmlFor="admin-policy">
          Administrator policy (base64)
        </label>
        <textarea
          id="admin-policy"
          className="field"
          value={adminPolicy}
          onChange={(e) => setAdminPolicy(e.target.value)}
          aria-describedby="admin-policy-hint"
        />
        <p className="console__hint" id="admin-policy-hint">
          Obtain it from <code>/admin/realms/&lt;realm&gt;/iga/role-policies/name/tide-realm-admin</code>.
          Only a <code>tide-realm-admin</code> may sign. This is a preparatory step, not part of the
          demonstration itself.
        </p>

        <div className="console__row">
          <label className="console__label" htmlFor="deadline-p1">Review deadline for p1</label>
          <input
            id="deadline-p1"
            className="field"
            type="datetime-local"
            value={deadlines.p1}
            onChange={(e) => setDeadlines((prev) => ({ ...prev, p1: e.target.value }))}
            style={{ width: "auto" }}
          />
          <label className="console__label" htmlFor="deadline-p3">Review deadline for p3 (set in the past)</label>
          <input
            id="deadline-p3"
            className="field"
            type="datetime-local"
            value={deadlines.p3}
            onChange={(e) => setDeadlines((prev) => ({ ...prev, p3: e.target.value }))}
            style={{ width: "auto" }}
          />
        </div>
      </div>

      <section className="section" aria-labelledby="grants">
        <div className="section__head">
          <h3 className="section__title" id="grants">RelationshipAttestation:1 policies</h3>
          <p className="section__meta">{GRANTS.length} policies</p>
        </div>

        <ul className="rows">
          {GRANTS.map((grant) => (
            <li className="grant" key={grant.name}>
              <p className="grant__name">{grant.name}</p>
              <div className="grant__body">
                <p className="grant__spec">
                  {grant.record}:{grant.paper} · Role{" "}
                  {grant.subject === "reader" ? readerRole(grant.paper) : AUTHOR_ROLE} · {grant.access}
                  {grant.expires ? ` · expires ${deadlines[grant.paper]}` : " · no expiry"}
                </p>
                <Proof state={status[grant.name]} />
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => sign(grant)}
                disabled={!adminPolicy.trim()}
              >
                <span className="btn__dot btn__dot--sign" aria-hidden="true" />
                Sign
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
