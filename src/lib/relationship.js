// relationship.js — chép từ .tide-pack/templates/relationship-attestation/relationship.ts,
// bỏ kiểu TypeScript và thêm đường đi cho Uint8Array (PDF nhị phân, plan mục 5.1).
//
// Dùng contract có sẵn của ORK `RelationshipAttestation:1`: policy nói ai (User/Group/Role) được
// encrypt/decrypt dữ liệu gắn đúng MỘT tag = recordId. Không viết contract mới.
//
// Chỉ chạy trong trình duyệt: mọi lời gọi cần credential của người đang đăng nhập, nằm trong enclave.
//
// Bị từ chối sẽ hiện ra là `Could not reach enough VVK ORKs`. Đó KHÔNG phải sự cố mạng:
// thông điệp thật của contract nằm trong `error.cause`. Không retry.
import { IAMService } from "@tidecloak/js";
import { Models } from "@tideorg/js";
import { PolicySignRequest } from "heimdall-tide";

// Contract quy định sẵn. Đổi bất kỳ giá trị nào là mạng từ chối.
export const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1";
export const RELATIONSHIP_MODEL_IDS = ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"];
export const ENCRYPT_ROLE = "_tide_encryptor"; // REALM role
export const DECRYPT_ROLE = "_tide_decryptor";

const ROLES_FOR = {
  read: [DECRYPT_ROLE],
  write: [ENCRYPT_ROLE],
  "read-write": [ENCRYPT_ROLE, DECRYPT_ROLE],
};
const SIGN_REQUEST_EXPIRY_SECONDS = 604800;

function tc() {
  const client = IAMService._tc;
  if (!client) throw new Error("TideCloak chưa khởi tạo: phải gọi IAMService.initIAM trước");
  return client;
}

// Chia khối 32 KB: `String.fromCharCode(...b)` với PDF ~1,7 MB là RangeError (đo 2026-10-22,
// "Maximum call stack size exceeded") vì spread đẩy hàng triệu đối số vào stack.
const toBase64 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// --- ai đang đăng nhập ------------------------------------------------------------------------

export function readSession() {
  const doken = tc().dokenParsed ?? {};
  const key = doken["tideuserkey"];
  const realmRoles = Array.isArray(doken["realm_access"]?.roles)
    ? doken["realm_access"].roles.map(String)
    : [];
  const groups = Array.isArray(doken["groups"]) ? doken["groups"].map(String) : [];
  // Chép claim nguyên văn, không mã hóa lại.
  return {
    tideUserKey: typeof key === "string" ? key : "",
    realmRoles,
    groups,
    canEncrypt: realmRoles.includes(ENCRYPT_ROLE),
    canDecrypt: realmRoles.includes(DECRYPT_ROLE),
  };
}

// --- policy -----------------------------------------------------------------------------------

/**
 * @param {{vendorId: string, subject: {type: 'User'|'Group'|'Role', id: string, clientId?: string},
 *          recordId: string, access: 'read'|'write'|'read-write', expiry?: number}} grant
 *   subject.id: User = `tideuserkey` CỦA NGƯỜI ĐƯỢC CẤP (không phải của admin);
 *   Group = full path như claim `groups`; Role = tên realm role (thêm clientId nếu là client role).
 */
export function buildRelationshipPolicy(grant) {
  const subject = grant.subject;
  if (!subject || !["User", "Group", "Role"].includes(subject.type)) {
    throw new Error('subject.type phải là "User", "Group" hoặc "Role"');
  }
  if (!subject.id) {
    throw new Error(
      subject.type === "User"
        ? "người được cấp chưa có tideuserkey: họ phải đăng nhập một lần trước"
        : `subject.id (${subject.type.toLowerCase()}) là bắt buộc`,
    );
  }
  if (!grant.recordId) throw new Error("recordId là bắt buộc");
  if (!ROLES_FOR[grant.access]) throw new Error('access phải là "read", "write" hoặc "read-write"');
  // SDK chỉ ghi được bản policy mới nhất của chính nó. Không hardcode.
  const version = Models.Policy.latestVersion;
  return new Models.Policy({
    version,
    contractId: RELATIONSHIP_CONTRACT_ID,
    modelId: RELATIONSHIP_MODEL_IDS,
    keyId: grant.vendorId,
    approvalType: Models.ApprovalType.IMPLICIT,
    executionType: Models.ExecutionType.PRIVATE,
    // Tất cả param là STRING. `roles` là JSON viết dưới dạng chuỗi, không phải mảng.
    // Param luôn tên `assignmentId` dù record là gì.
    params: new Map([
      ["subjectType", subject.type],
      ["subjectId", subject.id],
      ...(subject.type === "Role" && subject.clientId ? [["clientId", subject.clientId]] : []),
      ["assignmentId", grant.recordId],
      ["roles", JSON.stringify(ROLES_FOR[grant.access])],
    ]),
    ...(grant.expiry ? { expiry: grant.expiry } : {}),
  });
}

