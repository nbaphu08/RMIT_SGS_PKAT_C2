#!/bin/bash
# finalize.sh — M1-A giai đoạn C. MỘT CHIỀU: gán tide-realm-admin làm realm flip
# firstAdmin -> multiAdmin. Sau đó mọi thay đổi governed đều cần enclave approval.
# Chỉ chạy khi cả 5 danh tính đã liên kết Tide xong.
# Dùng: CONFIRM_FLIP=yes bash scripts/tide/finalize.sh

. "$(dirname "$0")/common.sh"

[ "${CONFIRM_FLIP:-}" = "yes" ] || {
  cat >&2 <<MSG
STOP: script này không hoàn tác được.

  Nó gán tide-realm-admin cho: $REALM_ADMINS
  -> realm chuyển sang multiAdmin, mọi cấu hình sau này cần 2/3 approver duyệt trong enclave.

  Chắc chắn mọi cấu hình governed đã xong (role, client, redirect URI, 5 user) rồi chạy:
    CONFIRM_FLIP=yes bash scripts/tide/finalize.sh
MSG
  exit 2
}

# --- Gác: cả 5 phải đã liên kết Tide (có tideUserKey) ---
MISSING=""
for u in $USERS; do
  [ -n "$(user_key "$u")" ] || MISSING="$MISSING $u"
done
[ -z "$MISSING" ] || { echo "ERROR: chưa liên kết Tide:$MISSING — mở invite link của họ trước." >&2; exit 1; }
echo "==> Cả 5 danh tính đã có tideUserKey."

echo "==> Drain change request do việc liên kết tài khoản sinh ra..."; drain

# --- CustomAdminUIDomain = console origin của realm này, rồi ký IdP settings ---
echo "==> Đặt CustomAdminUIDomain + sign-idp-settings..."
api GET "/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  | jq --arg d "$TIDECLOAK_URL/realms/$REALM_NAME/tide-console/" '.config.CustomAdminUIDomain=$d' > /tmp/tide-idp.json
api PUT "/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Content-Type: application/json" --data-binary @/tmp/tide-idp.json > /dev/null
rm -f /tmp/tide-idp.json
api POST "/admin/realms/$REALM_NAME/vendorResources/sign-idp-settings" > /dev/null

# --- Gán tide-realm-admin cho 3 approver (THAO TÁC MỘT CHIỀU) ---
RM_UUID="$(api GET "/admin/realms/$REALM_NAME/clients?clientId=realm-management" | jq -r '.[0].id')"
[ -n "$RM_UUID" ] && [ "$RM_UUID" != "null" ] || { echo "ERROR: không thấy client realm-management." >&2; exit 1; }
ROLE_JSON="$(api GET "/admin/realms/$REALM_NAME/clients/$RM_UUID/roles/tide-realm-admin")"
echo "$ROLE_JSON" | jq -e '.id' >/dev/null || { echo "ERROR: không thấy role tide-realm-admin: $ROLE_JSON" >&2; exit 1; }

for u in $REALM_ADMINS; do
  echo "==> Gán tide-realm-admin cho $u..."
  api POST "/admin/realms/$REALM_NAME/users/$(user_id "$u")/role-mappings/clients/$RM_UUID" \
    -H "Content-Type: application/json" -d "[$ROLE_JSON]" > /dev/null
done
sleep 2
echo "==> Drain cuối (commit GRANT_ROLES -> flip multiAdmin)..."; drain

# --- Kiểm tra: ai thực sự có tide-realm-admin, và ngưỡng là bao nhiêu (T2) ---
echo ""
echo "--- tide-realm-admin đã có hiệu lực cho: ---"
for u in $REALM_ADMINS; do
  n="$(api GET "/admin/realms/$REALM_NAME/users/$(user_id "$u")/role-mappings/clients/$RM_UUID" \
        | jq -r '[.[] | select(.name=="tide-realm-admin")] | length')"
  printf '  %-10s %s\n' "$u" "$([ "$n" = "1" ] && echo "CÓ" || echo "CHƯA (cần duyệt trong tide-console)")"
done
echo "--- admin policy (ngưỡng QEA, T2): ---"
api GET "/admin/realms/$REALM_NAME/iga/role-policies/name/tide-realm-admin" | jq '.' || true
echo "--- change request còn PENDING: ---"
api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
  | jq -r 'if type=="array" then (.[] | "  \(.actionType) \(.id) auth=\(.authorizationCount // 0)/\(.threshold // "?") ready=\(.readyToCommit)") else . end'

# --- Xuất adapter ---
echo ""
echo "==> Xuất adapter -> $ADAPTER_OUTPUT"
CLIENT_UUID="$(api GET "/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" | jq -r '.[0].id')"
api GET "/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CLIENT_UUID&providerId=keycloak-oidc-keycloak-json" \
  > "$ADAPTER_OUTPUT"
jq -e 'has("jwk") and has("vendorId") and has("homeOrkUrl")' "$ADAPTER_OUTPUT" >/dev/null \
  && echo "    OK: có jwk, vendorId, homeOrkUrl" \
  || { echo "ERROR: adapter thiếu jwk/vendorId/homeOrkUrl -> license chưa hoàn tất. KHÔNG tự dựng file này." >&2; exit 1; }
jq '{vendorId, homeOrkUrl, realm, "auth-server-url":."auth-server-url", resource}' "$ADAPTER_OUTPUT"

echo ""
echo "============================================================"
echo "Xong M1-A giai đoạn C. Bước tiếp theo:"
echo "  - T1: 5 người login app + backend GET /api/me = 200"
echo "  - T2: đọc ngưỡng ở trên; tạo thử 1 CR và xem threshold = 2"
echo "  - Ghi kết quả vào docs/VERIFICATION_LOG.md"
echo "tide-console (QEA Approvals): $TIDECLOAK_URL/realms/$REALM_NAME/tide-console/"
echo "============================================================"
