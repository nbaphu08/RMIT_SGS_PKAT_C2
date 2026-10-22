// tidecloak-js.js — thay @tidecloak/js khi chạy Plan C. AdminAPI tạo change request THẬT trong
// realm giả lập: gán role chỉ có hiệu lực sau khi 2/3 tác giả duyệt (plan mục 4 bước 1–2).
import { IDENTITIES, createRoleRequest } from "./realm.js";
import { currentToken } from "./tidecloak-react.jsx";

export const IAMService = {
  getConfig: () => ({ realm: "unreleased (simulated)" }),
  getToken: async () => `simulated-token:${currentToken()?.username ?? "anonymous"}`,
};

export class AdminAPI {
  async getUsers({ search } = {}) {
    return Object.keys(IDENTITIES)
      .filter((u) => !search || u.includes(search))
      .map((u) => ({ id: u, username: u }));
  }

  async getRole(name) {
    return { id: `role-${name}`, name };
  }

  /** Không gán ngay: tạo CR PENDING. Người tạo được 1 phiếu nếu họ là tide-realm-admin. */
  async addUserRoles(userId, roles) {
    const actor = currentToken()?.username;
    if (!actor) throw new Error("chưa đăng nhập");
    const cr = createRoleRequest(actor, userId, roles[0].name);
    return { changeSetId: cr.id, status: cr.status, approvals: cr.approvals.length };
  }
}
