# Papersec — Kế hoạch thi Hackathon (v4, pivot sang paper nghiên cứu)

> **"Share the manuscript. Never surrender the vault."**
> *Tên sản phẩm đã chốt: **Papersec**. Prefix role: `ps-`. Nhánh: `feat/papersec`.*
>
> v4 (2026-10-22): đổi ý tưởng từ "track nhạc" (Unreleased Studio) sang **chia sẻ paper nghiên cứu chưa công bố**.
> **Giữ toàn bộ hạ tầng đã dựng**: realm `unreleased`, 5 tài khoản, auth/DPoP, helper mã hóa. **Viết lại** lớp nghiệp vụ và UI.
> Mỗi session milestone: đọc file này trước, chỉ sửa đúng phạm vi của mình, ghi kết quả vào `docs/VERIFICATION_LOG.md`.

---

## 1. Sản phẩm

### 1.1. Bài toán

Học viên/nhóm nghiên cứu cần gửi **bản thảo paper chưa công bố** cho đúng người: giáo sư phản biện bên ngoài, hội đồng, đối tác. Gửi qua email, Drive hay nền tảng nộp bài nghĩa là **nhà cung cấp và admin của họ đọc được toàn bộ bản thảo**. Thêm nữa, chỉ cần **một** người (một đồng tác giả bất cẩn, một admin) là đủ để bản thảo lọt ra ngoài trước khi công bố: mất quyền ưu tiên khoa học, bị đánh cắp ý tưởng.

### 1.2. Khả năng mới mà đề bài yêu cầu

> **Một bản thảo chỉ mở được cho đúng người nhận, đúng paper, trong đúng thời hạn, và chỉ khi nhóm tác giả cùng đồng ý (2/3). Không ai có quyền vượt rào một mình: kể cả một tác giả, kể cả admin nền tảng.**

### 1.3. Ánh xạ với đề bài

| Đề bài | Papersec |
|---|---|
| *"no single administrator, organisation or AI can unilaterally override the rules"* | Operator (chạy server + master admin TideCloak) không đọc được, không tự cấp quyền, không gia hạn được. Một tác giả đơn lẻ cũng không gửi paper ra ngoài một mình được |
| **Emergent Authority**: *identity + policy + approvals* | **Identity**: người nhận đăng nhập Tide · **Policy**: mỗi paper có policy riêng với **hạn chót ký bằng mật mã** · **Approvals**: 2/3 tác giả |
| *"Invite a reviewer to one … Show that others stay unreadable, including from an operator account"* | Mời 1 người phản biện vào **paper p1**; p2 không mở được với người phản biện và với Operator |
| *"Any revocation stops future access; cannot recall material already viewed"* | Hết hạn/thu hồi chặn truy cập **về sau**; nói rõ không thu hồi được bản đã xem |
| *"Use synthetic data"* | 3 paper PDF tổng hợp sinh bằng script |

### 1.4. Các quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Chia sẻ một paper ra ngoài cần **2/3 nhóm tác giả** (Tác giả chính, GV hướng dẫn, Đồng tác giả) duyệt qua QEA |
| D2 | Luật strict: **(1) chỉ đúng paper được cấp**, **(2) hết hạn tự động**, do mạng ORK thực thi |
| D3 | Người nhận gửi được **nhận xét mã hóa**, chỉ nhóm tác giả đọc (mô hình "hộp thư") |
| D4 | **Không** làm "chỉ xem + watermark" (không chọn); trình xem PDF của trình duyệt cho phép tải về, và README nói rõ điều này |
| D5 | **Giữ hạ tầng**: Docker local, realm `unreleased`, client `unreleased-client`, 5 user đã tạo |
| D6 | Operator **không** thuộc nhóm duyệt (thay quyết định cũ "Operator là Approver 1") |
| D7 | Còn khoảng 6–7 giờ, 3 người. Backend Express 5 + `jose` + `node:sqlite` + `node:test` |
| D8 | Giữ `Video.mp4`, giữ Git history; đã đồng ý Tide T&C; email license không vào repo |

---

## 2. Nhân vật và danh tính

Dùng lại 5 user đã tạo, chỉ đổi vai (username giữ nguyên, tên hiển thị đặt qua onboarding):

