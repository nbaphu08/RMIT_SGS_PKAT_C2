import { useCallback, useEffect, useState } from "react";
import { Authenticated, Unauthenticated, useAuthCallback, useTideCloak } from "@tidecloak/react";
import { api, describeError, policyFor } from "./lib/api.js";
import { synthTrackWav } from "./lib/audio.js";
import {
  decryptBytesForRecord,
  decryptForRecord,
  encryptForRecord,
  signRelationshipPolicy,
} from "./lib/relationship.js";

const TABS = [
  ["studio", "Studio (Owner)"],
  ["reviewer", "Reviewer"],
  ["operator", "Operator Console"],
];

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
        <h1 style={{ fontSize: 34 }}>Unreleased Studio</h1>
        <p>Chia sẻ đúng một track chưa phát hành. Các track còn lại không ai mở được một mình.</p>
        <button className="button dark" onClick={login}>Đăng nhập bằng Tide</button>
      </div>
    </div>
  );
}

function Shell() {
  const [tab, setTab] = useState("studio");
  return (
    <div className="shell">
      <IdentityBar />
      <nav className="toolbar">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`button ${tab === id ? "dark" : "quiet"}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "studio" && <Studio />}
      {tab === "reviewer" && <Reviewer />}
      {tab === "operator" && <OperatorConsole />}
    </div>
  );
}

/** Thanh trạng thái danh tính: tên, roles trong token, Refresh token (plan mục 5.3). */
function IdentityBar() {
  const { logout, forceRefreshToken, getValueFromToken } = useTideCloak();
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState("");

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

  const roles = me?.roles ?? [];
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">U</span> Unreleased Studio
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
  );
}

function useTracks() {
  const [tracks, setTracks] = useState([]);
  const [error, setError] = useState("");
  const reload = useCallback(
    () => api.tracks().then(setTracks).catch((e) => setError(describeError(e))),
    [],
  );
  useEffect(() => { reload(); }, [reload]);
  return { tracks, error, reload };
}

// --- 1. Studio (Owner) -------------------------------------------------------------------------

function Studio() {
  const { tracks, error, reload } = useTracks();
  const [status, setStatus] = useState("");
  const [reviewer, setReviewer] = useState("reviewer");
  const [notes, setNotes] = useState({});

  async function encryptAndUpload(track) {
    setStatus(`${track.id}: sinh audio tổng hợp rồi mã hóa trong trình duyệt…`);
    try {
      const policy = await policyFor(track.id, "trk");
      const wav = synthTrackWav(track.id);
      const ciphertext = await encryptForRecord(wav, `trk:${track.id}`, policy);
      const saved = await api.putBlob(track.id, ciphertext);
      setStatus(`${track.id}: đã tải lên ${saved.blob_size} byte ciphertext (plaintext ${wav.length} byte không rời trình duyệt)`);
      reload();
    } catch (e) {
      setStatus(`${track.id}: ${describeError(e)}`);
    }
  }

  async function share(track) {
    try {
      const req = await api.share(track.id, reviewer);
      setStatus(`${track.id}: đã gửi yêu cầu chia sẻ #${req.id} cho "${reviewer}". Quyền chỉ có hiệu lực khi 2/3 approver duyệt CR trong tide-console.`);
    } catch (e) {
      setStatus(`${track.id}: ${describeError(e)}`);
    }
  }

  async function readFeedback(track) {
    setStatus(`${track.id}: đang giải mã feedback…`);
    try {
      const policy = await policyFor(track.id, "fb");
      const rows = await api.feedback(track.id);
      const texts = await Promise.all(
        rows.map((row) => decryptForRecord(row.ciphertext, `fb:${track.id}`, policy)),
      );
      setNotes((prev) => ({ ...prev, [track.id]: texts }));
      setStatus(`${track.id}: đã giải mã ${texts.length} feedback`);
    } catch (e) {
      setStatus(`${track.id}: ${describeError(e)}`);
    }
  }

  return (
    <section className="section">
      <div className="section-heading">
        <h2>Studio — kho của nghệ sĩ</h2>
        <span className="count-pill">{tracks.length} track</span>
      </div>
      {error && <p className="empty">{error}</p>}
      {status && <p className="notice">{status}</p>}
      <label className="capacity-label">
        Reviewer nhận chia sẻ
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} style={{ width: 160 }} />
      </label>
      <div className="course-grid">
        {tracks.map((track) => (
          <article className="course-card" key={track.id}>
            <div className="course-top">
              <span className="course-code">{track.id}</span>
              <span className={`seats ${track.blob_size ? "open" : "full"}`}>
                {track.blob_size ? `đã mã hóa · ${track.blob_size} B` : "chưa mã hóa"}
              </span>
            </div>
            <h3>{track.title}</h3>
            <button className="button dark full-width" onClick={() => encryptAndUpload(track)}>
              Mã hóa &amp; tải lên
            </button>
            <button className="button outline full-width" onClick={() => share(track)}>
              Chia sẻ với Reviewer
            </button>
            <button className="button quiet full-width" onClick={() => readFeedback(track)}>
              Đọc feedback
            </button>
            {(notes[track.id] ?? []).map((note, i) => (
              <p className="request-reason" key={i}>“{note}”</p>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

// --- 2. Reviewer -------------------------------------------------------------------------------

function Reviewer() {
  const { tracks, error } = useTracks();
  const [probe, setProbe] = useState("");

  async function tryOtherTrack() {
    setProbe("đang gọi GET /api/tracks/t2/blob …");
    try {
      await api.getBlob("t2");
      setProbe("200 — KHÔNG mong đợi: backend đã trả ciphertext t2 cho reviewer.");
    } catch (e) {
      setProbe(describeError(e));
    }
  }

  return (
    <section className="section">
      <div className="section-heading">
        <h2>Reviewer — track được cấp quyền</h2>
        <span className="count-pill">{tracks.length} track</span>
      </div>
      {error && <p className="empty">{error}</p>}
      {tracks.length === 0 && (
        <p className="empty">Chưa có track nào. Role `us-trk-&lt;id&gt;-reviewer` chỉ vào token sau khi 2/3 approver duyệt và bạn bấm Refresh token.</p>
      )}
      {tracks.map((track) => <ReviewerTrack key={track.id} track={track} />)}
      <div className="blocked-card">
        <div>
          <span className="blocked-icon">⛔</span>
          <div>
            <strong>Thử mở t2 bằng API</strong>
            <p>{probe || "Track không được chia sẻ phải trả 403 từ backend."}</p>
          </div>
        </div>
        <button className="button outline" onClick={tryOtherTrack}>Thử mở t2</button>
      </div>
    </section>
  );
}

function ReviewerTrack({ track }) {
  const [status, setStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  async function play() {
    setStatus("tải ciphertext rồi giải mã trong trình duyệt…");
    try {
      const policy = await policyFor(track.id, "trk");
      const ciphertext = await api.getBlob(track.id);
      const wav = await decryptBytesForRecord(ciphertext, `trk:${track.id}`, policy);
      setAudioUrl(URL.createObjectURL(new Blob([wav], { type: "audio/wav" })));
      setStatus(`đã giải mã ${wav.length} byte`);
    } catch (e) {
      setStatus(describeError(e));
    }
  }

  async function sendFeedback() {
    setStatus("mã hóa feedback (chỉ Owner đọc được)…");
    try {
      const policy = await policyFor(track.id, "fb");
      const ciphertext = await encryptForRecord(note, `fb:${track.id}`, policy);
      await api.postFeedback(track.id, ciphertext);
      setNote("");
      setStatus("đã gửi feedback đã mã hóa");
    } catch (e) {
      setStatus(describeError(e));
    }
  }

  return (
    <article className="request-card">
      <div className="request-head">
        <h3>{track.title}</h3>
        <span className="course-code">{track.id}</span>
      </div>
      <button className="button dark" onClick={play}>Play</button>
      {audioUrl && <audio controls src={audioUrl} style={{ width: "100%", marginTop: 12 }} />}
      <textarea
        className="request-reason"
        style={{ width: "100%", minHeight: 62 }}
        placeholder="Feedback cho nghệ sĩ (mã hóa, chỉ Owner đọc)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="request-actions">
        <button className="button outline" onClick={sendFeedback} disabled={!note}>Gửi feedback</button>
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

  useEffect(() => {
    api.operatorStorage().then(setStorage).catch((e) => setStatus(describeError(e)));
  }, []);

  async function tryDecryptT2() {
    setAttempt("tải ciphertext t2 từ đĩa (Operator có toàn quyền storage) rồi thử giải mã…");
    try {
      const ciphertext = await api.operatorBlob("t2");
      const policy = await policyFor("t2", "trk");
      const wav = await decryptBytesForRecord(ciphertext, "trk:t2", policy);
      setAttempt(`KHÔNG mong đợi: giải mã được ${wav.length} byte. Ghi lại vào VERIFICATION_LOG (T9).`);
    } catch (e) {
      setAttempt(describeError(e));
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
              {file.size} B · {file.is_wav ? "LÀ WAV (!)" : "không phải WAV"}
            </span>
          </div>
        ))}
      </div>

      <div className="blocked-card">
        <div>
          <span className="blocked-icon">🔐</span>
          <div>
            <strong>Tải ciphertext t2 và giải mã</strong>
            <p>{attempt || "ORK kiểm tra lại mỗi lần giải mã: không có role us-trk-t2-reviewer và không có _tide_decryptor thì bị từ chối. Lỗi thật hiện nguyên văn kèm `cause`."}</p>
          </div>
        </div>
        <button className="button outline" onClick={tryDecryptT2}>Thử giải mã t2</button>
      </div>

      <div className="demo-warning">
        <span>TỰ CẤP QUYỀN</span>
        Gán `us-trk-t2-reviewer` cho chính mình trong tide-console chỉ tạo một change request
        PENDING 1/2: phiếu tính cho người gọi HTTP, nên cần thêm một approver khác. Mở
        tide-console → QEA Approvals để xem.
      </div>

      <PolicySigner />
    </section>
  );
}

/** Khu ký policy — chỉ approver, dùng ở bước chuẩn bị M2 (plan mục 3.3, 5.3). */
function PolicySigner() {
  const { getVendorId } = useTideCloak();
  const [form, setForm] = useState({
    trackId: "t1",
    record: "trk",
    subjectKind: "User",
    subject: "",
    access: "read",
    adminPolicy: "",
  });
  const [status, setStatus] = useState("");
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function sign() {
    setStatus("mở enclave để duyệt…");
    try {
      const adminPolicy = Uint8Array.from(atob(form.adminPolicy.trim()), (c) => c.charCodeAt(0));
      const policy = await signRelationshipPolicy(
        {
          vendorId: getVendorId(),
          subject: { type: form.subjectKind, id: form.subject.trim() },
          recordId: `${form.record}:${form.trackId}`,
          access: form.access,
        },
        adminPolicy,
      );
      await api.savePolicy(form.trackId, {
        record: form.record,
        subject_kind: form.subjectKind,
        subject: form.subject.trim(),
        policy,
      });
      setStatus(`đã ký và lưu policy ${form.record}:${form.trackId}`);
    } catch (e) {
      setStatus(describeError(e));
    }
  }

  return (
    <div className="request-form">
      <div className="form-title">
        <h3>Ký policy RelationshipAttestation:1</h3>
        <span className="approval-badge">chỉ tide-realm-admin</span>
      </div>
      <div className="form-grid">
        <label>Track
          <select value={form.trackId} onChange={set("trackId")}>
            {["t1", "t2", "t3"].map((id) => <option key={id}>{id}</option>)}
          </select>
        </label>
        <label>Record
          <select value={form.record} onChange={set("record")}>
            <option value="trk">trk (audio)</option>
            <option value="fb">fb (feedback)</option>
          </select>
        </label>
        <label>Subject
          <select value={form.subjectKind} onChange={set("subjectKind")}>
            <option>User</option>
            <option>Role</option>
          </select>
        </label>
        <label>Quyền
          <select value={form.access} onChange={set("access")}>
            <option value="read">read (decrypt)</option>
            <option value="write">write (encrypt)</option>
            <option value="read-write">read-write</option>
          </select>
        </label>
        <label className="reason-field">
          {form.subjectKind === "User" ? "tideuserkey của NGƯỜI ĐƯỢC CẤP" : "tên realm role, ví dụ us-trk-t1-reviewer"}
          <textarea value={form.subject} onChange={set("subject")} />
        </label>
        <label className="reason-field">
          Admin policy (base64, lấy từ /admin/realms/&lt;realm&gt;/iga/role-policies/name/tide-realm-admin)
          <textarea value={form.adminPolicy} onChange={set("adminPolicy")} />
        </label>
      </div>
      <div className="form-footer">
        <span>{status}</span>
        <button className="button dark" onClick={sign} disabled={!form.subject || !form.adminPolicy}>
          Ký policy
        </button>
      </div>
    </div>
  );
}
