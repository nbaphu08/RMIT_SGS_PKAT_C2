# Nhật ký xác minh — Unreleased Studio

Mỗi thí nghiệm (plan mục 10) ghi: ngày/giờ, ai chạy, lệnh/thao tác, **kết quả thật** (dán output),
và kết luận PASS/FAIL. Không ghi "chắc là được" — chưa chạy thì để TRỐNG.

Không dán vào file này: token, DPoP proof, policy bytes, mật khẩu, email license.

## Môi trường

| Mục | Giá trị |
|---|---|
| Nơi chạy TideCloak (G0) | Docker local, `tideorg/tidecloak-dev:latest` |
| Docker | 29.9.2 (Docker Desktop, macOS) |
| Node | v26.12.0 |
| Realm / client | `unreleased` / `unreleased-client` |
| App URL | http://localhost:5137 |
| TideCloak server | Keycloak 26.7.5, Java 21.0.12.1; provider jar `iga-core`, `keycloak-tide`, `ragnarok`, `MidgardJava` đều là `1.0-SNAPSHOT` |
| Image | `tideorg/tidecloak-dev:latest`, digest `sha256:3f52d0bc…aaa2708`, build-date 2026-10-13 |
| `@tidecloak/*` npm đã cài | `@tidecloak/react` 0.14.33, `@tidecloak/js` 0.14.34 |
| Khớp phiên bản SDK ↔ server | **CHƯA xác minh** — jar trong image là `1.0-SNAPSHOT`, không có semver để đối chiếu với `0.14.x` của npm |
| IGA | `isIGAEnabled=true`, `iga.attestor=tide` (đúng Tide mode, không phải Tideless) |
| `iga.threshold` cấp realm | không đặt (null) → dùng ngưỡng trong admin policy đã ký |
| `accessTokenLifespan` | 600s (10 phút) — trần cho T10/T11 |

## Kết quả thí nghiệm

| ID | Ưu tiên | Nội dung | Kết quả | Ngày | Ghi chú |
|---|---|---|---|---|---|
| T1 | P0 | Login + DPoP + backend verify | *chưa chạy* | | |
| T2 | P0 | Ngưỡng QEA với 3 admin = 2 | *chưa chạy* | | Chạy được sau `finalize.sh`; `/iga/role-policies` hiện trả `[]` vì chưa có `tide-realm-admin` nào |
| T3 | P0 | Ký policy `RelationshipAttestation:1` | *chưa chạy* | | Mục 8 câu hỏi 1: mạng ORK có contract chưa |
| T4 | P0 | Owner mã hóa P1, Reviewer giải mã P2 | *chưa chạy* | | |
| T5 | P0 | Audio `Uint8Array` đúng hash | *chưa chạy* | | |
| T9 | P0 | Operator giải mã t2 bị từ chối | *chưa chạy* | | |
| T13 | P0 | CR 1/2 phiếu: Reviewer vẫn 403 | *chưa chạy* | | |
| T14 | P0 | Storage/DB chỉ có ciphertext | *chưa chạy* | | |
| T15 | P1 | Operator tự ký policy cho mình | *chưa chạy* | | |
| T6 | P1 | Ký nhiều policy trong một popup? | *chưa chạy* | | |
| T10/T11 | P1 | Thu hồi: bao nhiêu giây đến khi 403 | *chưa chạy* | | |
| T12 | P1 | Master admin gán role trên realm app | *chưa chạy* | | Tự host nên đội là Operator |

## Nhật ký chi tiết

### 2026-10-22 — M1-A chuẩn bị