| User hiện có | Vai mới | Realm role | `tide-realm-admin` |
|---|---|---|---|
| `owner` | **Tác giả chính** (học viên) | `ps-author`, `_tide_encryptor`, `_tide_decryptor` | **Có** |
| `approver2` | **GV hướng dẫn** | `ps-author`, `_tide_encryptor`, `_tide_decryptor` | **Có** |
| `approver3` | **Đồng tác giả** | `ps-author`, `_tide_encryptor`, `_tide_decryptor` | **Có** |
| `reviewer` | **Người phản biện** (bên ngoài) | `_tide_encryptor`, `_tide_decryptor` (+ `ps-paper-<id>-reader` khi được cấp) | Không |
| `operator` | **Operator nền tảng**: chạy server, DB, storage, giữ master admin của TideCloak | `ps-operator` (chỉ để vào Operator Console) | **Không** |

3 `tide-realm-admin` → ngưỡng mục tiêu **2** (phải kiểm chứng T2 sau `REGEN_ADMIN_POLICY`).

---

## 3. Mô hình phân quyền

### 3.1. Dữ liệu demo (3 paper tổng hợp)

| Paper | Mã | Record nội dung | Record nhận xét | Role người đọc | Vai trong demo |
|---|---|---|---|---|---|
| p1 | "Low-Resource ASR for Vietnamese Dialects" | `doc:p1` | `fb:p1` | `ps-paper-p1-reader` | **Chia sẻ trực tiếp trong demo** cho người phản biện, hạn 7 ngày |
| p2 | "Federated Learning on Hospital Imaging" | `doc:p2` | `fb:p2` | `ps-paper-p2-reader` | **Không chia sẻ**: người phản biện và Operator thử mở |
| p3 | "Quantum-Safe Voting Protocol" | `doc:p3` | `fb:p3` | `ps-paper-p3-reader` | **Đã chia sẻ nhưng hết hạn** (hạn ngắn, đặt lúc ký) |

**Mức độ lộ của tiêu đề:** tiêu đề là metadata server thấy được. *Nên có nếu kịp*: server chỉ lưu mã `p1/p2/p3`, tiêu đề thật mã hóa cùng record `doc:<id>`.

### 3.2. Policy `RelationshipAttestation:1` (ký một lần khi chuẩn bị, bởi một tác giả trong enclave)

| Policy | Subject | Record | `roles` | `expiry` | Cần cho |
|---|---|---|---|---|---|
| A-doc-X | `Role` = `ps-author` | `doc:X` | encrypt + decrypt | không | p1, p2, p3 (tác giả mã hóa/đọc) |
| R-doc-X | `Role` = `ps-paper-X-reader` | `doc:X` | **decrypt** | **hạn phản biện** | p1 (+7 ngày), p3 (ngắn, đã qua lúc demo) |
| A-fb-X | `Role` = `ps-author` | `fb:X` | decrypt | không | p1, p3 |
| R-fb-X | `Role` = `ps-paper-X-reader` | `fb:X` | **encrypt** (hộp thư) | hạn phản biện | p1, p3 |

Tổng cộng **9 lần ký** (p2 chỉ cần A-doc). Nếu enclave nhận nhiều request trong một popup thì ít lần hơn ([GIẢ THUYẾT], T6).

**Vì sao dùng `Role` thay vì `User`:**
- Cấp/thu hồi chỉ là gán/gỡ role, đi qua quorum QEA.
- Policy không phải ký lại mỗi lần mời người mới.

**Hạn chót** là thuộc tính của policy đã ký, tức **hạn của cả đợt phản biện paper đó**, không riêng từng người. Hạn riêng từng người sẽ cần mỗi lần mời một role + một policy mới, quá tốn cho 6 giờ: chỉ để *nên có*.

### 3.3. Luật "chỉ đúng paper": ba lớp

