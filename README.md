# AntiScam - AI Agent bảo vệ mọi người khỏi lừa đảo trực tuyến

Mini Hackathon GDG DevFest Miền Trung 2026 (Learn Beyond Limits).
Công nghệ Google: Gemini API, Google Cloud Run.

## Cấu trúc
- `backend/`: FastAPI Orchestrator, Entity Intel (luật), Analyst (Gemini)
- `frontend/`: giao diện web/PWA
- `data/`: bộ tin nhắn mẫu để kiểm thử và demo
- `docs/`: tài liệu, kiến trúc

## Chạy local
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export GEMINI_API_KEY=...   # xem .env.example
uvicorn app.main:app --reload --port 8080
```

## Triển khai Cloud Run
```bash
cd backend
gcloud run deploy antiscam-api --source . --region asia-southeast1 \
  --allow-unauthenticated --set-env-vars GEMINI_API_KEY=...
```

## Phần làm sẵn trước ngày thi (tối đa 30%)
Khung dự án, cấu hình deploy, prompt và schema cho Analyst, luật Entity Intel ban đầu, bộ dữ liệu mẫu.
Pipeline hoàn chỉnh, giao diện, Transaction Guard, đọc ảnh và video demo được xây dựng trong ngày thi.

## Thành viên
Nguyễn Như Quỳnh (nhóm trưởng), Hồ Nguyễn Thảo Nguyên, Nguyễn Thị Thanh Phúc
