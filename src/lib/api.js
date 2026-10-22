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
const postJson = (path, body) =>
  json(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  /** -> { sub, tideuserkey, username, roles, is_approver } */
  me: () => json("/api/me"),
  /** -> [{ id, title, blob_size, updated_at }] */
  tracks: async () => (await json("/api/tracks")).tracks,
  /** Chỉ trả policy khớp người gọi -> [{ subject_kind, subject, policy }] */
  policies: async (trackId, record) => (await json(`/api/tracks/${trackId}/policy?for=${record}`)).policies,
  savePolicy: (trackId, body) => postJson(`/api/tracks/${trackId}/policies`, body),
  putBlob: (trackId, ciphertext) =>
    json(`/api/tracks/${trackId}/blob`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: ciphertext,
    }),
  getBlob: (trackId) => text(`/api/tracks/${trackId}/blob`),
  postFeedback: (trackId, ciphertext) => postJson(`/api/tracks/${trackId}/feedback`, { ciphertext }),
  /** -> [{ id, ciphertext, created_at }] */
  feedback: async (trackId) => (await json(`/api/tracks/${trackId}/feedback`)).feedback,
  share: (trackId, reviewer) => postJson(`/api/tracks/${trackId}/shares`, { reviewer }),
  /** -> { dir, files: [{ name, size, head_hex, is_wav }] } */
  operatorStorage: () => json("/api/operator/storage"),
  operatorBlob: (trackId) => text(`/api/operator/blob/${trackId}`),
};

/** Chỉ có một policy khớp mỗi record; lấy cái đầu tiên, báo rõ nếu chưa ký. */
export async function policyFor(trackId, record) {
  const [first] = await api.policies(trackId, record);
  if (!first) throw new Error(`chưa có policy ${record}:${trackId} cho người này — approver phải ký trước (M2)`);
  return first.policy;
}

/** Lỗi từ mạng ORK: thông điệp thật của contract nằm trong `cause` (plan mục 9). Không retry. */
export function describeError(err) {
  if (err instanceof ApiError) return err.message;
  const cause = err?.cause;
  const causeText = cause ? (cause.message ?? String(cause)) : "";
  return causeText ? `${err.message} — cause: ${causeText}` : String(err?.message ?? err);
}
