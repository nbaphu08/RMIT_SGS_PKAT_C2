// relationship.preview.js — thay relationship.js khi chạy Plan C. Giữ nguyên chữ ký hàm của bản
// thật; mọi lời gọi đi qua mock/ork.js, nơi thực thi policy đã ký (role + tag + expiry).
//
// Khác bản thật: chữ ký ngưỡng và mật mã là mô phỏng (ork.js nói rõ). Luật thì giống hệt.
import { orkDecrypt, orkEncrypt, readPolicy, signPolicy } from "./mock/ork.js";
import { currentToken } from "./mock/realm.js";

export const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1 (simulated)";

const roles = () => currentToken()?.roles ?? [];

/** Ký policy: thật thì mở enclave của một tide-realm-admin; ở đây kiểm role rồi đóng dấu. */
export async function signRelationshipPolicy(grant) {
  if (!roles().includes("tide-realm-admin")) {
    throw new Error("Could not reach enough VVK ORKs", {
      cause: new Error("chỉ tide-realm-admin ký được policy"),
    });
  }
  return signPolicy({
    subject: grant.subject.id,
    recordId: grant.recordId,
    access: grant.access,
    expiry: grant.expiry,
  });
}

export async function encryptForRecord(data, recordId, signedPolicyB64) {
  return orkEncrypt(data, recordId, signedPolicyB64, roles());
}

export async function decryptBytesForRecord(encrypted, recordId, signedPolicyB64) {
  return orkDecrypt(encrypted, recordId, signedPolicyB64, roles());
}

export async function decryptForRecord(encrypted, recordId, signedPolicyB64) {
  return new TextDecoder().decode(orkDecrypt(encrypted, recordId, signedPolicyB64, roles()));
}

export function describeRelationshipPolicy(signedPolicyB64) {
  const p = readPolicy(signedPolicyB64);
  return `${p.recordId} · Role ${p.subject} · ${p.access}${p.expiry ? ` · hạn ${new Date(p.expiry * 1000).toLocaleString("en-GB")}` : " · không hạn"}`;
}
