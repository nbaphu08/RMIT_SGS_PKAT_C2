// ork.js — mạng ORK giả lập cho Plan C. Đây là lớp quan trọng nhất của bản mô phỏng: nó thực thi
// policy đã ký, nên Operator sửa DB hay sửa backend cũng không mở được paper (plan mục 3.4, T9/T16).
//
// Policy `RelationshipAttestation:1` thật gắn ĐÚNG MỘT tag = recordId, có `roles` (encrypt/decrypt)
// và `expiry`; ORK kiểm `expiry` TRƯỚC khi chạy contract [PACK]. Bản giả giữ nguyên các luật đó.
//
// Chữ ký ngưỡng thật không mô phỏng được bằng JS trong trình duyệt (cần mạng ORK chia khóa).
// Bản giả đánh dấu policy là "đã ký" và từ chối policy bị sửa — đủ để chứng minh luật, không
// phải để chứng minh mật mã. README nói rõ điều này.

import { DECRYPT_ROLE, ENCRYPT_ROLE } from "./realm.js";

// Chia khối 32 KB — spread cả PDF 1,7 MB vào String.fromCharCode là RangeError (xem relationship.js).
const b64 = {
  encode: (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  },
  decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Dấu "đã ký bởi ngưỡng": đổi một byte trong policy là dấu này sai, ORK từ chối. */
function sealOf(policy) {
  const body = JSON.stringify([policy.subject, policy.recordId, policy.access, policy.expiry ?? 0]);
  let h = 2166136261;
  for (const ch of body) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}

/** Lỗi mang hình dạng lỗi thật của ORK: thông điệp chung, lý do thật nằm trong `cause` [PACK]. */
function orkDenial(reason) {
  return new Error("Could not reach enough VVK ORKs", { cause: new Error(reason) });
}

/** Ký policy (bước chuẩn bị, tab Ký policy). Thật: enclave của một tide-realm-admin. */
export function signPolicy({ subject, recordId, access, expiry }) {
  const policy = { subject, recordId, access, expiry: expiry ?? null };
  policy.seal = sealOf(policy);
  return b64.encode(enc.encode(JSON.stringify(policy)));
}

export function readPolicy(signedPolicyB64) {
  let policy;
  try {
    policy = JSON.parse(dec.decode(b64.decode(signedPolicyB64)));
  } catch {
    throw orkDenial("policy không đọc được — không phải policy do ORK ký");
  }
  if (policy.seal !== sealOf(policy)) {
    throw orkDenial("chữ ký ngưỡng của policy không khớp — policy đã bị sửa sau khi ký");
  }
  return policy;
}

/**
 * Luật ORK, kiểm theo đúng thứ tự thật: policy hợp lệ → đúng tag → còn hạn → đúng role.
 * `roles` là role trong TOKEN của người gọi, không phải trong DB: Operator sửa DB không ăn thua.
 */
function authorize(signedPolicyB64, recordId, roles, need) {
  const policy = readPolicy(signedPolicyB64);
  if (policy.recordId !== recordId) {
    throw orkDenial(`policy này dành cho ${policy.recordId}, không phải ${recordId}`);
  }
  if (policy.expiry && Date.now() > policy.expiry * 1000) {
    throw orkDenial(
      `hạn trong policy đã ký là ${new Date(policy.expiry * 1000).toLocaleString("en-GB")} — đã qua. ` +
        `Hạn nằm trong policy, không nằm trong database: sửa DB không gia hạn được.`,
    );
  }
  if (!roles.includes(policy.subject)) {
    throw orkDenial(`người gọi không có role ${policy.subject} mà policy ${recordId} yêu cầu`);
  }
  const tideRole = need === "decrypt" ? DECRYPT_ROLE : ENCRYPT_ROLE;
  if (!roles.includes(tideRole)) throw orkDenial(`người gọi không có realm role ${tideRole}`);
  const allowed = policy.access === "read-write" || (need === "decrypt" ? policy.access === "read" : policy.access === "write");
  if (!allowed) throw orkDenial(`policy ${recordId} chỉ cho '${policy.access}', không cho ${need}`);
  return policy;
}

export function orkEncrypt(data, recordId, signedPolicyB64, roles) {
  authorize(signedPolicyB64, recordId, roles, "encrypt");
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  // "Mã hóa": đóng gói kèm recordId để giải mã còn kiểm được tag. KHÔNG phải mật mã thật.
  return b64.encode(enc.encode(JSON.stringify({ recordId, data: b64.encode(bytes) })));
}

export function orkDecrypt(ciphertextB64, recordId, signedPolicyB64, roles) {
  authorize(signedPolicyB64, recordId, roles, "decrypt");
  let box;
  try {
    box = JSON.parse(dec.decode(b64.decode(ciphertextB64)));
  } catch {
    throw orkDenial("ciphertext hỏng");
  }
  if (box.recordId !== recordId) throw orkDenial(`ciphertext gắn tag ${box.recordId}, không phải ${recordId}`);
  return b64.decode(box.data);
}
