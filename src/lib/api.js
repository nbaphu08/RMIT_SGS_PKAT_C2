// Gọi backend (plan mục 5.2) qua IAMService.secureFetch: tự gắn DPoP proof + nonce.
// Dev: Vite proxy /api sang backend của B (xem vite.config.js). Hình dạng body khớp server/routes/*.
import { IAMService } from "@tidecloak/js";

export class ApiError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? ` — ${body}` : ""}`);
    this.status = status;
    this.body = body;
  }
}

async function request(path, init = {}) {
  const token = await IAMService.getToken();
  const res = await IAMService.secureFetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new ApiError(res.status, (await res.text()).slice(0, 300));
  return res;
}

const json = async (path, init) => (await request(path, init)).json();
const text = async (path, init) => (await request(path, init)).text();
const sendJson = (method) => (path, body) =>
  json(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const postJson = sendJson("POST");
const patchJson = sendJson("PATCH");

export const api = {
  /** -> { sub, tideuserkey, username, roles } */
  me: () => json("/api/me"),
  /** Tác giả: cả 3; người khác: chỉ paper có role reader -> [{ id, code_title, review_until, blob_size, updated_at }] */
  papers: async () => (await json("/api/papers")).papers,
  /** Chỉ trả policy khớp người gọi -> [{ subject_kind, subject, policy }] */
  policies: async (paperId, record) => (await json(`/api/papers/${paperId}/policy?for=${record}`)).policies,
  savePolicy: (paperId, body) => postJson(`/api/papers/${paperId}/policies`, body),
  putBlob: (paperId, ciphertext) =>
    json(`/api/papers/${paperId}/blob`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: ciphertext,
    }),
  getBlob: (paperId) => text(`/api/papers/${paperId}/blob`),
  postFeedback: (paperId, ciphertext) => postJson(`/api/papers/${paperId}/feedback`, { ciphertext }),
  /** -> [{ id, ciphertext, created_at }] */
  feedback: async (paperId) => (await json(`/api/papers/${paperId}/feedback`)).feedback,
  /** Ghi lời mời + change_request_id (chỉ để hiển thị; quyền thật do QEA quyết) */
  invite: (paperId, body) => postJson(`/api/papers/${paperId}/invites`, body),
  /** -> { dir, files: [{ name, size, head_hex, is_pdf }] } */
  operatorStorage: () => json("/api/operator/storage"),
  operatorBlob: (paperId) => text(`/api/operator/blob/${paperId}`),
  /** Operator sửa hạn trong DB — cố ý mở, phục vụ T16 */
  operatorSetReviewUntil: (paperId, reviewUntil) =>
    patchJson(`/api/operator/papers/${paperId}/review-until`, { review_until: reviewUntil }),
};

/** Chỉ có một policy khớp mỗi record; lấy cái đầu tiên, báo rõ nếu chưa ký. */
export async function policyFor(paperId, record) {
  const [first] = await api.policies(paperId, record);
  if (!first) {
    throw new Error(`chưa có policy ${record}:${paperId} cho người này — một tác giả phải ký trước (tab Ký policy)`);
  }
  return first.policy;
}

/** Lỗi từ mạng ORK: thông điệp thật của contract nằm trong `cause` (plan mục 10). Không retry. */
export function describeError(err) {
  if (err instanceof ApiError) return err.message;
  const cause = err?.cause;
  const causeText = cause ? (cause.message ?? String(cause)) : "";
  return causeText ? `${err.message} — cause: ${causeText}` : String(err?.message ?? err);
}