/**
 * Ký policy. Chạy trong trình duyệt của một `tide-realm-admin`: mở enclave để admin duyệt.
 * Chính cái duyệt đó LÀ việc cấp quyền. Gọi thẳng từ sự kiện click, nếu không popup bị chặn.
 *
 * `adminPolicy` là admin policy của realm (bytes đã ký), backend lấy giúp từ
 * GET {auth-server-url}/admin/realms/{realm}/iga/role-policies/name/tide-realm-admin (field `policy`, base64).
 *
 * @returns {Promise<string>} policy đã ký, base64.
 */
export async function signRelationshipPolicy(grant, adminPolicy) {
  const policy = buildRelationshipPolicy(grant);

  // Contract nằm sẵn trong ORK nên request chỉ mang policy, không mang gì khác.
  const request = PolicySignRequest.New(policy);
  request.setCustomExpiry(SIGN_REQUEST_EXPIRY_SECONDS);

  const initialised = await tc().createTideRequest(request.encode());
  const id = Models.BaseTideRequest.decode(initialised).getUniqueId();

  const [approval] = await tc().requestTideOperatorApproval([{ id, request: initialised }]);
  if (!approval || approval.status !== "approved") {
    throw new Error(`policy không được duyệt (${approval ? approval.status : "không phản hồi"})`);
  }

  // Gắn admin policy vào request ĐÃ DUYỆT, dạng bytes thô.
  const approved = Models.BaseTideRequest.decode(approval.request);
  approved.addPolicy(adminPolicy);

  const signatures = await tc().executeSignRequest(approved.encode(), true);
  if (!signatures?.[0]) throw new Error("mạng không trả về chữ ký");

  policy.signature = signatures[0];
  return toBase64(policy.toBytes());
}

// --- dùng policy --------------------------------------------------------------------------------
// recordId là tag DUY NHẤT. Thêm tag thứ hai hoặc sai tag đều bị contract từ chối.
// Lỗi từ mạng ném nguyên văn: hiện ra, không thay thế.

/**
 * @param {string|Uint8Array} data chuỗi, hoặc bytes (PDF) — plan mục 5.1.
 * @returns {Promise<string>} ciphertext base64.
 */
export async function encryptForRecord(data, recordId, signedPolicyB64) {
  const [out] = await IAMService.doEncrypt([{ data, tags: [recordId] }], fromBase64(signedPolicyB64));
  return typeof out === "string" ? out : toBase64(out);
}

/** Giải mã ra bytes — dùng cho PDF. */
export async function decryptBytesForRecord(encrypted, recordId, signedPolicyB64) {
  const [out] = await IAMService.doDecrypt([{ encrypted, tags: [recordId] }], fromBase64(signedPolicyB64));
  return typeof out === "string" ? new TextEncoder().encode(out) : new Uint8Array(out);
}

/** Giải mã ra chuỗi — dùng cho feedback. */
export async function decryptForRecord(encrypted, recordId, signedPolicyB64) {
  const [out] = await IAMService.doDecrypt([{ encrypted, tags: [recordId] }], fromBase64(signedPolicyB64));
  return typeof out === "string" ? out : new TextDecoder().decode(out);
}

/** Policy đã lưu nói gì — để hiện cho admin xem trước khi tin. */
export function describeRelationshipPolicy(signedPolicyB64) {
  const p = Models.Policy.from(fromBase64(signedPolicyB64));
  const param = (k) => String(p.params.entries.get(k) ?? "");
  return {
    contractId: p.contractId,
    subjectType: param("subjectType"),
    subjectId: param("subjectId"),
    clientId: param("clientId"),
    recordId: param("assignmentId"),
    roles: param("roles"),
    signed: !!p.signature && p.signature.length > 0,
    isRelationshipPolicy: p.contractId === RELATIONSHIP_CONTRACT_ID,
  };
}
