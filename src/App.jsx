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
  if (ms === null) return "không hạn";
  const left = ms - Date.now();
  if (left <= 0) return `HẾT HẠN ${new Date(ms).toLocaleString()}`;
  const hours = Math.floor(left / 3_600_000);
  return hours >= 24 ? `còn ${Math.floor(hours / 24)} ngày` : `còn ${hours} giờ`;
}

export default function App() {
  const { isInitializing, initError } = useTideCloak();
  const { isCallback, isProcessing, error: callbackError } = useAuthCallback({
    onSuccess: (returnUrl) => window.location.assign(returnUrl || "/"),
    onError: () => window.location.assign("/"),
    onMissingVerifierRedirectTo: "/",
  });

  if (isCallback) {
    if (callbackError) return <p className="loading">Đăng nhập thất bại: {callbackError.message}</p>;
    return <p className="loading">{isProcessing ? "Đang hoàn tất đăng nhập…" : "Đang chuyển hướng…"}</p>;
  }
  if (isInitializing) return <p className="loading">Đang khởi tạo TideCloak…</p>;
  if (initError) return <p className="loading">Không khởi tạo được TideCloak: {initError.message}</p>;

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

function Login() {
  const { login } = useTideCloak();
  return (
    <div className="loading">
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 34 }}>Papersec</h1>
        <p>Gửi bản thảo chưa công bố cho đúng một người phản biện, trong đúng thời hạn.</p>
        <button className="button dark" onClick={login}>Đăng nhập bằng Tide</button>
      </div>
    </div>
  );
}

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
    setStatus("đang làm mới token…");
    await forceRefreshToken();
    load();
    setStatus("đã làm mới token");
  }

  // Tab hiện theo role trong token (plan mục 5.3). Tác giả cũng là tide-realm-admin (mục 2).
  const roles = me?.roles ?? [];
  const isAuthor = roles.includes(AUTHOR_ROLE);
  const isOperator = roles.includes(OPERATOR_ROLE);
  const hasReader = PAPER_IDS.some((id) => roles.includes(readerRole(id)));
  const tabs = [
    ...(isAuthor ? [["authors", "Phòng tác giả"]] : []),
    ...(hasReader || (!isAuthor && !isOperator) ? [["reviewer", "Hộp thư phản biện"]] : []),
    ...(isOperator ? [["operator", "Operator Console"]] : []),
    ...(isAuthor || roles.includes(ADMIN_ROLE) ? [["policies", "Ký policy"]] : []),
  ];
  const active = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">P</span> Papersec
        </div>
        <div className="top-actions">
          <span className="auth-state connected">
            <i />
            {me?.username ?? getValueFromToken("preferred_username") ?? "…"}
            {roles.length > 0 && ` · ${roles.join(", ")}`}
            {status && ` · ${status}`}
          </span>
          <button className="button outline" onClick={refresh}>Refresh token</button>
          <button className="button quiet" onClick={logout}>Đăng xuất</button>
        </div>
      </header>
      <nav className="toolbar">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`button ${active === id ? "dark" : "quiet"}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {active === "authors" && <AuthorRoom />}
      {active === "reviewer" && <ReviewerInbox />}
      {active === "operator" && <OperatorConsole />}
      {active === "policies" && <PolicySigner />}
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
  const [status, setStatus] = useState("");
  const [reviewer, setReviewer] = useState("reviewer");
  const [notes, setNotes] = useState({});

  async function encryptAndUpload(paper, file) {
    setStatus(`${paper.id}: đọc ${file.name} rồi mã hóa trong trình duyệt…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const policy = await policyFor(paper.id, "doc");
      const ciphertext = await encryptForRecord(bytes, `doc:${paper.id}`, policy);
      const saved = await api.putBlob(paper.id, ciphertext);
      setStatus(`${paper.id}: đã tải lên ${saved.blob_size} byte ciphertext (plaintext ${bytes.length} byte không rời trình duyệt)`);
      reload();
    } catch (e) {
      setStatus(`${paper.id}: ${describeError(e)}`);
    }
  }

  /**
   * Tạo change request "gán ps-paper-<id>-reader" từ trình duyệt của chính tác giả (plan mục 4
   * bước 1, T8). Nếu CORS/quyền chặn thì gán trong tide-console rồi dán change_request_id vào ô
   * bên dưới. Quyền chỉ có hiệu lực sau khi 2/3 tác giả duyệt.
   */
  async function invite(paper) {
    setStatus(`${paper.id}: gọi admin API để tạo change request gán ${readerRole(paper.id)} cho "${reviewer}"…`);
    try {
      const admin = new AdminAPI(IAMService.getConfig()?.realm);
      const users = await admin.getUsers({ search: reviewer });
      const user = (users ?? []).find((u) => u.username === reviewer);
      if (!user) throw new Error(`không tìm thấy user "${reviewer}" trong realm`);
      const role = await admin.getRole(readerRole(paper.id));
      const created = await admin.addUserRoles(user.id, [role]);
      const changeRequestId = created?.changeSetId ?? created?.draftRecordId ?? "";
      const invite = await api.invite(paper.id, { reviewer });
      if (changeRequestId) await api.patchInvite(invite.id, changeRequestId);
      setStatus(`${paper.id}: change request ${changeRequestId || "(không trả id — xem tide-console)"} đang PENDING. Cần 2/3 tác giả duyệt trong tide-console → QEA Approvals.`);
    } catch (e) {
      setStatus(`${paper.id}: ${describeError(e)}`);
    }
  }

  async function recordInviteManually(paper, changeRequestId) {
    try {
      const invite = await api.invite(paper.id, { reviewer });
      await api.patchInvite(invite.id, changeRequestId);
      setStatus(`${paper.id}: đã ghi lời mời với change request ${changeRequestId} (role gán trong tide-console)`);
    } catch (e) {
      setStatus(`${paper.id}: ${describeError(e)}`);
    }
  }

  async function readFeedback(paper) {
    setStatus(`${paper.id}: đang giải mã nhận xét…`);
    try {
      const policy = await policyFor(paper.id, "fb");
      const rows = await api.feedback(paper.id);
      const texts = await Promise.all(
        rows.map((row) => decryptForRecord(row.ciphertext, `fb:${paper.id}`, policy)),
      );
      setNotes((prev) => ({ ...prev, [paper.id]: texts }));
      setStatus(`${paper.id}: đã giải mã ${texts.length} nhận xét`);
    } catch (e) {
      setStatus(`${paper.id}: ${describeError(e)}`);
    }
  }

  return (
    <section className="section">
      <div className="section-heading">
        <h2>Phòng tác giả — bản thảo của nhóm</h2>
        <span className="count-pill">{papers.length} paper</span>
      </div>
      {error && <p className="empty">{error}</p>}
      {status && <p className="notice">{status}</p>}
      <label className="capacity-label">
        Người phản biện được mời
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} style={{ width: 160 }} />
      </label>
      <div className="course-grid">
        {papers.map((paper) => (
          <article className="course-card" key={paper.id}>
            <div className="course-top">
              <span className="course-code">{paper.id}</span>
              <span className={`seats ${paper.blob_size ? "open" : "full"}`}>
                {paper.blob_size ? `đã mã hóa · ${paper.blob_size} B` : "chưa mã hóa"}
              </span>
            </div>
            <h3>{paper.code_title ?? paper.id}</h3>
            <p className="course-stats">Hạn phản biện: <b>{describeDeadline(paper.review_until)}</b></p>
            <label className="capacity-label">
              Mã hóa &amp; tải lên PDF
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) encryptAndUpload(paper, file);
                  e.target.value = "";
                }}
              />
            </label>
            <button className="button outline full-width" onClick={() => invite(paper)}>
              Mời phản biện
            </button>
            <button className="button quiet full-width" onClick={() => readFeedback(paper)}>
              Đọc nhận xét
            </button>
            <ManualInvite onSubmit={(id) => recordInviteManually(paper, id)} />
            {(notes[paper.id] ?? []).map((note, i) => (
              <p className="request-reason" key={i}>“{note}”</p>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

/** Phương án lùi khi admin API bị CORS chặn (plan mục 8, G3): gán role trong tide-console rồi dán id. */
function ManualInvite({ onSubmit }) {
  const [value, setValue] = useState("");
  return (
    <div className="request-actions">
      <input
        placeholder="change_request_id từ tide-console"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: "100%" }}
      />
      <button className="button quiet" onClick={() => onSubmit(value.trim())} disabled={!value.trim()}>
        Ghi
      </button>
    </div>
  );
}

// --- 2. Hộp thư phản biện ----------------------------------------------------------------------

function ReviewerInbox() {
  const { papers, error } = usePapers();
  const [probe, setProbe] = useState("");

  async function probePaper(paperId) {
    setProbe(`đang gọi GET /api/papers/${paperId}/blob …`);
    try {
      await api.getBlob(paperId);
      setProbe(`${paperId}: 200 — backend đã trả ciphertext. Với paper không được cấp hoặc đã hết hạn thì đây là lỗi: ghi vào VERIFICATION_LOG.`);
    } catch (e) {
      setProbe(`${paperId}: ${describeError(e)}`);
    }
  }

  return (
    <section className="section">
      <div className="section-heading">
        <h2>Hộp thư phản biện — paper được cấp quyền</h2>
        <span className="count-pill">{papers.length} paper</span>
      </div>
      {error && <p className="empty">{error}</p>}
      {papers.length === 0 && (
        <p className="empty">
          Chưa có paper nào. Role `ps-paper-&lt;id&gt;-reader` chỉ vào token sau khi 2/3 tác giả duyệt
          change request và bạn bấm Refresh token.
        </p>
      )}
      {papers.map((paper) => <ReviewerPaper key={paper.id} paper={paper} />)}
      <div className="blocked-card">
        <div>
          <span className="blocked-icon">⛔</span>
          <div>
            <strong>Thử mở paper khác</strong>
            <p>{probe || "p2 không được chia sẻ → 403. p3 đã hết hạn → 403 ở backend, và ORK từ chối giải mã."}</p>
          </div>
        </div>
        <div className="request-actions">
          {PAPER_IDS.map((id) => (
            <button key={id} className="button outline" onClick={() => probePaper(id)}>
              Thử {id}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReviewerPaper({ paper }) {
  const [status, setStatus] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function openPaper() {
    setStatus("tải ciphertext rồi giải mã trong trình duyệt…");
    try {
      const policy = await policyFor(paper.id, "doc");
      const ciphertext = await api.getBlob(paper.id);
      const pdf = await decryptBytesForRecord(ciphertext, `doc:${paper.id}`, policy);
      setPdfUrl(URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })));
      setStatus(`đã giải mã ${pdf.length} byte`);
    } catch (e) {
      setStatus(describeError(e));
    }
  }

  async function sendFeedback() {
    setStatus("mã hóa nhận xét (chỉ nhóm tác giả đọc được)…");
    try {
      const policy = await policyFor(paper.id, "fb");
      const ciphertext = await encryptForRecord(note, `fb:${paper.id}`, policy);
      await api.postFeedback(paper.id, ciphertext);
      setNote("");
      setStatus("đã gửi nhận xét đã mã hóa");
    } catch (e) {
      setStatus(describeError(e));
    }
  }

  return (
    <article className="request-card">
      <div className="request-head">
        <h3>{paper.code_title ?? paper.id}</h3>
        <span className="course-code">{paper.id} · {describeDeadline(paper.review_until)}</span>
      </div>
      <button className="button dark" onClick={openPaper}>Mở bản thảo</button>
      {pdfUrl && (
        <iframe
          title={paper.id}
          src={pdfUrl}
          style={{ width: "100%", height: 520, marginTop: 12, border: 0 }}
        />
      )}
      <textarea
        className="request-reason"
        style={{ width: "100%", minHeight: 62 }}
        placeholder="Nhận xét cho nhóm tác giả (mã hóa, chỉ tác giả đọc)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="request-actions">
        <button className="button outline" onClick={sendFeedback} disabled={!note}>Gửi nhận xét</button>
        <span className="muted">{status}</span>
      </div>
    </article>
  );
}

// --- 3. Operator Console -----------------------------------------------------------------------

function OperatorConsole() {
  const [storage, setStorage] = useState(null);
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState("");
  const [extend, setExtend] = useState("");

  useEffect(() => {
    api.operatorStorage().then(setStorage).catch((e) => setStatus(describeError(e)));
  }, []);

  async function tryDecrypt(paperId) {
    setAttempt(`tải ciphertext ${paperId} từ đĩa (Operator có toàn quyền storage) rồi thử giải mã…`);
    try {
      const ciphertext = await api.operatorBlob(paperId);
      const policy = await policyFor(paperId, "doc");
      const pdf = await decryptBytesForRecord(ciphertext, `doc:${paperId}`, policy);
      setAttempt(`KHÔNG mong đợi: giải mã được ${pdf.length} byte. Ghi lại vào VERIFICATION_LOG (T9).`);
    } catch (e) {
      setAttempt(describeError(e));
    }
  }

  /** T16: Operator sửa hạn trong DB. Backend thôi chặn, nhưng hạn thật nằm trong policy đã ký. */
  async function extendP3() {
    setExtend("PATCH /api/operator/papers/p3/review-until …");
    try {
      const sevenDays = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
      const row = await api.operatorSetReviewUntil("p3", sevenDays);
      setExtend(`đã sửa DB: review_until = ${row.review_until ?? sevenDays}. Backend không còn chặn p3 — nhưng người phản biện vẫn không giải mã được: ORK kiểm tra expiry trong policy đã ký bằng threshold (T16).`);
    } catch (e) {
      setExtend(describeError(e));
    }
  }

  return (
    <section className="section">
      <div className="section-heading">
        <h2>Operator Console — người chạy server nhìn thấy gì</h2>
        <span className="count-pill">{storage?.dir ?? "…"}</span>
      </div>
      {status && <p className="empty">{status}</p>}
      <div className="audit-list">
        {(storage?.files ?? []).map((file) => (
          <div className="audit-row" key={file.name}>
            <strong>{file.name}</strong>
            <span className="audit-dot" />
            <p style={{ wordBreak: "break-all" }}>{file.head_hex}</p>
            <span className="audit-actor">
              {file.size} B · {file.is_pdf ? "LÀ %PDF (!)" : "không phải %PDF"}
            </span>
          </div>
        ))}
      </div>

      <div className="blocked-card">
        <div>
          <span className="blocked-icon">🔐</span>
          <div>
            <strong>Tải ciphertext rồi thử giải mã</strong>
            <p>{attempt || "ORK kiểm tra lại mỗi lần giải mã: không có role reader của đúng paper và không có _tide_decryptor thì bị từ chối. Lỗi thật hiện nguyên văn kèm `cause`."}</p>
          </div>
        </div>
        <div className="request-actions">
          {PAPER_IDS.map((id) => (
            <button key={id} className="button outline" onClick={() => tryDecrypt(id)}>
              Thử giải mã {id}
            </button>
          ))}
        </div>
      </div>

      <div className="blocked-card">
        <div>
          <span className="blocked-icon">⏳</span>
          <div>
            <strong>Gia hạn p3 bằng cách sửa DB</strong>
            <p>{extend || "Operator sửa được cột review_until trong SQLite. Hạn thật nằm trong policy đã ký: mạng ORK vẫn từ chối."}</p>
          </div>
        </div>
        <button className="button outline" onClick={extendP3}>Gia hạn p3 (+7 ngày)</button>
      </div>

      <div className="demo-warning">
        <span>TỰ CẤP QUYỀN</span>
        Gán `ps-paper-p2-reader` cho chính mình trong tide-console chỉ tạo một change request
        PENDING: phiếu tính cho người gọi HTTP, và Operator không phải `tide-realm-admin` nên không
        duyệt được. Mở tide-console → QEA Approvals để xem.
      </div>
    </section>
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
    const note = (text) => setStatus((prev) => ({ ...prev, [grant.name]: text }));

    note("mở enclave để duyệt…");
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
      .then(() => note(`đã ký và lưu ${recordId} cho Role ${subject}`))
      .catch((e) => note(describeError(e)));
  }

  return (
    <section className="section">
      <div className="section-heading">
        <h2>Ký policy RelationshipAttestation:1</h2>
        <span className="approval-badge">chỉ tide-realm-admin · bước chuẩn bị</span>
      </div>
      <div className="request-form">
        <div className="form-grid">
          <label className="reason-field">
            Admin policy (base64, lấy từ /admin/realms/&lt;realm&gt;/iga/role-policies/name/tide-realm-admin)
            <textarea value={adminPolicy} onChange={(e) => setAdminPolicy(e.target.value)} />
          </label>
          <label>Hạn phản biện p1
            <input
              type="datetime-local"
              value={deadlines.p1}
              onChange={(e) => setDeadlines((prev) => ({ ...prev, p1: e.target.value }))}
            />
          </label>
          <label>Hạn phản biện p3 (đặt trong quá khứ)
            <input
              type="datetime-local"
              value={deadlines.p3}
              onChange={(e) => setDeadlines((prev) => ({ ...prev, p3: e.target.value }))}
            />
          </label>
        </div>
      </div>
      <div className="reason-list">
        {GRANTS.map((grant) => (
          <div className="reason-item" key={grant.name}>
            <span className="approved-tag">{grant.name}</span>
            <div style={{ flex: 1 }}>
              <strong>
                {grant.record}:{grant.paper} · Role{" "}
                {grant.subject === "reader" ? readerRole(grant.paper) : AUTHOR_ROLE} · {grant.access}
                {grant.expires ? ` · hạn ${deadlines[grant.paper]}` : " · không hạn"}
              </strong>
              <p>{status[grant.name] ?? ""}</p>
            </div>
            <button className="button dark" onClick={() => sign(grant)} disabled={!adminPolicy.trim()}>
              Ký
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
