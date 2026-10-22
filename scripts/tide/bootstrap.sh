#!/bin/bash
# bootstrap.sh — M1-A giai đoạn A: mọi thao tác governed PHẢI xong trước khi gán tide-realm-admin.
# Thứ tự theo plan mục 6: import realm -> license -> IGA -> roles/client -> 5 user -> gán realm role.
# Kết thúc bằng 5 invite link. Sau khi cả 5 người liên kết Tide, chạy finalize.sh (một chiều).

. "$(dirname "$0")/common.sh"

# --- Gác: email license + điều khoản phải do chủ dự án trả lời (AP-90) ---
valid_license_email() {
  [[ "${1:-}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || return 1
  case "${1##*@}" in
    example.com|example.org|example.net|yourorg.com|yourdomain.com|yourcompany.com|company.com|\
    domain.com|test.com|placeholder.com|email.com|*.example|*.test|*.invalid|*.local|localhost)
      return 1 ;;
  esac
}
if ! valid_license_email "${TIDE_LICENSE_EMAIL:-}" || [ "${TIDE_TERMS_ACCEPTED:-}" != "yes" ]; then
  cat >&2 <<MSG
STOP: chưa tạo gì cả. Thiếu câu trả lời của chủ dự án:
  1. TIDE_LICENSE_EMAIL = email thật để quản lý license Tide (không placeholder)
  2. TIDE_TERMS_ACCEPTED=yes, chỉ khi đã đọc và đồng ý https://tide.org/legal
Điền vào .env rồi chạy lại.
MSG
  exit 2
fi
echo "==> License email: $TIDE_LICENSE_EMAIL (điều khoản: chủ dự án đã đồng ý)"

# --- Gác: không ghi đè realm đã có (realm không un-flip được) ---
if curl -sf -m 3 "$TIDECLOAK_URL/realms/$REALM_NAME" >/dev/null 2>&1; then
  echo "ERROR: realm '$REALM_NAME' đã tồn tại trên $TIDECLOAK_URL. Dừng để không phá realm cũ." >&2
  exit 1
fi

# --- Bước 1: container ---
if docker inspect tidecloak >/dev/null 2>&1; then
  echo "==> Container 'tidecloak' đã có, bật lại..."
  docker start tidecloak >/dev/null
else
  echo "==> Kéo image $TIDECLOAK_IMAGE..."
  case "$TIDECLOAK_IMAGE" in *stg*) echo "ERROR: image staging không được hỗ trợ." >&2; exit 1 ;; esac
  docker pull "$TIDECLOAK_IMAGE"
  mkdir -p ./data
  echo "==> Chạy TideCloak..."
  docker run -d --name tidecloak \
    -v "$(pwd)/data:/opt/keycloak/data/h2" -p 8080:8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME="$KC_BOOTSTRAP_ADMIN_USERNAME" \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
    "$TIDECLOAK_IMAGE" >/dev/null
fi

echo "==> Chờ TideCloak sẵn sàng..."
for i in $(seq 1 30); do curl -sf "$TIDECLOAK_URL" >/dev/null 2>&1 && break; sleep 5; done
curl -sf "$TIDECLOAK_URL" >/dev/null 2>&1 || { echo "ERROR: TideCloak không lên. docker logs tidecloak" >&2; exit 1; }
[ -n "$(get_token)" ] || { echo "ERROR: không lấy được master admin token." >&2; exit 1; }

# --- Bước 2: import realm (template của pack + role riêng của mình) ---
# Khai báo role TRƯỚC khi bật IGA để adopt-scan tự attest, không cần approval.
echo "==> Tạo realm '$REALM_NAME' (client '$CLIENT_NAME', app $CLIENT_APP_URL)..."
TMP_REALM="$(mktemp)"
sed -e "s|REALM_NAME|$REALM_NAME|g" -e "s|CLIENT_NAME|$CLIENT_NAME|g" -e "s|CLIENT_APP_URL|$CLIENT_APP_URL|g" \
  .tide-pack/templates/shared/realm.json.template \
  | jq '.roles.realm += [
      {"name":"us-owner","description":"Nghệ sĩ sở hữu project"},
      {"name":"us-operator","description":"Operator chạy server (Approver 1)"},
      {"name":"us-trk-t1-reviewer","description":"Được nghe track t1"},
      {"name":"us-trk-t2-reviewer","description":"Được nghe track t2"},
      {"name":"us-trk-t3-reviewer","description":"Được nghe track t3"}]' > "$TMP_REALM"
api POST "/admin/realms" -H "Content-Type: application/json" --data-binary @"$TMP_REALM" > /dev/null
rm -f "$TMP_REALM"
curl -sf "$TIDECLOAK_URL/realms/$REALM_NAME" >/dev/null || { echo "ERROR: tạo realm thất bại." >&2; exit 1; }

# --- Bước 2b: tắt trang "Update Account Information" của Keycloak (pack step 3b) ---
echo "==> Tắt trang profile ở first-broker-login..."
EXECS="$(api GET "/admin/realms/$REALM_NAME/authentication/flows/first%20broker%20login/executions")"
REVIEW_CFG="$(printf '%s' "$EXECS" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)"
REVIEW_ID="$(printf '%s' "$EXECS" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .id' | head -1)"
CFG_BODY='{"alias":"review profile config","config":{"update.profile.on.first.login":"off"}}'
if [ -n "$REVIEW_CFG" ]; then
  api PUT "/admin/realms/$REALM_NAME/authentication/config/$REVIEW_CFG" \
    -H "Content-Type: application/json" -d "$CFG_BODY" > /dev/null
