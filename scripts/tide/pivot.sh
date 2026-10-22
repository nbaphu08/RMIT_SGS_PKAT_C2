#!/bin/bash
# pivot.sh — M-A: chuyển cấu hình role của realm từ Unreleased Studio sang Papersec (plan v4 mục 2, 6).
# PHẢI chạy TRƯỚC finalize.sh: sau khi có tide-realm-admin thì script không tự duyệt CR được nữa.
# Đảo ngược được (gán/gỡ role), nhưng role us-* bị xóa thì phải tạo lại bằng tay.

. "$(dirname "$0")/common.sh"

curl -sf -m 3 "$TIDECLOAK_URL/realms/$REALM_NAME" >/dev/null \
  || { echo "ERROR: realm '$REALM_NAME' chưa có — chạy bootstrap.sh trước." >&2; exit 1; }

# Gác: sau flip multiAdmin thì drain không ký được nữa.
RM_UUID="$(api GET "/admin/realms/$REALM_NAME/clients?clientId=realm-management" | jq -r '.[0].id')"
for u in $USERS; do
  n="$(api GET "/admin/realms/$REALM_NAME/users/$(user_id "$u")/role-mappings/clients/$RM_UUID" \
        | jq -r '[.[] | select(.name=="tide-realm-admin")] | length')"
  [ "$n" = "0" ] || { echo "ERROR: $u đã có tide-realm-admin — realm đã flip, pivot.sh không chạy được nữa." >&2; exit 1; }
done

NEW_ROLES="ps-author ps-operator ps-paper-p1-reader ps-paper-p2-reader ps-paper-p3-reader"
OLD_ROLES="us-owner us-operator us-trk-t1-reviewer us-trk-t2-reviewer us-trk-t3-reviewer"

# Role đích của từng user (plan mục 2). _tide_* đã có sẵn với owner/reviewer.
PIVOT_owner="ps-author"
PIVOT_reviewer="ps-paper-p3-reader"
PIVOT_operator="ps-operator"
PIVOT_approver2="ps-author _tide_encryptor _tide_decryptor"
PIVOT_approver3="ps-author _tide_encryptor _tide_decryptor"

# --- Bước 1: tạo realm role mới ---
for r in $NEW_ROLES; do
  if api GET "/admin/realms/$REALM_NAME/roles/$r" | jq -e '.id' >/dev/null 2>&1; then
    echo "==> role '$r' đã có"
  else
    echo "==> Tạo role '$r'"
    api POST "/admin/realms/$REALM_NAME/roles" -H "Content-Type: application/json" \
      -d "{\"name\":\"$r\"}" > /dev/null
  fi
done
drain

# --- Bước 2: gán role mới, từng role một rồi drain (PENDING_CHANGE_REQUEST_CONFLICT) ---
for u in $USERS; do
  eval "roles=\${PIVOT_$u}"
  uid="$(user_id "$u")"
  got="$(api GET "/admin/realms/$REALM_NAME/users/$uid/role-mappings/realm" | jq -r '[.[].name]|join(",")')"
  for r in $roles; do
    case ",$got," in *",$r,"*) echo "==> $u đã có $r"; continue ;; esac
    rj="$(api GET "/admin/realms/$REALM_NAME/roles/$r")"
    echo "$rj" | jq -e '.id' >/dev/null || { echo "ERROR: thiếu realm role '$r'." >&2; exit 1; }
    echo "==> Gán $r cho $u"
    api POST "/admin/realms/$REALM_NAME/users/$uid/role-mappings/realm" \
      -H "Content-Type: application/json" -d "[$(echo "$rj" | jq -c '{id,name}')]" > /dev/null
    sleep 1
    drain > /dev/null
  done
done

# --- Bước 3: gỡ role us-* khỏi user, rồi xóa khỏi realm ---
for u in $USERS; do
  uid="$(user_id "$u")"
  for r in $OLD_ROLES; do
    rj="$(api GET "/admin/realms/$REALM_NAME/users/$uid/role-mappings/realm" | jq -c --arg r "$r" '.[] | select(.name==$r) | {id,name}')"
    [ -n "$rj" ] || continue
    echo "==> Gỡ $r khỏi $u"
    api DELETE "/admin/realms/$REALM_NAME/users/$uid/role-mappings/realm" \
      -H "Content-Type: application/json" -d "[$rj]" > /dev/null
    sleep 1
    drain > /dev/null
  done
done
for r in $OLD_ROLES; do
  api GET "/admin/realms/$REALM_NAME/roles/$r" | jq -e '.id' >/dev/null 2>&1 || continue
  echo "==> Xóa realm role '$r'"
  api DELETE "/admin/realms/$REALM_NAME/roles/$r" > /dev/null
  sleep 1
  drain > /dev/null
done

# --- Bước 4: đọc lại từ server và kiểm tra ---
echo ""
echo "--- Role đọc lại từ server ---"
fail=0
for u in $USERS; do
  eval "roles=\${PIVOT_$u}"
  got="$(api GET "/admin/realms/$REALM_NAME/users/$(user_id "$u")/role-mappings/realm" | jq -r '[.[].name]|sort|join(",")')"
  printf '  %-10s %s\n' "$u" "$got"
  for r in $roles; do
    case ",$got," in *",$r,"*) : ;; *) echo "    ERROR: thiếu $r" >&2; fail=1 ;; esac
  done
  for r in $OLD_ROLES; do
    case ",$got," in *",$r,"*) echo "    ERROR: còn role cũ $r" >&2; fail=1 ;; esac
  done
done
echo "--- Realm role hiện có ---"
api GET "/admin/realms/$REALM_NAME/roles" | jq -r '.[].name' | sort | sed 's/^/  /'
echo "--- PENDING còn lại ---"; drain
[ "$fail" = "0" ] || exit 1
echo ""
echo "pivot.sh OK. Tiếp theo: khi cả 5 đã liên kết Tide -> CONFIRM_FLIP=yes bash scripts/tide/finalize.sh"
