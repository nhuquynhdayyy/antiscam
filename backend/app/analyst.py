"""Analyst: gọi Gemini để phân tích kịch bản lừa đảo, trả JSON theo analyst_schema.json."""

import json
import os
import time
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent

SYSTEM_PROMPT = (APP_DIR / "prompts" / "analyst_prompt.md").read_text(encoding="utf-8")
SCHEMA = json.loads(
    (APP_DIR / "schemas" / "analyst_schema.json").read_text(encoding="utf-8")
)

_client = None


def _models():
    # đọc mỗi lần gọi để đổi model bằng biến môi trường mà không cần sửa code
    return [
        os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash"),
    ]


def _get_client():
    global _client
    if _client is None:
        from google import genai
        from google.genai import types

        _client = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"],
            http_options=types.HttpOptions(timeout=15_000),  # 15 giây mỗi request
        )
    return _client


def analyze_with_gemini(text: str, rule_reasons=None, retries: int = 2) -> dict:
    """Trả về dict theo schema. Ném lỗi nếu mọi model đều thất bại (để backend dùng kết quả của luật)."""
    import httpx
    from google.genai import errors, types

    client = _get_client()
    contents = f"<noi_dung_nguoi_dung>\n{text}\n</noi_dung_nguoi_dung>"
    if rule_reasons:
        # tín hiệu từ luật kiểm tra, chỉ là dữ liệu tham khảo
        contents += (
            "\n<tin_hieu_tu_luat>\n"
            + "\n".join(f"- {r}" for r in rule_reasons)
            + "\n</tin_hieu_tu_luat>"
        )

    last_err = None
    for model in _models():
        for attempt in range(retries):
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
            except (ValueError, TypeError) as e:  # phản hồi rỗng hoặc JSON hỏng
                last_err = e
            except errors.ClientError as e:
                last_err = e
                code = getattr(e, "code", None)
                if code == 429:
                    time.sleep(1)
                elif code == 404:
                    break  # model không còn, sang model kế
                else:
                    raise
    raise last_err
