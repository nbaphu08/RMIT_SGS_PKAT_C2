// authz.js — luật phân quyền đọc paper, DÙNG CHUNG cho hai đường chạy:
//   server/routes/papers.js      — backend thật (Express + JWT do Tide ký)
//   src/lib/api.preview.js       — backend mô phỏng Plan C (chạy trong trình duyệt)
//
// Trước đây mỗi bên chép một bản: sửa một bên là bên kia lệch âm thầm, và demo sẽ hành xử khác
// tích hợp thật. Để ở đây thì không lệch được nữa.
//
// Chỉ nhận MẢNG ROLE (lấy từ token), không nhận req hay DB: quyền đến từ token do Tide ký,
// không đến từ dữ liệu server sửa được (plan mục 3.3, T14).

export const AUTHOR_ROLE = 'ps-author';
export const OPERATOR_ROLE = 'ps-operator';
export const ADMIN_ROLE = 'tide-realm-admin';

export const readerRole = (paperId) => `ps-paper-${paperId}-reader`;

export const hasAuthorRole = (roles) => roles.includes(AUTHOR_ROLE);
export const hasReaderRole = (roles, paperId) => roles.includes(readerRole(paperId));

/**
 * Lý do từ chối đọc, hoặc null nếu được đọc (plan mục 3.3, 3.4):
 *   tác giả đọc mọi paper · người khác cần role khớp ĐÚNG :id (chặn IDOR) và còn trong hạn.
 *
 * Lớp hạn ở đây chỉ để trải nghiệm tốt — Operator sửa được `review_until` trong DB. Hạn THẬT nằm
 * trong policy đã ký và do mạng ORK thực thi (T16).
 */
export function denyReason(roles, paper, nowIso = new Date().toISOString()) {
  if (hasAuthorRole(roles)) return null;
  if (!hasReaderRole(roles, paper.id)) return `missing role ${readerRole(paper.id)}`;
  if (!paper.review_until || paper.review_until <= nowIso) {
    return `review window for ${paper.id} has closed`;
  }
  return null;
}