| Lớp | Cơ chế | Mức xác minh |
|---|---|---|
| Backend | `GET /api/papers/:id/blob` chỉ trả khi JWT có `ps-paper-<id>-reader` **khớp đúng `:id`**, hoặc `ps-author` | Code + test [MOCK] |
| Mạng ORK | Tag phải đúng `doc:<id>`; người gọi phải có role của policy và `_tide_decryptor` | [PACK]; T9 |
| Governance | Có được role `ps-paper-<id>-reader` thì phải qua CR, 2/3 tác giả | [DOCS]; T2, T13 |

### 3.4. Luật "hết hạn tự động"

- **ORK** kiểm tra `expiry` của policy **trước khi** chạy contract [PACK]. Sau hạn, giải mã bị từ chối dù role vẫn còn.
- **Backend** cũng lưu `review_until` và trả `403` sau hạn. Lớp này chỉ để trải nghiệm tốt: Operator sửa DB được.
- **Demo đắt giá**: Operator sửa `review_until` trong DB để "gia hạn" p3 → backend trả ciphertext → **ORK vẫn từ chối**, vì hạn nằm trong policy đã ký bằng threshold. Server **không gia hạn được**. → T16

### 3.5. Operator không mở được p2

| Operator thử | Bị chặn bởi | Thí nghiệm |
|---|---|---|
| Đọc file trên đĩa / dump SQLite | Chỉ có ciphertext (kiểm tra magic `%PDF` không xuất hiện) | T14 |
| Gọi API p2 bằng tài khoản của mình | Backend `403` | test |
| Sửa DB để tự cấp quyền | Backend chỉ tin role trong JWT do Tide ký | T14 |
| Lấy ciphertext + policy rồi giải mã | ORK: không có `ps-paper-p2-reader`, không có `_tide_decryptor` | T9 |
| Dùng master admin TideCloak tự gán role | Thành CR PENDING, cần 2/3 tác giả; Operator không phải `tide-realm-admin` | **T12** |
| Duyệt CR thay tác giả | `403`: không có `tide-realm-admin` | T12 |
| Sửa JavaScript gửi xuống trình duyệt | **Không chặn được.** Giới hạn của mọi web E2EE | README |

### 3.6. Rủi ro do tác giả cũng là admin

Một `tide-realm-admin` đơn lẻ có thể **tự ký một policy** `User = người nhận` mà không cần quorum hay không: chưa biết (T6/T15).

- Nếu được, người nhận vẫn cần ciphertext, mà backend chỉ trả khi có role (role cần quorum). Lớp chặn còn lại là backend, tức Operator là người giữ cửa.
- Phải đo T15 và **nói đúng kết quả**, không giấu.

---

## 4. Luồng nghiệp vụ

**Chuẩn bị** (trước demo, sau `finalize.sh`):
1. Một tác giả ký 9 policy.
2. Tác giả chính mã hóa 3 PDF và tải lên.
3. Cấp `ps-paper-p3-reader` cho người phản biện (2/3 duyệt), rồi để p3 hết hạn.

**Luồng chính (live demo):**
1. **Tác giả chính** mở p1 → "Mời phản biện" → chọn `reviewer` → app gọi admin API **từ trình duyệt của chính tác giả** → CR "gán `ps-paper-p1-reader`" (`202`). Nếu CORS chặn (T8) thì tác giả gán trong tide-console.
2. tide-console → **QEA Approvals**: Tác giả chính duyệt (**1/2**, vẫn PENDING). **Operator** thử duyệt → bị từ chối. **GV hướng dẫn** duyệt → **2/2**, áp dụng.
3. **Người phản biện** refresh token → thấy p1 → mở PDF (giải mã trong trình duyệt) → gửi nhận xét (mã hóa, hộp thư).
4. Người phản biện thử mở p2 qua API → `403`. Thử p3 → `403`/ORK từ chối vì **đã hết hạn**.
5. **Operator Console**: storage chỉ có byte ngẫu nhiên; tải ciphertext p2 → giải mã → **ORK từ chối**; "gia hạn" p3 trong DB → **ORK vẫn từ chối**.
6. **GV hướng dẫn** đọc nhận xét đã giải mã.
7. *(nếu kịp)* Thu hồi: CR gỡ role → người phản biện `403` (đo số giây).

---

## 5. Kiến trúc và mã nguồn

### 5.1. Tái dùng và viết lại

