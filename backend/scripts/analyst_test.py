"""Chạy thử Analyst với bộ tin mẫu (có thử lại khi 503/hết giờ và model dự phòng).
Chạy từ thư mục gốc repo:  python backend/scripts/analyst_test.py
Cần: pip install google-genai   (tùy chọn: pip install python-dotenv để đọc file .env)
Biến môi trường: GEMINI_API_KEY (bắt buộc), GEMINI_MODEL, GEMINI_FALLBACK_MODEL (tùy chọn)
"""

import json
import os
import time
from pathlib import Path

import httpx
from google import genai
from google.genai import errors, types

ROOT = Path(__file__).resolve().parents[2]

try:  # đọc .env nếu có cài python-dotenv
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

MODELS = [
    os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"),
    os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash"),
]

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"],
    http_options=types.HttpOptions(timeout=30_000),  # 30 giây mỗi request (mili giây)
)

system_prompt = (ROOT / "backend/app/prompts/analyst_prompt.md").read_text(
    encoding="utf-8"
)
schema = json.loads(
    (ROOT / "backend/app/schemas/analyst_schema.json").read_text(encoding="utf-8")
)
samples = json.loads((ROOT / "data/sample_messages.json").read_text(encoding="utf-8"))


def analyze(text: str, retries: int = 2) -> dict:
    last_err = None
    for model in MODELS:
        for attempt in range(retries):
            t0 = time.time()
            try:
                resp = client.models.generate_content(
                    model=model,
                    contents=f"<noi_dung_nguoi_dung>\n{text}\n</noi_dung_nguoi_dung>",
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        response_mime_type="application/json",
                        response_json_schema=schema,
                        temperature=0.2,
                    ),
                )
                result = json.loads(resp.text)
                print(f"  [{model}] {time.time() - t0:.1f}s", flush=True)
                return result
            except (
                errors.ServerError,
                httpx.TimeoutException,
            ) as e:  # 503, 500, hết giờ
                last_err = e
                print(
                    f"  [{model}] lỗi/hết giờ sau {time.time() - t0:.1f}s, thử lại",
                    flush=True,
                )
                time.sleep(2**attempt)  # chờ 1s, 2s
            except (ValueError, TypeError) as e:  # phản hồi rỗng hoặc JSON hỏng
                last_err = e
                print(f"  [{model}] phản hồi không hợp lệ, thử lại", flush=True)
            except errors.ClientError as e:  # 429 hết quota, 404 model không còn...
                last_err = e
                code = getattr(e, "code", None)
                if code == 429:
                    time.sleep(2**attempt)
                elif code == 404:
                    print(
                        f"  [!] Model {model} không dùng được, thử model khác",
                        flush=True,
                    )
                    break  # thoát vòng thử lại, sang model kế
                else:
                    raise
    raise last_err


if __name__ == "__main__":
    ok = 0
    for s in samples:
        print(f"{s['id']} ...", flush=True)
        r = analyze(s["text"])
        bad_ev = [
            e for e in r["evidence"] if e not in s["text"]
        ]  # evidence phải chép nguyên văn
        match = r["risk_level"] == s["expected_risk"]
        ok += match
        print(
            f"{s['id']:<22} expect={s['expected_risk']:<10} got={r['risk_level']:<10} "
            f"{'OK ' if match else 'SAI'} evidence_khong_khop={len(bad_ev)}",
            flush=True,
        )
        time.sleep(1)
    print(f"\nĐúng mức rủi ro: {ok}/{len(samples)}")