elif [ -n "$REVIEW_ID" ]; then
  api POST "/admin/realms/$REALM_NAME/authentication/executions/$REVIEW_ID/config" \
    -H "Content-Type: application/json" -d "$CFG_BODY" > /dev/null
fi
REVIEW_NOW="$(api GET "/admin/realms/$REALM_NAME/authentication/flows/first%20broker%20login/executions" \
  | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)"
REVIEW_VAL=""
[ -n "$REVIEW_NOW" ] && REVIEW_VAL="$(api GET "/admin/realms/$REALM_NAME/authentication/config/$REVIEW_NOW" \
  | jq -r '.config["update.profile.on.first.login"] // empty')"
[ "$REVIEW_VAL" = "off" ] || { echo "ERROR: không tắt được trang profile (đọc lại '${REVIEW_VAL:-<unset>}')." >&2; exit 1; }

# --- Bước 2c: bỏ ràng buộc email trong user profile ---
# 5 danh tính của plan là tài khoản synthetic không có email, và pack cấm bịa email placeholder
# (AP-85). Realm mặc định bắt buộc email -> POST /users trả 400 error-user-attribute-required.
# Chạy TRƯỚC toggle-iga để không thành governed write.
echo "==> Bỏ ràng buộc email trong user profile..."
api GET "/admin/realms/$REALM_NAME/users/profile" \
  | jq '(.attributes[] | select(.name=="email")) |= del(.required)' > /tmp/user-profile.json
api PUT "/admin/realms/$REALM_NAME/users/profile" \
  -H "Content-Type: application/json" --data-binary @/tmp/user-profile.json > /dev/null
rm -f /tmp/user-profile.json
[ "$(api GET "/admin/realms/$REALM_NAME/users/profile" | jq -r '.attributes[] | select(.name=="email") | .required // "null"')" = "null" ] \
  || { echo "ERROR: email vẫn bắt buộc trong user profile." >&2; exit 1; }

# --- Bước 3: license (setUpTideRealm) ---
echo "==> License realm + sinh VRK (10-15s, gọi thật tới Tide)..."
BODY="$(mktemp)"
CODE="$(curl -s -o "$BODY" -w '%{http_code}' -X POST \
  "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/setUpTideRealm" \
  -H "Authorization: Bearer $(get_token)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=$TIDE_LICENSE_EMAIL" \
  --data-urlencode "isRagnarokEnabled=true")" || CODE="000"
OUT="$(head -c 600 "$BODY")"; rm -f "$BODY"
case "$CODE" in
  2??) : ;;
  303) echo "ERROR: setUpTideRealm 303 (checkout trả phí) -> không có license free tier: $OUT" >&2; exit 1 ;;
  *)   echo "ERROR: setUpTideRealm HTTP $CODE: $OUT  (xem 'docker logs tidecloak | grep Midgard')" >&2; exit 1 ;;
esac
case "$OUT" in *NEED_PAYMENT*) echo "ERROR: NEED_PAYMENT -> realm CHƯA có license. Kiểm tra email $TIDE_LICENSE_EMAIL" >&2; exit 1 ;; esac
echo "    setUpTideRealm: HTTP $CODE $OUT"

# --- Bước 4: iga.attestor=tide rồi bật IGA (gọi toggle-iga ĐÚNG MỘT LẦN) ---
echo "==> Đặt iga.attestor=tide..."
api GET "/admin/realms/$REALM_NAME" | jq '.attributes = ((.attributes // {}) + {"iga.attestor":"tide"})' > /tmp/realm-rep.json
api PUT "/admin/realms/$REALM_NAME" -H "Content-Type: application/json" --data-binary @/tmp/realm-rep.json > /dev/null
rm -f /tmp/realm-rep.json

IGA_NOW="$(api GET "/admin/realms/$REALM_NAME" | jq -r '.attributes.isIGAEnabled // "false"' | tr '[:upper:]' '[:lower:]')"
if [ "$IGA_NOW" = "true" ]; then
  echo "    IGA đã bật, KHÔNG gọi toggle-iga lần nữa."
else
  echo "==> Bật IGA..."
  IGA_OUT="$(api POST "/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
    -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "isIGAEnabled=true")"
  case "$IGA_OUT" in
    *'"enabled":true'*) : ;;
    *) echo "ERROR: toggle-iga không báo enabled=true: $IGA_OUT" >&2; exit 1 ;;
  esac
  case "$IGA_OUT" in *'"warnings"'*|*commitFailures*) echo "WARNING: toggle-iga có warning: $IGA_OUT" >&2 ;; esac
fi
sleep 2
echo "==> Drain change request của client/role..."; drain

echo ""
echo "============================================================"
echo "Xong giai đoạn A1: realm + license + IGA. Chạy tiếp:"
echo "  bash scripts/tide/users.sh      # tạo 5 user, gán realm role, in invite link"
echo "============================================================"