| Thành phần | Hiện trạng | Việc cần làm |
|---|---|---|
| `server/auth.js`, `server/verifyDpop.ts`, `requireAuth`, CORS/CSP | Xong, có test | **Giữ.** Đổi tên helper role (`isOwner` → `isAuthor`, `isReviewerOf` → `isReaderOf`, prefix `ps-paper-`) |
| `server/db.js` | Bảng `tracks`… | Đổi `tracks` → `papers` (`id`, `code_title`, `review_until`, `blob_size`, `updated_at`); `record` `trk` → `doc`; seed p1–p3 |
| `server/routes/tracks.js` | | → `papers.js`; blob tối đa 15 MB; thêm kiểm tra `review_until` |
| `server/routes/feedback.js`, `shares.js`, `audit.js` | | Đổi tên; quyền đọc nhận xét = `ps-author` |
| `server/routes/operator.js` | | Giữ; thêm `PATCH /api/operator/papers/:id/review-until` (**cố ý** cho Operator sửa DB, phục vụ T16) |
| `server/test/*` | | Sửa theo tên mới; thêm test hết hạn ở backend |
| `src/lib/relationship.js`, `src/lib/api.js` | Xong (đã có `expiry`, `decryptBytesForRecord`) | **Giữ** |
| `src/lib/audio.js` | | **Xóa** |
| `src/App.jsx` (467 dòng, UI nhạc) | | **Viết lại**: 4 tab (mục 5.3) |
| `src/ProfileOnboarding.jsx` | | Giữ (đặt tên hiển thị) |
| `scripts/tide/bootstrap.sh`, `users.sh` | Đã chạy | **Không chạy lại.** Viết `scripts/tide/pivot.sh` (mục 6, M-A) |
| `scripts/tide/finalize.sh` | **Chưa chạy, một chiều** | **Sửa trước khi chạy**: admin = `owner approver2 approver3` (không phải `operator`) |
| `scripts/make-sample-papers.mjs` | Chưa có | Sinh 3 PDF tổng hợp vào `samples/` (không nằm trong `public/`) |

### 5.2. API (đích)

| Route | Ai | Kiểm tra trên server |
|---|---|---|
| `GET /api/me` | mọi người | ghi `tideuserkey` |
| `GET /api/papers` | mọi người | Tác giả: cả 3; người khác: chỉ paper có role reader |
| `PUT /api/papers/:id/blob` | `ps-author` | ciphertext ≤ 15 MB |
| `GET /api/papers/:id/blob` | `ps-author` **hoặc** (`ps-paper-<id>-reader` **và** chưa quá `review_until`) | khớp đúng `:id` |
| `GET /api/papers/:id/policy?for=doc\|fb` | như trên | chỉ policy có subject khớp người gọi |
| `POST /api/papers/:id/policies` | `tide-realm-admin` | đúng paper, đúng record |
| `POST /api/papers/:id/feedback` | reader của paper, còn hạn | ciphertext |
| `GET /api/papers/:id/feedback` | `ps-author` | |
| `POST /api/papers/:id/invites` | `ps-author` | ghi lời mời + `change_request_id` (chỉ để hiển thị) |
| `GET /api/operator/storage`, `GET /api/operator/blob/:id`, `PATCH /api/operator/papers/:id/review-until` | `ps-operator` | **cố ý** cho đủ quyền hạ tầng |
| `GET /api/audit` | tác giả, Operator | không token / proof / policy / plaintext |

### 5.3. Giao diện (4 tab, hiện theo role trong token)

1. **Phòng tác giả** (`ps-author`): danh sách paper, trạng thái (đã mã hóa / ai đang đọc / hạn); nút *Mã hóa & tải lên PDF*; nút *Mời phản biện* (tạo CR); đọc nhận xét đã giải mã.
2. **Hộp thư phản biện** (người nhận): chỉ paper được cấp; trình xem PDF (bytes đã giải mã → `Blob` → `<iframe>`); hạn còn lại; ô nhận xét (mã hóa); nút **"Thử mở paper khác"** (hiện `403` / lỗi ORK).
3. **Operator Console** (`ps-operator`): bảng storage (hex, "không phải `%PDF`"); *Giải mã p2*; *Gia hạn p3 trong DB*; hiển thị **lỗi thật** từ ORK (lấy từ `cause`).
4. **Ký policy** (`tide-realm-admin`, chỉ dùng lúc chuẩn bị): ký 9 policy theo bảng 3.2.

