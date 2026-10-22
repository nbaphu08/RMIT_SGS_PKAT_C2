# Kịch bản demo Papersec (~5 phút)

Theo plan mục 4. Mỗi vai một Chrome profile, đã đăng nhập sẵn trước khi bắt đầu.

## Hai cách chạy demo

**A. Bản mô phỏng (Plan C — dùng được ngay):** `npm run preview:ui` → http://localhost:5138.
Mỗi **tab** là một người, thay cho 5 Chrome profile. Mở 4 tab: owner, approver2, reviewer, operator.
Bỏ qua phần "Chuẩn bị" bên dưới — realm, policy và dữ liệu đã seed sẵn; chỉ cần vào tab Ký policy
(owner) bấm ký 9 policy, rồi tải `samples/p1.pdf` lên. Các cảnh 1–6 chạy y nguyên.

**B. Tích hợp Tide thật:** cần `finalize.sh` đã chạy và 5 người đã liên kết tài khoản Tide.
Làm theo phần "Chuẩn bị" bên dưới.

## Chuẩn bị (bản thật — trước demo, không quay)

- [ ] `finalize.sh` đã chạy, T2 (ngưỡng = 2) đã đo.
- [ ] Tab **Ký policy** (owner): đã ký đủ 9 policy, có cột trạng thái "đã ký và lưu".
- [ ] **Phòng tác giả** (owner): đã mã hóa và tải lên `samples/p1.pdf`, `p2.pdf`, `p3.pdf`.
- [ ] reviewer đã có `ps-paper-p3-reader` (pivot.sh), p3 đã hết hạn (`review_until` trong quá khứ).
- [ ] reviewer **chưa** có `ps-paper-p1-reader`.
- [ ] Mở sẵn 5 profile: **owner**, **approver2**, **reviewer**, **operator**, và tide-console (`http://localhost:8080/admin/master/console/`, realm `unreleased`).
- [ ] `npm run server` và `npm run dev` đang chạy.

## Lời mở (20 giây)

> "Học viên muốn gửi luận văn chưa công bố cho một giáo sư phản biện ở trường khác. Gửi qua email hay Drive thì nhà cung cấp đọc được, và chỉ cần một người bất cẩn là lộ. Papersec làm cho một bản thảo chỉ mở được với đúng người, đúng paper, đúng thời hạn, khi 2/3 tác giả đồng ý. Không ai vượt rào một mình được, kể cả người chạy server."

## Cảnh 1: Mời phản biện (45 giây) — profile **owner**

1. Tab **Phòng tác giả**, cho thấy 3 paper đều "đã mã hóa".
2. Ở thẻ p1, bấm **Mời phản biện** (ô người phản biện: `reviewer`).
3. Chỉ dòng trạng thái: *change request đang PENDING, cần 2/3 tác giả duyệt.*

> "Tác giả chính chỉ **mời** được. Quyền đọc chưa có hiệu lực."

## Cảnh 2: Quorum 2/3 (60 giây) — tide-console

1. Owner mở **QEA Approvals**, duyệt CR → **1/2**, vẫn PENDING.
2. Chuyển sang **operator**, thử duyệt → **bị từ chối** (không phải `tide-realm-admin`).
3. Chuyển sang **approver2** (GV hướng dẫn), duyệt → **2/2**, CR được áp dụng.

> "Operator giữ server và master admin, vậy mà không duyệt được. Một tác giả một mình cũng không đủ."

## Cảnh 3: Người phản biện đọc p1 (45 giây) — profile **reviewer**

1. Bấm **Refresh token**, tab **Hộp thư phản biện** hiện p1 với "còn 7 ngày".
2. **Mở bản thảo** → PDF hiện ra (giải mã ngay trong trình duyệt).
3. Gõ nhận xét, bấm **Gửi nhận xét** → "đã gửi nhận xét đã mã hóa".

## Cảnh 4: Chỉ đúng paper, đúng hạn (30 giây) — vẫn **reviewer**

1. **Thử p2** → `403` (không được chia sẻ).
2. **Thử p3** → `403` (đã hết hạn).

## Cảnh 5: Operator thử mọi cách (60 giây) — profile **operator**

1. Tab **Operator Console**: storage chỉ có byte ngẫu nhiên, cột "không phải %PDF".
2. **Thử giải mã p2**: tải được ciphertext và policy từ DB của chính mình → **ORK từ chối** (đọc dòng `cause`).
3. **Gia hạn p3 (+7 ngày)**: DB đã sửa, backend thôi chặn.
4. Quay lại **reviewer**, mở p3 → **ORK vẫn từ chối**: hạn nằm trong policy đã ký bằng threshold.

> "Người chạy server có toàn quyền ổ đĩa, database và master admin. Vẫn không mở được, không gia hạn được."

## Cảnh 6: Tác giả đọc nhận xét (20 giây) — profile **approver2**

1. **Phòng tác giả** → thẻ p1 → **Đọc nhận xét** → nhận xét của reviewer hiện ra.

## Lời kết (20 giây)

> "Thu hồi chặn được truy cập về sau, nhưng không lấy lại được bản đã xem, và trình xem PDF vẫn cho tải về. Chúng tôi nói rõ điều đó trong README. Điều Papersec bảo đảm là: không một cá nhân nào, kể cả nền tảng, tự mình mở, gia hạn hay làm lộ bản thảo."

## Nếu có sự cố khi demo

| Sự cố | Cách xử lý |
|---|---|
| Mời phản biện báo lỗi CORS (T8) | Gán role trong tide-console, dán `change_request_id` vào ô "Ghi" |
| Popup Tide không mở | Cho phép popup `localhost`; bấm lại (không `await` trước khi mở) |
| Reviewer chưa thấy p1 | Bấm **Refresh token** (role chỉ vào token mới) |
| Lỗi lạ khi giải mã | Đọc phần `cause`, **không bấm lại liên tục**; chuyển sang video dự phòng |

Các câu ở cảnh 5 về ORK chỉ được nói khi T9 và T16 trong `VERIFICATION_LOG.md` đã PASS. Nếu chưa đo được, nói đúng là "thiết kế" và chỉ demo phần backend.
