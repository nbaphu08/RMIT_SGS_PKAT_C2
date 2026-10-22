#!/bin/bash
# common.sh — cấu hình + helper dùng chung cho bootstrap.sh và finalize.sh (M1-A).
# Dựa trên .tide-pack/templates/shared/bootstrap-tidecloak.sh, sửa cho 5 danh tính của plan mục 3.2.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Docker Desktop trên macOS không đặt docker vào PATH mặc định.
[ -d /Applications/Docker.app/Contents/Resources/bin ] && \
  PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

[ -f .env ] || { echo "ERROR: thiếu .env (copy từ .env.example)." >&2; exit 1; }
set -a; . ./.env; set +a

TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM_NAME="${REALM_NAME:-unreleased}"
CLIENT_NAME="${CLIENT_NAME:-unreleased-client}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:5137}"
TIDECLOAK_IMAGE="${TIDECLOAK_IMAGE:-tideorg/tidecloak-dev:latest}"
ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-./public/tidecloak.json}"
KC_BOOTSTRAP_ADMIN_USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
KC_BOOTSTRAP_ADMIN_PASSWORD="${KC_BOOTSTRAP_ADMIN_PASSWORD:-}"

# 5 danh tính (plan mục 3.2). Realm role gán ngay; tide-realm-admin gán cuối cùng ở finalize.sh.
USERS="owner reviewer operator approver2 approver3"
ROLES_owner="_tide_encryptor _tide_decryptor us-owner"
ROLES_reviewer="_tide_encryptor _tide_decryptor"
ROLES_operator="us-operator"          # CỐ Ý không có _tide_decryptor (plan mục 3.4)
ROLES_approver2=""
ROLES_approver3=""
REALM_ADMINS="owner approver2 approver3"

[ -n "$KC_BOOTSTRAP_ADMIN_PASSWORD" ] || {
  echo "ERROR: KC_BOOTSTRAP_ADMIN_PASSWORD chưa đặt trong .env." >&2; exit 1; }

get_token() {
  curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "username=$KC_BOOTSTRAP_ADMIN_USERNAME" \
    --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" \
    -d "grant_type=password&client_id=admin-cli" | jq -r '.access_token'
}

api() { # api <method> <path> [curl args...]
  local method="$1" path="$2"; shift 2
  curl -s -X "$method" "$TIDECLOAK_URL$path" -H "Authorization: Bearer $(get_token)" "$@"
}

user_id() { api GET "/admin/realms/$REALM_NAME/users?username=$1&exact=true" | jq -r '.[0].id // empty'; }
user_key() { api GET "/admin/realms/$REALM_NAME/users?username=$1&exact=true" \
  | jq -r '.[0].attributes.tideUserKey[0] // empty'; }

pending_ids() { # bỏ 3 action type phá hoại (canon iga-change-requests-api)
  api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    | jq -r "if type==\"array\" then (.[] | select(.actionType | IN(\"DISABLE_IGA\",\"DELETE_REALM\",\"OFFBOARD_REALM\") | not) | .id) else empty end"
}

# Drain: firstAdmin/Tideless thì authorize ký server-side, không cần enclave.
drain() {
  local id ready pass
  for pass in 1 2 3 4 5; do
    for id in $(pending_ids); do
      api POST "/admin/realms/$REALM_NAME/iga/change-requests/$id/authorize" \
        -H "Content-Type: application/json" -d '{}' > /dev/null || true
    done
    ready=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      | jq -r "if type==\"array\" then (.[] | select(.actionType | IN(\"DISABLE_IGA\",\"DELETE_REALM\",\"OFFBOARD_REALM\") | not) | select(.readyToCommit==true) | .id) else empty end")
    [ -z "$ready" ] && break
    for id in $ready; do
      api POST "/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" > /dev/null || true
    done
  done
  echo "    PENDING còn lại: $(pending_ids | grep -c . || true)"
}
