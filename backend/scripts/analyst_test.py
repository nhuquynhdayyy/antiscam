"""Chạy thử Analyst với bộ tin mẫu.
Cài:  pip install google-genai
Chạy: export GEMINI_API_KEY=...   (tùy chọn: GEMINI_MODEL)
      python backend/scripts/analyst_test.py   (chạy từ thư mục gốc repo)
Kiểm tra tên model còn dùng được trong tài liệu Gemini API trước khi chạy.
"""
import json, os
from pathlib import Path
from google import genai
from google.genai import types

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

ROOT = Path(__file__).resolve().parents[2]
system_prompt = (ROOT / "backend/app/prompts/analyst_prompt.md").read_text(encoding="utf-8")
schema = json.loads((ROOT / "backend/app/schemas/analyst_schema.json").read_text(encoding="utf-8"))
samples = json.loads((ROOT / "data/sample_messages.json").read_text(encoding="utf-8"))


def analyze(text: str) -> dict:
    resp = client.models.generate_content(
        model=MODEL,
        contents=f"<noi_dung_nguoi_dung>\n{text}\n</noi_dung_nguoi_dung>",
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            response_json_schema=schema,
            temperature=0.2,
        ),
    )
    return json.loads(resp.text)


if __name__ == "__main__":
    ok = 0
    for s in samples:
        r = analyze(s["text"])
        # evidence phải là đoạn chép nguyên văn để tô sáng được
        bad_ev = [e for e in r["evidence"] if e not in s["text"]]
        match = r["risk_level"] == s["expected_risk"]
        ok += match
        print(f'{s["id"]:<22} expect={s["expected_risk"]:<10} got={r["risk_level"]:<10} '
              f'{"OK " if match else "SAI"} evidence_khong_khop={len(bad_ev)}')
    print(f"\nĐúng mức rủi ro: {ok}/{len(samples)}")