Thanh trên cùng: tên, role trong token, nút **Refresh token**.

---

## 6. Phân công và session (3 người, chạy song song bằng git worktree)

**Bước 0 (5 phút, trước khi chia):**
- Commit trạng thái hiện tại lên `feat/unreleased-studio` làm mốc lùi.
- Đổi tên nhánh thành `feat/papersec`.
- Tạo worktree `../ps-backend` (nhánh `m-b`) và `../ps-frontend` (nhánh `m-c`).
- Dependency đã cài đủ, không ai đụng lockfile.

| Session | Thư mục | Chỉ được sửa |
|---|---|---|
| **M-A Hạ tầng Tide** | `hackathon-main/` | `scripts/**`, `docs/VERIFICATION_LOG.md`, `samples/` |
| **M-B Backend** | `../ps-backend/` | `server/**` |
| **M-C Frontend** | `../ps-frontend/` | `src/**`, `index.html` |

### M-A — prompt mở đầu
"Đọc `docs/IMPLEMENTATION_PLAN.md` mục 1–4, 6, 8. Làm M-A theo đúng thứ tự, hỏi tôi trước mọi bước một chiều:
1. Viết + chạy `scripts/tide/pivot.sh`, **trước** khi realm thành multiAdmin:
   - tạo realm role `ps-author`, `ps-operator`, `ps-paper-p1/p2/p3-reader`;
   - gán `ps-author` + `_tide_encryptor` + `_tide_decryptor` cho `approver2`, `approver3`; gán `ps-author` cho `owner`;
   - gán `ps-operator` cho `operator`, gỡ `us-operator`;
   - **gán sẵn `ps-paper-p3-reader` cho `reviewer`**;
   - xóa các role `us-*` cũ;
   - mỗi lần gán xong thì drain và đọc lại.
2. Sửa `finalize.sh`: admin = `owner approver2 approver3`.
3. Sinh 3 PDF tổng hợp (`scripts/make-sample-papers.mjs`).
4. Khi 5 người đã liên kết tài khoản Tide → chạy `finalize.sh` (**một chiều**) → `REGEN_ADMIN_POLICY` → T2.
5. Ký thử 1 policy (T3)."

**Done khi:** role đúng như bảng mục 2 (đọc lại từ server); T2 threshold = 2; T3 pass.

### M-B — prompt mở đầu
"Đọc plan mục 3, 5.1, 5.2. Trong `../ps-backend`, chuyển backend từ tracks sang papers đúng bảng 5.1/5.2, giữ nguyên `auth.js`/`verifyDpop.ts`, thêm kiểm tra `review_until` và route Operator sửa hạn. Cập nhật test. Chỉ sửa `server/**`."

**Done khi:** `npm test` pass, gồm 401, 403 sai paper, 403 hết hạn, sửa DB không cấp quyền, audit không chứa secret.

### M-C — prompt mở đầu
"Đọc plan mục 3, 4, 5.3. Trong `../ps-frontend`, viết lại `App.jsx` thành 4 tab ở 5.3, dùng `relationship.js` sẵn có (`Uint8Array` cho PDF), xóa `audio.js`. Chỉ sửa `src/**`, `index.html`."

**Done khi:** `npm run build` pass; với mock API (hoặc backend thật), luồng mở PDF từ bytes chạy được.

### M-D — Tích hợp (cả đội, sau khi A có T3)
"Merge `m-b`, `m-c` vào `feat/papersec`. Ký 9 policy, mã hóa 3 PDF, chạy luồng mục 4. Ghi T4, T5, T9, T12, T13, T14, T16."

### M-E — Demo + README (sau feature freeze)
"Viết README tiếng Việt theo mẫu hackathon (mục 9). Diễn tập 2 lần. Commit + push."

---

## 7. Timeline (~6,5 giờ)

