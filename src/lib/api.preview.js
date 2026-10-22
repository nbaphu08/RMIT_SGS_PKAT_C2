// api.preview.js — backend giả lập cho Plan C, thay api.js. Thực thi đúng các luật của
// server/routes/*.js (plan mục 5.2), chỉ khác là chạy trong trình duyệt thay vì Express.
//
// Quan trọng: quyền đọc từ ROLE TRONG TOKEN (realm giả lập), KHÔNG đọc từ DB. Nên Operator sửa
// bảng `papers` trong db.js cũng không tự cấp quyền cho mình được — đúng như backend thật (T14).
import { audit, getBlob, listBlobs, putBlob, read, update } from "./mock/db.js";
import { ADMIN_ROLE, denyReason, hasAuthorRole, hasReaderRole } from "../../shared/authz.js";
import { currentToken, tokenExpired } from "./mock/realm.js";

export class ApiError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? ` — ${body}` : ""}`);
    this.status = status;
    this.body = body;
  }
}

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function auth() {
  const token = currentToken();
  if (!token) throw new ApiError(401, "missing Authorization header");
  // Token quá hạn là 401, không phải 403: đây là lý do thu hồi quyền có độ trễ bằng đúng
  // vòng đời token — quyền bị gỡ chỉ chặn từ lần cấp token sau (T10).
  if (tokenExpired(token)) throw new ApiError(401, "token expired");
  return token;
}

const isAuthor = (t) => hasAuthorRole(t.roles);
const isReaderOf = (t, paperId) => hasReaderRole(t.roles, paperId);
const isApprover = (t) => t.roles.includes(ADMIN_ROLE);

/** Cùng một hàm với backend thật (shared/authz.js) — không còn hai bản sao để lệch nhau. */
const readDenial = (token, paper) => denyReason(token.roles, paper);

function requireRole(token, role) {
  if (!token.roles.includes(role)) throw new ApiError(403, `missing role ${role}`);
}

function paperOr404(state, id) {
  const paper = state.papers[id];
  if (!paper) throw new ApiError(404, "no such paper");
  return paper;
}

export const api = {
  me: async () => {
    await delay();
    const token = auth();
    return {
      sub: `sim-${token.username}`,
      tideuserkey: `sim-key-${token.username}`,
      username: token.username,
      roles: token.roles,
      is_approver: isApprover(token),
    };
  },

  papers: async () => {
    await delay();
    const token = auth();
    const rows = Object.values(read().papers);
    return isAuthor(token) ? rows : rows.filter((p) => isReaderOf(token, p.id));
  },

  policies: async (paperId, record) => {
    await delay();
    const token = auth();
    const state = read();
    const paper = paperOr404(state, paperId);
    const reason = readDenial(token, paper);
    if (reason) throw new ApiError(403, reason);
    const rows = state.policies[`${record}:${paperId}`] ?? [];
    return rows.filter((p) =>
      p.subject_kind === "User" ? p.subject === `sim-key-${token.username}` : token.roles.includes(p.subject),
    );
  },

  savePolicy: async (paperId, body) => {
    await delay();
    const token = auth();
    if (!isApprover(token)) throw new ApiError(403, "missing tide-realm-admin");
    return update((state) => {
      paperOr404(state, paperId);
      const key = `${body.record}:${paperId}`;
      state.policies[key] = [
        ...(state.policies[key] ?? []).filter((p) => p.subject !== body.subject),
        { subject_kind: body.subject_kind, subject: body.subject, policy: body.policy },
      ];
      audit(state, token.username, "POST policy", key, "200");
      return { record: key, subject_kind: body.subject_kind, subject: body.subject };
    });
  },

  putBlob: async (paperId, ciphertext) => {
    await delay();
    const token = auth();
    requireRole(token, "ps-author");
    if (ciphertext.length > 15 * 1024 * 1024) throw new ApiError(413, "payload too large");
    await putBlob(paperId, ciphertext);
    return update((state) => {
      const paper = paperOr404(state, paperId);
      paper.blob_size = ciphertext.length;
      paper.updated_at = new Date().toISOString();
      audit(state, token.username, "PUT blob", `doc:${paperId}`, "200");
      return { id: paperId, blob_size: ciphertext.length };
    });
  },

  getBlob: async (paperId) => {
    await delay();
    const token = auth();
    const state = read();
    const paper = paperOr404(state, paperId);
    const reason = readDenial(token, paper);
    if (reason) {
      update((s) => audit(s, token.username, "GET blob", `doc:${paperId}`, "403"));
      throw new ApiError(403, reason);
    }
    const blob = await getBlob(paperId);
    if (!blob) throw new ApiError(404, "not uploaded yet");
    update((s) => audit(s, token.username, "GET blob", `doc:${paperId}`, "200"));
    return blob;
  },

  postFeedback: async (paperId, ciphertext) => {
    await delay();
    const token = auth();
    const state = read();
    const paper = paperOr404(state, paperId);
    if (isAuthor(token)) throw new ApiError(403, "authors do not submit feedback");
    const reason = readDenial(token, paper);
    if (reason) throw new ApiError(403, reason);
    return update((s) => {
      s.feedback[paperId] = [
        ...(s.feedback[paperId] ?? []),
        { id: (s.feedback[paperId]?.length ?? 0) + 1, ciphertext, created_at: new Date().toISOString() },
      ];
      audit(s, token.username, "POST feedback", `fb:${paperId}`, "200");
      return { ok: true };
    });
  },

  feedback: async (paperId) => {
    await delay();
    const token = auth();
    if (!isAuthor(token)) throw new ApiError(403, "missing role ps-author");
    return read().feedback[paperId] ?? [];
  },

  invite: async (paperId, body) => {
    await delay();
    const token = auth();
    requireRole(token, "ps-author");
    return update((state) => {
      paperOr404(state, paperId);
      const row = { id: state.invites.length + 1, paper_id: paperId, reviewer: body.reviewer, status: "requested" };
      state.invites.push(row);
      audit(state, token.username, "POST invite", `doc:${paperId}`, "200");
      return row;
    });
  },

  patchInvite: async (inviteId, changeRequestId) => {
    await delay();
    const token = auth();
    if (!isApprover(token)) throw new ApiError(403, "missing tide-realm-admin");
    return update((state) => {
      const row = state.invites.find((i) => i.id === inviteId);
      if (!row) throw new ApiError(404, "no such invite");
      row.change_request_id = changeRequestId;
      row.status = "pending";
      return row;
    });
  },

  // --- Operator: CỐ Ý cho đủ quyền hạ tầng (plan mục 5.2) ---
  operatorStorage: async () => {
    await delay();
    const token = auth();
    requireRole(token, "ps-operator");
    return {
      dir: "server/data/blobs (simulated)",
      files: (await listBlobs()).map(([id, b64]) => {
        const head = atob(b64).slice(0, 32);
        return {
          name: `doc-${id}.bin`,
          size: atob(b64).length,
          head_hex: [...head].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
          is_pdf: head.startsWith("%PDF"),
        };
      }),
    };
  },

  operatorBlob: async (paperId) => {
    await delay();
    const token = auth();
    requireRole(token, "ps-operator");
    const blob = await getBlob(paperId);
    if (!blob) throw new ApiError(404, "not uploaded yet");
    return blob;
  },

  operatorPolicies: async (paperId) => {
    await delay();
    const token = auth();
    requireRole(token, "ps-operator");
    return read().policies[`doc:${paperId}`] ?? [];
  },

  /** Operator sửa được hạn trong DB — nhưng hạn thật nằm trong policy đã ký (T16). */
  operatorSetReviewUntil: async (paperId, reviewUntil) => {
    await delay();
    const token = auth();
    requireRole(token, "ps-operator");
    return update((state) => {
      const paper = paperOr404(state, paperId);
      paper.review_until = reviewUntil;
      audit(state, token.username, "PATCH review_until", `doc:${paperId}`, "200 (by design)");
      return { id: paperId, review_until: reviewUntil };
    });
  },

  audit: async () => {
    await delay();
    const token = auth();
    if (!isAuthor(token) && !token.roles.includes("ps-operator")) {
      throw new ApiError(403, "missing role ps-author or ps-operator");
    }
    return read().audit;
  },
};

export async function policyFor(paperId, record) {
  const [first] = await api.policies(paperId, record);
  if (!first) {
    throw new Error(`chưa có policy ${record}:${paperId} cho người này — một tác giả phải ký trước (tab Ký policy)`);
  }
  return first.policy;
}

export function describeError(err) {
  if (err instanceof ApiError) return err.message;
  const cause = err?.cause;
  const causeText = cause ? (cause.message ?? String(cause)) : "";
  return causeText ? `${err.message} — cause: ${causeText}` : String(err?.message ?? err);
}
