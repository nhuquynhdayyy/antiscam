"""AntiScam Orchestrator (FastAPI).
Chạy local: cd backend && uvicorn app.main:app --reload --port 8080
"""

import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:  # đọc .env ở thư mục gốc repo nếu có cài python-dotenv
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:
    pass

from . import analyst, family
from .entity_intel import INJECTION_PATTERNS, analyze_entities, merge_with_analyst
from .routers import vision

app = FastAPI(title="AntiScam API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
app.include_router(vision.router)
app.include_router(family.router)


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@app.get("/health")
def health():
    return {"status": "ok"}


def default_suggested_replies(level: str) -> list:
    """Câu trả lời phản biện mặc định khi chỉ dùng luật hoặc Gemini chưa gợi ý."""
    if level == "safe":
        return []
    return [
        {
            "label": "Yêu cầu xác minh",
            "text": "Tôi sẽ tự liên hệ qua số tổng đài hoặc kênh chính thức để xác minh thông tin này trước khi thực hiện.",
        },
        {
            "label": "Từ chối giao dịch",
            "text": "Tôi không thực hiện chuyển tiền, đặt cọc hay cung cấp mã OTP qua tin nhắn. Xin cảm ơn.",
        },
    ]


def rules_only_result(ent: dict) -> dict:
    """Kết quả dự phòng khi Gemini không dùng được: chỉ dựa trên luật kiểm tra."""
    level = "safe" if ent["rule_level"] == "none" else ent["rule_level"]
    if level == "danger":
        advice = "Có dấu hiệu lừa đảo rõ ràng. Dừng lại, không bấm link, không chuyển tiền, không đọc OTP."
    elif level == "suspicious":
        advice = "Có dấu hiệu đáng ngờ. Hãy tự kiểm tra qua kênh chính thức trước khi làm theo."
    else:
        advice = "Hệ thống phân tích AI đang bận nên chưa có kết luận đầy đủ. Hãy cẩn thận với yêu cầu chuyển tiền hoặc OTP."
    return {
        "risk_level": level,
        "scam_type": "other" if level != "safe" else "none",
        "stage": "none",
        "tactics": [],
        "evidence": [],
        "entities": {"phones": [], "urls": [], "accounts": [], "organizations": []},
        "next_likely_step": "",
        "user_advice": advice,
        "ask_trusted_circle": level == "danger",
        "follow_up_question": "",
        "suggested_replies": default_suggested_replies(level),
    }


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    text = req.text.strip()
    ent = analyze_entities(text)  # luật chạy trước, luôn có kết quả

    degraded = False
    try:
        llm = analyst.analyze_with_gemini(text, ent["rule_reasons"])
    except Exception as e:  # Gemini lỗi: vẫn trả kết quả từ luật
        print(f"[analyze] Gemini lỗi: {type(e).__name__}: {e}", flush=True)
        llm = rules_only_result(ent)
        degraded = True

    # chỉ giữ bằng chứng chép đúng nguyên văn để giao diện tô sáng được
    llm["evidence"] = [ev for ev in llm.get("evidence", []) if ev and ev in text]
    # nếu có câu chèn lệnh, đưa luôn vào bằng chứng
    if ent["injection_detected"]:
        for p in INJECTION_PATTERNS:
            m = re.search(p, text, re.IGNORECASE)
            if m and m.group(0) not in llm["evidence"]:
                llm["evidence"].append(m.group(0))

    result = merge_with_analyst(llm, ent)  # luật thắng: chỉ nâng mức rủi ro
    if result.get("risk_level") != "safe" and not result.get("suggested_replies"):
        result["suggested_replies"] = default_suggested_replies(result["risk_level"])
    result["degraded"] = degraded
    if degraded:
        result["decided_by"] = "rules"
    return result