| Giờ | A — Tide | B — Backend | C — Frontend |
|---|---|---|---|
| 0:00–0:15 | Bước 0 (cả đội) | | |
| 0:15–1:15 | `pivot.sh` + sửa `finalize.sh` + PDF mẫu; nhắc 5 người liên kết tài khoản | papers/feedback/invites + test | Khung 4 tab, trình xem PDF |
| **⛳ 1:15 G1** | **Role đúng như bảng mục 2. Sau đó mới chạy `finalize.sh`** | | |
| 1:15–2:15 | `finalize.sh` → `REGEN_ADMIN_POLICY` → T2; T1 login 5 người | expiry + operator routes + test | Mời phản biện (CR từ trình duyệt), Operator Console |
| **⛳ 2:15 G2** | **T3: ký được policy `RelationshipAttestation:1`** (nếu lỗi → mục 8) | | |
| 2:15–3:45 | **M-D**: merge, ký 9 policy, mã hóa 3 PDF (T4, T5) | sửa bug tích hợp | sửa bug tích hợp |
| **⛳ 3:45 G3** | **Người phản biện mở được p1 sau 2/3 duyệt** | | |
| 3:45–4:45 | p3 hết hạn (T16), Operator thử (T9, T12, T14) | audit, rà secret | nhận xét mã hóa, hoàn thiện UI |
| **⛳ 4:45 G4 = FEATURE FREEZE** | **Luồng mục 4 bước 1–6 chạy trọn** | | |
| 4:45–5:45 | VERIFICATION_LOG; thu hồi nếu kịp | chạy lại test | README + kịch bản |
| 5:45–6:30 | **Diễn tập 2 lần**, quay video dự phòng, commit, push, nộp | | |

---

## 8. Go/no-go và phương án lùi

| Mốc | Nếu thất bại | Phương án lùi (trung thực) |
|---|---|---|
| G1 | Không gán được role (CR lỗi) | Đọc lại state; xử lý `PENDING_CHANGE_REQUEST_CONFLICT` bằng cách gán từng role một (đã biết từ M1-A) |
| G1 | Chưa đủ 5 người liên kết tài khoản | **Không** chạy `finalize.sh` khi thiếu tác giả: ngưỡng sẽ sai |
| G2 | `RelationshipAttestation:1` không có trên mạng ORK | Không tự viết contract. Demo governance + backend; README ghi rõ chưa có E2EE theo từng paper; hỏi Tide team (Discord) |
| G2 | Ký policy cần quorum (T6) | Hai tác giả cùng ký; lâu hơn, nên bắt đầu sớm |
| G3 | PDF `Uint8Array` lỗi | Base64 string (helper đã đo với string), chấp nhận overhead 33% |
| G3 | Admin API bị CORS chặn (T8) | Tác giả gán role trong tide-console, dán `change_request_id` vào app |
| G4 | Hết hạn ORK không đo được | Chỉ demo hạn ở backend, **nói rõ** chưa kiểm chứng ở ORK |

---

## 9. README (giữ badge + 5 mục mẫu hackathon)

| Mục | Nội dung |
|---|---|
| Overview | "Papersec: share an unpublished paper with exactly one reviewer, for a fixed window. No single author, admin or platform operator can open, extend or leak it alone." |
| 1. Vision | Kênh gửi bản thảo cho học viên/nhóm nghiên cứu |
| 2. Trust constraint | Nền tảng hiện nay đọc được mọi bản thảo; một người là đủ làm lộ → quyền ưu tiên khoa học bị đe dọa |
| 3. Value | Ví dụ: học viên gửi luận văn chưa công bố cho phản biện ngoài trường, hạn 7 ngày |
| 4. Why TideCloak | Bảng identity/policy/approvals (1.3) + bảng Operator (3.5) + T16 (hạn không gia hạn được) |
| 5. Prototype | Luồng mục 4 + **giới hạn**: tải/chụp màn hình sau khi xem được; JS frontend do Operator phục vụ; metadata (tên paper nếu chưa mã hóa); thu hồi không lấy lại được bản đã xem; các thí nghiệm chưa đo |

---

## 10. Sự thật đã xác minh (rút gọn, để code đúng)

