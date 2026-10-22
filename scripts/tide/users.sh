#!/bin/bash
# users.sh — M1-A giai đoạn A2: 5 danh tính của plan mục 3.2.
# Chạy sau bootstrap.sh. Vẫn còn ở firstAdmin nên drain tự ký được, chưa có gì một chiều.

. "$(dirname "$0")/common.sh"

curl -sf -m 3 "$TIDECLOAK_URL/realms/$REALM_NAME" >/dev/null \
  || { echo "ERROR: realm '$REALM_NAME' chưa có — chạy bootstrap.sh trước." >&2; exit 1; }

# --- Bước 5: tạo 5 user ---
for u in $USERS; do
  echo "==> Tạo user '$u'..."
  api POST "/admin/realms/$REALM_NAME/users" -H "Content-Type: application/json" \
    -d "{\"username\":\"$u\",\"enabled\":true,\"emailVerified\":false,\"attributes\":{\"tideInvitable\":[\"true\"]}}" > /dev/null
done
sleep 2
echo "==> Drain CREATE_USER..."; drain
for u in $USERS; do
  [ -n "$(user_id "$u")" ] || { echo "ERROR: user '$u' không tồn tại sau khi drain." >&2; exit 1; }
done

# --- Bước 6: gán realm role theo bảng mục 3.2 (tide-realm-admin để finalize.sh) ---
# Gán TỪNG role một rồi drain: hai CR cùng một user thì CR sau bị PENDING_CHANGE_REQUEST_CONFLICT
# và lặng lẽ không áp dụng (đo được 2026-10-22).
for u in $USERS; do
  eval "roles=\${ROLES_$u}"
  [ -n "${roles:-}" ] || { echo "==> $u: không gán realm role nào"; continue; }
  uid="$(user_id "$u")"
  for r in $roles; do
    rj="$(api GET "/admin/realms/$REALM_NAME/roles/$r")"
    echo "$rj" | jq -e '.id' >/dev/null || { echo "ERROR: thiếu realm role '$r'." >&2; exit 1; }
    echo "==> Gán $r cho $u"
    api POST "/admin/realms/$REALM_NAME/users/$uid/role-mappings/realm" \
      -H "Content-Type: application/json" -d "[$(echo "$rj" | jq -c '{id,name}')]" > /dev/null
    sleep 1
    drain > /dev/null
  done
  got="$(api GET "/admin/realms/$REALM_NAME/users/$uid/role-mappings/realm" | jq -r '[.[].name] | sort | join(",")')"
  for r in $roles; do
    case ",$got," in *",$r,"*) : ;; *) echo "ERROR: $u thiếu role $r (có: $got)" >&2; exit 1 ;; esac
  done
  echo "    $u: $got"
done
echo "==> Drain GRANT_ROLES..."; drain

# --- Bước 7: invite link cho từng người ---
echo ""
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
echo "Xong giai đoạn A. KHI CẢ 5 ĐÃ LIÊN KẾT: bash scripts/tide/finalize.sh"
echo "  (finalize.sh gán tide-realm-admin -> realm flip sang multiAdmin, KHÔNG hoàn tác được)"
echo "Console: $TIDECLOAK_URL/admin/master/console/  (user $KC_BOOTSTRAP_ADMIN_USERNAME, mật khẩu trong .env)"
echo "============================================================"
