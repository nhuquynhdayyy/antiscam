# AntiScam - AI Agent bảo vệ mọi người khỏi lừa đảo trực tuyến

Mini Hackathon GDG DevFest Miền Trung 2026 (*Learn Beyond Limits*).  
Công nghệ Google: **Gemini API**, **Google Cloud Run**.

---

## Tổng quan những gì đã hoàn thành

### 1. Phân tích tin nhắn, link & số điện thoại (`POST /analyze`)
- **Kết hợp Luật + AI (`backend/app/entity_intel.py`, `backend/app/analyst.py`, `backend/app/main.py`):**
  - Trích xuất thực thể (số điện thoại, URL, số tài khoản, tổ chức) và phát hiện **prompt injection** bằng hệ thống luật.
  - Phân tích ngữ cảnh bằng **Gemini API**, phân loại mức độ rủi ro (`safe`, `suspicious`, `danger`), nhận diện chiêu thức/chiến thuật lừa đảo, bằng chứng cụ thể và bước tiếp theo kẻ gian có thể dùng.
  - Có cơ chế dự phòng (`rules_only_result`) trả kết quả dựa trên luật khi Gemini bận hoặc không khả dụng.
- **Giao diện kiểm tra (`frontend/js/check.js`):**
  - Có sẵn bộ nút **Thử mẫu** nhanh (việc làm đặt cọc, tin chèn lệnh, đặt phòng, phạt nguội, cập nhật CCCD giả mạo...).
  - Gợi ý **câu trả lời phản biện** để người dùng sao chép gửi lại đối tượng.
  - Hỗ trợ nhập bằng **giọng nói tiếng Việt** qua Web Speech API (`frontend/js/mic.js`), lưu **lịch sử kiểm tra** trong phiên (`frontend/js/app.js`) và chia sẻ kết quả (`frontend/js/share.js`).

### 2. Phân tích ảnh chụp màn hình & mã QR (`POST /analyze-image`)
- **Backend (`backend/app/routers/vision.py`, `backend/app/qr.py`):**
  - Nhận ảnh chụp màn hình, trích xuất nội dung văn bản và giải mã **QR code** (OpenCV) để phát hiện đường link/nội dung lừa đảo ẩn trong ảnh.
- **Frontend (`frontend/js/image.js`):**
  - Hỗ trợ 3 cách đưa ảnh vào: chọn tệp, kéo thả vào khung, hoặc dán trực tiếp từ clipboard (`Ctrl+V`) với định dạng PNG, JPG, WebP (tối đa 4 MB).

### 3. Đánh giá giao dịch trước khi chuyển tiền – Transaction Guard (`POST /guard/check`)
- **Backend & Frontend (`backend/app/routers/guard.py`, `frontend/js/guard.js`):**
  - Người dùng nhập **số tài khoản người nhận**, **số tiền (VNĐ)** và **lý do chuyển khoản** ở tab *Trước khi chuyển tiền*.
  - Hệ thống đánh giá mức độ an toàn, đặt câu hỏi xác minh thêm nếu phát hiện dấu hiệu bất thường và đưa ra cảnh báo dừng giao dịch kịp thời.

### 4. Chế độ Gia đình & Demo chia đôi màn hình (`backend/app/family.py`, `frontend/js/family.js`, `frontend/demo-split.html`)
- Kết nối tài khoản **Người được bảo vệ** (ví dụ: phụ huynh) và **Người giám hộ** (con cái/người thân) để gửi cảnh báo khẩn cấp khi gặp tin nhắn nguy hiểm.
- Trang **`frontend/demo-split.html`** mô phỏng song song 2 màn hình (điện thoại Phụ huynh & Web của Con cái) ở chế độ mock (`?mock=1`) hoặc live API, có nút truy cập nhanh ngay trên giao diện chính khi backend gia đình chưa bật.

### 5. Đóng gói & Triển khai
- Có sẵn `Dockerfile` và `.dockerignore` ở thư mục gốc để build và deploy lên **Google Cloud Run**.
- Frontend hỗ trợ tham số URL `?mock=1` (chạy giả lập không cần backend) và `?api=<URL>` (trỏ tới API tùy chọn).

---

## Cấu trúc thư mục
- `backend/`: FastAPI Orchestrator (`app/main.py`), Entity Intel (`app/entity_intel.py`), Gemini Analyst (`app/analyst.py`), QR (`app/qr.py`), Chế độ Gia đình (`app/family.py`), Routers (`app/routers/vision.py`, `app/routers/guard.py`), `scripts/`, `requirements.txt`
- `frontend/`: Giao diện web (`index.html`, `demo-split.html`, `css/styles.css`, `js/app.js`, `js/check.js`, `js/image.js`, `js/mic.js`, `js/guard.js`, `js/family.js`, `js/share.js`)
- `data/`: Bộ tin nhắn mẫu để kiểm thử và demo
- `docs/`: Tài liệu và kiến trúc

---

## Hướng dẫn chạy local

### 1. Chạy Backend (cổng `8080`)
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# Tạo file .env ở thư mục gốc với GEMINI_API_KEY=... (xem .env.example)
uvicorn app.main:app --reload --port 8080
```

### 2. Chạy Frontend (cổng `5500`)
```bash
cd frontend
python -m http.server 5500
```
Mở trình duyệt tại `http://localhost:5500`:
- Mặc định tự kết nối backend tại `http://localhost:8080`.
- Chạy nhanh không cần backend: `http://localhost:5500?mock=1`
- Xem demo Chế độ Gia đình 2 màn hình: `http://localhost:5500/demo-split.html`

---

## Triển khai Cloud Run
```bash
gcloud run deploy antiscam-api --source . --region asia-southeast1 \
  --allow-unauthenticated --set-env-vars GEMINI_API_KEY=...
```

---

## Thành viên
Nguyễn Như Quỳnh (nhóm trưởng), Hồ Nguyễn Thảo Nguyên, Nguyễn Thị Thanh Phúc