| Điểm | Mức |
|---|---|
| Self-encryption chỉ người mã hóa mở được → không dùng | [PACK] |
| `IAMService.doEncrypt([{data: string\|Uint8Array, tags:[record]}], policyBytes)` | [SDK] `@tidecloak/js` |
| `RelationshipAttestation:1`: **đúng 1 tag = `assignmentId`**; `roles` là JSON **dạng string**; `_tide_encryptor/_tide_decryptor` là **realm role**, **không** vào default roles; có `expiry`, kiểm tra trước contract | [PACK] |
| Mã hóa dưới policy A, giải mã dưới policy B cùng record | [PACK-LOCAL] → T4 |
| Lỗi từ chối hiện thành `Could not reach enough VVK ORKs`: đọc `cause`, không retry | [PACK] |
| Ngưỡng QEA = ngưỡng trong admin policy đã ký; 3 admin cần `REGEN_ADMIN_POLICY` | [PACK] → T2 |
| Người tạo CR được tính 1 phiếu; phiếu ghi cho người gọi HTTP → không proxy approve qua backend | [PACK] |
| Sau khi có `tide-realm-admin`, script không duyệt được nữa (`409`) → mọi cấu hình role phải xong **trước** `finalize.sh` | [PACK][DOCS] |
| Gán nhiều role cho một user trong một request: chỉ role đầu áp dụng (`PENDING_CHANGE_REQUEST_CONFLICT`) | **[ĐO-LOCAL]** M1-A |
| Realm: `iga.attestor=tide`, IGA bật, license `CREATED`, `accessTokenLifespan` 600s | **[ĐO-LOCAL]** M1-A |

## 11. Thí nghiệm (ghi vào `VERIFICATION_LOG.md`)

| ID | Ưu tiên | Nội dung | Pass khi |
|---|---|---|---|
| T1 | P0 | Login 5 người + backend verify DPoP | `200`; sai proof → `401` |
| T2 | P0 | 3 admin → ngưỡng | CR có `threshold = 2` |
| T3 | P0 | Ký policy `RelationshipAttestation:1` | Có chữ ký |
| T4 | P0 | Tác giả mã hóa (A-doc), người phản biện giải mã (R-doc) | Đúng byte |
| T5 | P0 | PDF ~1–5 MB dạng `Uint8Array` | Đúng hash |
| T9 | P0 | Operator / người phản biện giải mã p2 | ORK từ chối |
| T13 | P0 | CR mới 1/2 phiếu | Người phản biện vẫn `403` |
| T14 | P0 | Storage/DB không có `%PDF`; sửa DB không cấp quyền | Đúng |
| **T16** | P0 | p3 quá hạn; Operator sửa `review_until` | **ORK vẫn từ chối** |
| T12 | P1 | Master admin gán role; Operator thử duyệt CR | CR PENDING; duyệt bị `403` |
| T6 | P1 | Ký nhiều policy trong một popup? Một admin đủ chưa? | Ghi lại |
| T15 | P1 | Một tác giả tự ký policy `User` cho người nhận | Ghi lại thực tế |
| T8 | P1 | Tạo CR từ trình duyệt (CORS) | `202` hoặc phải dùng tide-console |
| T10 | P2 | Thu hồi: số giây đến khi `403` | Ghi số đo |

Test `node:test` dùng JWT tự sinh **[MOCK]**: chỉ chứng minh logic của chúng ta, **không** chứng minh tích hợp Tide.

## 12. Hành động một chiều (luôn hỏi chủ dự án trước)

`finalize.sh` (gán `tide-realm-admin`, đóng đường tự động hóa) · `REGEN_ADMIN_POLICY` · commit CR · ký policy · xóa role/realm · merge `main` / push / nộp.

## 13. Nhật ký

| Thời điểm | Việc | Kết quả |
|---|---|---|
| 2026-10-22 | M0, plan v1–v3 (Unreleased Studio) | |
| 2026-10-22 | M1-A giai đoạn A | Realm, license, IGA Tide mode, 5 user (xem VERIFICATION_LOG) |
| 2026-10-22 | M1-B / M1-C | Backend + test, frontend nhạc (chưa commit) |
| 2026-10-22 | **Plan v4: pivot sang Papersec** | Chờ chủ dự án duyệt |
