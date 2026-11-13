"""AntiScam Orchestrator (FastAPI) - khung ban đầu.
Chạy local: cd backend && uvicorn app.main:app --reload --port 8080
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .entity_intel import analyze_entities

app = FastAPI(title="AntiScam API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class AnalyzeRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    # TODO (ngày thi): gọi Analyst (Gemini) rồi merge_with_analyst() với kết quả luật
    ent = analyze_entities(req.text)
    return {"stub": True, "entities": ent}
