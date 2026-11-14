"""Router: POST /analyze-image
Nhận ảnh chụp màn hình (png/jpeg/webp, tối đa 4 MB), dùng Gemini đọc chữ
và phân tích lừa đảo, trả cùng schema với /analyze + trường extracted_text.
"""

import json
import os
import re
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile

# Các hàm dùng chung từ module gốc
from ..entity_intel import INJECTION_PATTERNS, analyze_entities, merge_with_analyst
from .. import analyst

router = APIRouter()

# ── Giới hạn ──────────────────────────────────────────────────────────────────
MAX_BYTES = 4 * 1024 * 1024  # 4 MB
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp"}

# ── Đọc config Gemini (giống analyst.py) ──────────────────────────────────────
APP_DIR = Path(__file__).resolve().parents[1]
SYSTEM_PROMPT = (APP_DIR / "prompts" / "analyst_prompt.md").read_text(encoding="utf-8")
SCHEMA = json.loads((APP_DIR / "schemas" / "analyst_schema.json").read_text(encoding="utf-8"))


def _models():
    return [
        os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
        os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash"),
    ]


def analyze_image_with_gemini(image_bytes: bytes, mime_type: str, rule_reasons=None) -> dict:
    """Gửi ảnh lên Gemini, trả dict theo schema (gồm extracted_text)."""
    import httpx
    from google import genai
    from google.genai import errors, types

    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options=types.HttpOptions(timeout=15_000),
    )

    # Phần chú thích thêm cho AI biết đây là ảnh
    text_part = (
        "Đây là ảnh chụp màn hình. Hãy đọc toàn bộ chữ trong ảnh, "
        "ghi vào extracted_text, rồi phân tích theo hướng dẫn trong system prompt."
    )
    if rule_reasons:
        text_part += (
            "\n<tin_hieu_tu_luat>\n"
            + "\n".join(f"- {r}" for r in rule_reasons)
            + "\n</tin_hieu_tu_luat>"
        )

    contents = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        types.Part.from_text(text=text_part),
    ]

    last_err = None
    for model in _models():
        for attempt in range(2):
            t0 = time.time()
            try:
                resp = client.models.generate_content(
                    model=model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        response_json_schema=SCHEMA,
                        temperature=0.2,
                    ),
                )
                result = json.loads(resp.text)
                result["model_used"] = model
                result["latency_s"] = round(time.time() - t0, 1)
                return result
            except (errors.ServerError, httpx.TimeoutException) as e:
                last_err = e
                time.sleep(1)
            except (ValueError, TypeError) as e:
                last_err = e
            except errors.ClientError as e:
                last_err = e
                code = getattr(e, "code", None)
                if code == 429:
                    time.sleep(1)
                elif code == 404:
                    break
                else:
                    raise
    raise last_err


def rules_only_result_image(ent: dict, extracted_text: str = "") -> dict:
    """Kết quả dự phòng khi Gemini lỗi (chỉ dựa vào luật)."""
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
        "extracted_text": extracted_text,
        "entities": {"phones": [], "urls": [], "accounts": [], "organizations": []},
        "next_likely_step": "",
        "user_advice": advice,
        "ask_trusted_circle": level == "danger",
        "follow_up_question": "",
    }


@router.post("/analyze-image")
async def analyze_image(file: UploadFile):
    # ── Kiểm tra định dạng ───────────────────────────────────────────────────
    suffix = Path(file.filename or "").suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()

    if content_type not in ALLOWED_MIME and suffix not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail="Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.",
        )

    # Chọn mime_type đáng tin cậy hơn từ extension nếu content_type thiếu
    mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
    mime_type = content_type if content_type in ALLOWED_MIME else mime_map.get(suffix, "image/jpeg")

    # ── Kiểm tra dung lượng ──────────────────────────────────────────────────
    image_bytes = await file.read()
    if len(image_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Ảnh quá lớn ({len(image_bytes) // 1024} KB). Tối đa 4 MB.",
        )
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")

    # ── Gọi Gemini phân tích ảnh ─────────────────────────────────────────────
    degraded = False
    extracted_text = ""
    llm = {}

    try:
        llm = analyze_image_with_gemini(image_bytes, mime_type)
        extracted_text = llm.get("extracted_text", "") or ""
    except Exception as e:
        print(f"[analyze-image] Gemini lỗi: {type(e).__name__}: {e}", flush=True)
        degraded = True

    # ── Chạy luật trên extracted_text (hoặc chuỗi rỗng nếu Gemini lỗi) ──────
    text_for_rules = extracted_text
    ent = analyze_entities(text_for_rules) if text_for_rules else {
        "phones": [], "urls": [], "accounts": [], "organizations": [],
        "url_reports": [], "rule_level": "none", "rule_reasons": [],
        "injection_detected": False,
    }

    if degraded:
        llm = rules_only_result_image(ent, extracted_text)

    # ── Lọc evidence: chỉ giữ đoạn chép nguyên văn từ extracted_text ─────────
    if extracted_text:
        llm["evidence"] = [
            ev for ev in llm.get("evidence", [])
            if ev and ev in extracted_text
        ]
    else:
        llm["evidence"] = []

    # ── Nếu có prompt injection trong chữ đọc từ ảnh ─────────────────────────
    if ent.get("injection_detected"):
        for p in INJECTION_PATTERNS:
            m = re.search(p, extracted_text, re.IGNORECASE)
            if m and m.group(0) not in llm["evidence"]:
                llm["evidence"].append(m.group(0))

    # ── Merge: luật chỉ nâng mức rủi ro, không hạ ────────────────────────────
    result = merge_with_analyst(llm, ent)
    result["degraded"] = degraded
    result["extracted_text"] = extracted_text
    if degraded:
        result["decided_by"] = "rules"

    return result
