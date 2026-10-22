# Artwork cho trang đăng nhập (login enclave)

Đặt 2 file vào đúng thư mục này rồi báo tôi; tôi sẽ kiểm tra bằng `check-branding.py` của pack
rồi upload + ký lại IdP settings. Branding **không** qua IGA nên làm lúc nào cũng được,
kể cả sau khi realm đã flip multiAdmin.

| File | Yêu cầu (đo từ CSS thật của enclave) |
|---|---|
| `branding/logo.png` | **Vuông**, 1024×1024, PNG có alpha. Enclave **crop thành hình tròn** và đặt trên nền **trắng** → chừa ≥15% lề mỗi bên, dùng màu đậm, **không chữ** (hiển thị chỉ 85–153px) |
| `branding/background.jpg` | **16:9**, tối thiểu 1920×1080, JPEG. Phủ full màn hình và crop ở giữa → **giữa ảnh phải yên tĩnh, tương phản thấp** vì thẻ đăng nhập nằm đè lên |

Chặn cứng: **SVG bị server từ chối**, tối đa **5 MB** mỗi file.
