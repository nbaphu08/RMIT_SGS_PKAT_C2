[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

**Papersec:** share an unpublished paper with exactly one reviewer, for a fixed window. No single author, admin or platform operator can open, extend or leak it alone.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

Papersec là kênh gửi **bản thảo nghiên cứu chưa công bố** cho học viên và nhóm nghiên cứu. Một bản thảo chỉ mở được khi đủ bốn điều kiện: **đúng người nhận**, **đúng paper**, **trong đúng thời hạn**, và **nhóm tác giả cùng đồng ý (2/3)**.

Điểm khác biệt: các luật này không nằm trong code của server mà do **mạng mật mã phân tán của Tide** thực thi. Vì vậy chính người vận hành nền tảng cũng không vượt rào được.

### 2. Trust constraint insight

Hôm nay, gửi bản thảo qua email, Google Drive hay hệ thống nộp bài nghĩa là **nhà cung cấp và admin của họ đọc được toàn bộ**. Hơn nữa, chỉ cần **một người** là đủ làm lộ: một đồng tác giả bất cẩn bấm "chia sẻ", hoặc một admin tò mò. Hậu quả là mất **quyền ưu tiên khoa học**, bị lấy ý tưởng trước khi công bố.

Khi gỡ được ràng buộc "phải tin một người giữ chìa khóa", nhóm nghiên cứu có thể đưa bản thảo cho phản biện bên ngoài, hội đồng hay đối tác mà không phải đặt cược vào thiện chí của bất kỳ ai, kể cả nền tảng trung gian.

### 3. Value & impact

**Ví dụ:** một học viên cao học cần gửi luận văn chưa công bố cho một giáo sư phản biện ở trường khác, hạn đọc 7 ngày.

- Tác giả chính bấm "Mời phản biện". Lời mời chỉ có hiệu lực khi **GV hướng dẫn hoặc đồng tác giả** cùng duyệt (2/3).
- Người phản biện đọc được **đúng paper đó**, không thấy paper khác của nhóm, và gửi lại **nhận xét đã mã hóa** mà chỉ nhóm tác giả đọc được.
- Hết 7 ngày, quyền đọc **tự hết hạn**. Không ai gia hạn lén được, kể cả người vận hành server.

Người hưởng lợi: học viên, nhóm nghiên cứu, hội đồng khoa học, và bất kỳ ai cần chia sẻ tài liệu nhạy cảm có thời hạn với người bên ngoài.

### 4. Why TideCloak matters

| Đề bài | Papersec dùng TideCloak thế nào |
|---|---|
| **Identity** | Người nhận đăng nhập bằng tài khoản Tide (DPoP, backend xác minh token) |
| **Policy** | Mỗi paper có policy `RelationshipAttestation:1` riêng, **hạn chót được ký bằng mật mã ngưỡng** |
| **Approvals** | Cấp quyền đọc là một change request, cần **2/3 tác giả** duyệt qua Quorum-Enforced Authorization |

**Người vận hành nền tảng (Operator) không mở được paper chưa được chia sẻ:**

| Operator thử | Bị chặn bởi |
|---|---|
| Đọc file trên đĩa, dump database | Chỉ có ciphertext; PDF được mã hóa ngay trong trình duyệt tác giả |
| Sửa database để tự cấp quyền | Backend chỉ tin role trong token do Tide ký |
| Lấy ciphertext rồi tự giải mã | Mạng ORK từ chối: Operator không có role đọc paper |
| Dùng tài khoản master admin để tự gán role | Thành change request chờ duyệt; Operator không thuộc nhóm duyệt |
| "Gia hạn" paper đã hết hạn bằng cách sửa database | Backend mở lại, nhưng **mạng ORK vẫn từ chối** vì hạn nằm trong policy đã ký |

> **Trạng thái kiểm chứng:** hai dòng đầu đã có test backend. Các dòng về mạng ORK và change request là thiết kế, sẽ được cập nhật theo kết quả thật (T9, T12, T16) trong [`docs/VERIFICATION_LOG.md`](docs/VERIFICATION_LOG.md).

Không có Tide, khóa giải mã sẽ nằm trên server, và người giữ server đọc được mọi thứ. Tide chia khóa ra trên mạng ORK để không ai giữ trọn, đó là điều làm lời hứa của Papersec thành sự thật.

### 5. Prototype & storytelling

<!-- What does your prototype demonstrate today? Describe the key interaction judges should look for. -->

## Setup

Yêu cầu: Docker Desktop, Node.js ≥ 22.5 (dùng `node:sqlite`), `jq`, `curl`. Chạy trên macOS/Linux.

### 1. Cài đặt

```bash
npm install
cp .env.example .env
```

Điền `.env`: `TIDE_LICENSE_EMAIL` (email **của bạn** để quản lý licence Tide), `TIDE_TERMS_ACCEPTED=yes` **chỉ khi** bạn đã đọc và đồng ý https://tide.org/legal, và `KC_BOOTSTRAP_ADMIN_PASSWORD` (mật khẩu master admin, chỉ dùng local). `.env` đã nằm trong `.gitignore`.

### 2. Dựng TideCloak và realm

```bash
bash scripts/tide/bootstrap.sh   # container TideCloak (port 8080), realm, client, licence, bật IGA
bash scripts/tide/users.sh       # tạo 5 user: owner, approver2, approver3, reviewer, operator
bash scripts/tide/pivot.sh       # gán role Papersec (ps-author, ps-operator, ps-paper-*-reader)
bash scripts/tide/invite.sh      # in 5 link liên kết tài khoản Tide (sống 12 giờ)
```

Mở **từng** link trong một cửa sổ ẩn danh riêng và **tạo một tài khoản Tide mới cho mỗi user**. Một tài khoản Tide chỉ gắn được với một user, và licence phải cho phép đủ 5 tài khoản.

### 3. Chuyển realm sang nhiều admin (một chiều)

Chỉ chạy khi **cả 5** đã liên kết. Bước này gán `tide-realm-admin` cho 3 tác giả và **không hoàn tác được**:

```bash
CONFIRM_FLIP=yes bash scripts/tide/finalize.sh   # đồng thời xuất public/tidecloak.json
```

### 4. Chạy app

```bash
node scripts/make-sample-papers.mjs   # sinh 3 PDF tổng hợp vào samples/
npm run server                        # backend: http://localhost:8787
npm run dev                           # frontend: http://localhost:5137
```

Mở http://localhost:5137 và đăng nhập bằng Tide. Mỗi user dùng một Chrome profile riêng.

### 5. Kiểm thử

```bash
npm test         # test backend (JWT/DPoP tự sinh — chỉ kiểm logic phân quyền, không phải tích hợp Tide)
npm run build
```

Kết quả đo thật trên Tide được ghi trong [`docs/VERIFICATION_LOG.md`](docs/VERIFICATION_LOG.md).