- Chủ dự án đã đồng ý Tide Terms & Conditions (https://tide.org/legal) và chọn Docker local (mốc G0).
- `.tide-pack/` đã tải từ `https://mcp.tide.org/pack/templates.tgz`.
- Script `scripts/tide/bootstrap.sh` (giai đoạn A, đảo ngược được bằng cách xóa realm/container)
  và `scripts/tide/finalize.sh` (giai đoạn C, **một chiều**) đã viết, chưa chạy.
### 2026-10-22 — M1-A giai đoạn A (ĐÃ CHẠY)

`bash scripts/tide/bootstrap.sh` rồi `bash scripts/tide/users.sh`. Kết quả thật:

| Bước | Kết quả |
|---|---|
| Container | `tidecloak` chạy, port 8080, H2 ở `./data` |
| Realm `unreleased` + client `unreleased-client` | tạo từ `realm.json.template` của pack + 5 realm role riêng |
| Redirect URI đã đăng ký | `http://localhost:5137`, `/*`, `/silent-check-sso.html`, `/auth/redirect`; webOrigins `http://localhost:5137` |
| License | `setUpTideRealm` → **HTTP 200 `CREATED`** (không phải `NEED_PAYMENT`) |
| IGA | `iga.attestor=tide` đặt trước, `toggle-iga` gọi **đúng một lần**, trả `{"enabled":true}`, không có warning |
| 5 user | owner, reviewer, operator, approver2, approver3 — tạo xong, `PENDING` = 0 sau drain |
| Realm role (đọc lại từ server) | owner: `_tide_encryptor`, `_tide_decryptor`, `us-owner` · reviewer: `_tide_encryptor`, `_tide_decryptor` · operator: `us-operator` · approver2/3: không có · **không ai có `_tide_*` qua default roles** |
| Invite link | đã sinh cho cả 5, hạn 12 giờ |

**Hai lỗi thật gặp phải, đã sửa trong script:**

1. `POST /users` trả `400 {"field":"email","errorMessage":"error-user-attribute-required"}`.
   Realm (sau `setUpTideRealm` với `isRagnarokEnabled=true`) đặt `email.required=[admin,user]` trong
   user profile, nhưng 5 danh tính là tài khoản synthetic không có email và pack cấm bịa email
   placeholder (AP-85). Sửa: `bootstrap.sh` bước 2c bỏ `required` của `email` **trước** `toggle-iga`,
   rồi đọc lại để xác nhận.
2. Gán 3 realm role trong **một** request thì chỉ role đầu tiên có hiệu lực — CR thứ hai của cùng một
   user bị `PENDING_CHANGE_REQUEST_CONFLICT` và **im lặng không áp dụng** (`drain` vẫn báo `PENDING = 0`).
   Sửa: `users.sh` gán từng role một, drain sau mỗi lần, rồi đọc lại role của user và `exit 1` nếu thiếu.

**Chưa làm (chờ người thật):** 5 người mở invite link và liên kết tài khoản Tide → rồi
`CONFIRM_FLIP=yes bash scripts/tide/finalize.sh` (gán `tide-realm-admin`, **một chiều**).

### Câu hỏi mở ở plan mục 8 — trạng thái

| # | Câu hỏi | Trả lời đo được |
|---|---|---|
| 1 | Mạng ORK có contract `RelationshipAttestation:1`? | **CHƯA biết.** Contract nằm trên mạng ORK (image trỏ tới mạng production), không nằm trong image. Lên ORK `main` từ 2026-10-16; image build 2026-10-13 nhưng điều đó không quyết định. Chỉ T3 trả lời được |
| 2 | Free tier giới hạn mấy user? | Tạo 5 user **không bị chặn** |
| 3 | QEA có chạy Tide mode? | **Có**: `iga.attestor=tide`, `iga-status` → `{"enabled":true}` |
| 4 | Phiên bản server để khớp npm? | Keycloak 26.7.5; jar Tide là `1.0-SNAPSHOT` → **không đối chiếu được** với `0.14.x` của npm. Nếu login lỗi lạ, đây là nghi phạm đầu tiên |

### 2026-10-22 — M-A (Papersec) bước 1–3

`bash scripts/tide/pivot.sh` (realm còn firstAdmin, chưa ai liên kết Tide). Kết quả đọc lại từ server:

| User | Realm role sau pivot |
|---|---|
| owner | `_tide_encryptor`, `_tide_decryptor`, `ps-author`, `default-roles-unreleased` |
| approver2 | `_tide_encryptor`, `_tide_decryptor`, `ps-author`, `default-roles-unreleased` |
| approver3 | `_tide_encryptor`, `_tide_decryptor`, `ps-author`, `default-roles-unreleased` |
| reviewer | `_tide_encryptor`, `_tide_decryptor`, `ps-paper-p3-reader`, `default-roles-unreleased` |
| operator | `ps-operator`, `default-roles-unreleased` (không có `_tide_*`) |

- Realm role mới: `ps-author`, `ps-operator`, `ps-paper-p1-reader`, `ps-paper-p2-reader`, `ps-paper-p3-reader`.
- Đã xóa role cũ: `us-owner`, `us-operator`, `us-trk-t1/t2/t3-reviewer`. `PENDING` = 0 sau drain.
- `REALM_ADMINS` trong `scripts/tide/common.sh` đổi `operator approver2 approver3` → **`owner approver2 approver3`** (plan v4 D6).
- `node scripts/make-sample-papers.mjs` → `samples/p1.pdf` 1,81 MB / 220 trang, `p2.pdf` 2,14 MB / 260 trang,
  `p3.pdf` 1,48 MB / 180 trang. Header `%PDF-1.4`; `qlmanage` render được trang 1 (PDF hợp lệ). `samples/` đã gitignore.

**Chưa chạy (chặn):** `finalize.sh` — cả 5 user vẫn `tideUserKey` rỗng (chưa ai mở invite link).
Do đó T1, T2, T3 vẫn TRỐNG.

### 2026-10-22 — Liên kết tài khoản Tide: bị chặn bởi giới hạn licence

Đọc lại từ server (`tideUserKey`): **owner đã liên kết**; reviewer, operator, approver2, approver3 **chưa**.

Ba lỗi gặp theo thứ tự, mỗi lỗi che lỗi sau:

| Triệu chứng trên trình duyệt | Nguyên nhân thật (log TideCloak / trang ORK) |
|---|---|
| "We are sorry… Invalid parameter: redirect_uri" | Chỉ là hậu quả. Log: `LinkTideAccount: Could not Link Tide Account: Tide account already linked` → `rejected_by_user` → Keycloak quay về `/account/?error=access_denied&iss=…` và tự từ chối vì tham số `iss` bị cấm |
| (cùng trang trên) | Dùng lại tài khoản Tide đã gắn với owner. **Mỗi tài khoản Tide chỉ gắn được một user trong realm** → cần 5 tài khoản Tide khác nhau |
| ORK "Create an account": *"This action isn't available on your current plan — … hit its user limit"* | **Licence của realm chạm giới hạn số tài khoản Tide liên kết** sau user đầu tiên. Đổi tên/email không qua được |

Sửa lại câu hỏi mở số 2 (mục 8): "tạo 5 user không bị chặn" chỉ đúng với **user Keycloak**. Giới hạn licence
tính trên **tài khoản Tide được liên kết**, và hiện chỉ có 1/5.

**Trạng thái:** đã nhờ BTC/đội Tide nâng giới hạn lên ≥ 5. **Không chạy `finalize.sh`** khi chưa đủ 5 người liên kết
(mục 8, G1): ngưỡng sẽ sai và không đảo ngược được. T1–T16 vẫn TRỐNG.

### 2026-10-22 — Mạng ORK quá tải; BTC công bố Plan C

Thử liên kết tiếp sau khi licence được nâng lên 10 user. Lỗi **từ mạng ORK công khai của Tide**,
không phải từ realm local:

| Lần | Thông báo thật trên `ork1.tideprotocol.com` |
|---|---|
| 1 | `Could not reach enough NEW ORKs (got 2 of 20 required, 18 of 20 failed)` |
| 2 | `Request to /Network/Authentication/Users/GetReservers/... returned HTTP 503` |
| 3 | `Could not reach enough NEW ORKs (got 18 of 20 required, 1 of 20 failed)` — đỡ dần nhưng vẫn chưa đủ |

Một lỗi phụ đã hiểu rõ: **link liên kết chỉ dùng được MỘT lần**. Bấm lại link cũ sau khi lỗi giữa
chừng thì TideCloak báo `TokenSignatureInvalidException: Invalid token signature` (log local,
token_id khớp link đã dùng). Mỗi lần hỏng phải sinh link mới bằng `scripts/tide/invite.sh`.

**BTC công bố Plan C** (https://tide.org/unlocked/#plan-c, Discord 15:40): xây prototype như thể
TideCloak bảo vệ và **mô phỏng** các lớp bảo vệ; *"Simulated and live integrations are judged
exactly the same."*

**Đã làm theo:** `npm run preview:ui` chạy bản mô phỏng ba lớp — `realm.js` (quorum 2/3),
`ork.js` (policy + expiry + role), `db.js` (thứ Operator sửa được). 7 test ở `npm run test:sim`
chứng minh các luật được thực thi: sai paper, hết hạn, thiếu `_tide_decryptor`, policy bị sửa.
Mã nguồn thật không bị sửa dòng nào — `vite.config.js` chỉ đổi hướng 4 import ở mode `preview-ui`.

**Trạng thái:** owner 1/5 đã liên kết thật. T1–T16 trên Tide thật vẫn TRỐNG; chưa chạy
`finalize.sh`. Vẫn thử liên kết thật song song khi mạng Tide ổn định.

### 2026-10-22 — T10 (thu hồi) trên bản mô phỏng Plan C

Đã làm thu hồi quyền đi qua **đúng quorum như khi cấp** (`REVOKE_ROLE` change request, 2/3).
Đo được trên bản mô phỏng (`npm run test:sim`, 34 test):

| Điều kiện | Kết quả |
|---|---|
| 1/2 phiếu duyệt thu hồi | role **vẫn còn** |
| 2/2 phiếu | role bị gỡ |
| Operator tạo CR thu hồi | 0 phiếu; Operator tự duyệt → `403` |
| Token đã cấp TRƯỚC khi thu hồi | **vẫn đọc được** cho tới khi hết hạn |
| Token cấp SAU khi thu hồi | `403` |
| Token quá `TOKEN_TTL_MS` (600s, khớp `accessTokenLifespan` đo ở realm thật) | `401` |

**Độ trễ thu hồi = vòng đời token**, ở đây là 600 giây. Đây là con số T10 hỏi, nhưng mới đo trên
bản mô phỏng; trên Tide thật vẫn TRỐNG. README và kịch bản demo nói rõ: thu hồi chặn truy cập
**về sau**, không thu hồi được bản PDF người ta đã xem.
