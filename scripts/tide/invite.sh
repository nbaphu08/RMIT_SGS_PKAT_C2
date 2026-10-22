#!/bin/bash
# invite.sh — sinh lại link liên kết tài khoản Tide cho 5 user (M-A, sau pivot.sh).
# Không đụng role. Dùng khi link cũ (từ users.sh) đã hết hạn hoặc chưa từng sinh.

. "$(dirname "$0")/common.sh"

echo "============================================================"
echo "5 INVITE LINK — mỗi người mở link CỦA MÌNH trong một Chrome profile RIÊNG"
echo "và liên kết tài khoản Tide. Link sống 12 giờ."
echo "============================================================"
for u in $USERS; do
  uid="$(user_id "$u")"
  link="$(api POST "/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$uid&lifespan=43200" \
    -H "Content-Type: application/json" -d '["link-tide-account-action"]' | tr -d '"')"
  printf '%-10s %s\n\n' "$u:" "$link"
done
echo "============================================================"
echo "Khi cả 5 đã liên kết: CONFIRM_FLIP=yes bash scripts/tide/finalize.sh"
echo "============================================================"
