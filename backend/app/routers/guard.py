"""Transaction Guard – kiểm tra giao dịch chuyển khoản nghi lừa đảo.
Endpoint: POST /guard/check
Hai bước: bước 1 trả câu hỏi, bước 2 nhận câu trả lời và phân loại rủi ro.
Không gọi Gemini, không lưu session, không phụ thuộc mạng.
"""

import re
import unicodedata
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..entity_intel import check_reported_account

router = APIRouter(prefix="/guard", tags=["guard"])

# ---------- Cấu hình câu hỏi theo nhóm kịch bản ----------
# suspicious_when: giá trị đáp án nào bị coi là đáng ngờ (True hoặc False)
SCENARIO_CONFIG: dict[str, dict] = {
    "job_deposit": {
        "keywords": ["dat coc", "nhan viec", "cong tac vien", "nhiem vu", "hoa hong"],
        "questions": [
            {
                "id": "q1",
                "text": "Bạn đã gặp trực tiếp người này chưa?",
                "suspicious_when": False,
            },
            {
                "id": "q2",
                "text": "Họ có yêu cầu giữ bí mật hoặc chuyển tiền gấp không?",
                "suspicious_when": True,
            },
        ],
        "advice": {
            "safe": "Chưa thấy dấu hiệu bất thường. Hãy xác minh danh tính người đăng tuyển qua kênh chính thức.",
            "suspicious": "Thận trọng. Tuyển dụng yêu cầu đặt cọc thường là lừa đảo. Tìm hiểu kỹ trước khi chuyển tiền.",
            "danger": "Dừng lại, không chuyển tiền. Công ty thật không thu cọc để nhận việc.",
        },
    },
    "fake_police": {
        "keywords": ["cong an", "dieu tra", "tai khoan an toan", "vien kiem sat"],
        "questions": [
            {
                "id": "q1",
                "text": "Người này có yêu cầu giữ bí mật với người thân không?",
                "suspicious_when": True,
            },
            {
                "id": "q2",
                "text": "Họ có cung cấp số điện thoại đường dây nóng chính thức để bạn gọi lại xác minh không?",
                "suspicious_when": False,
            },
        ],
        "advice": {
            "safe": "Nếu bạn vẫn không chắc, hãy gọi đường dây công an địa phương để xác minh.",
            "suspicious": "Cơ quan công an không yêu cầu chuyển tiền qua điện thoại. Hãy gọi 113 để xác minh.",
            "danger": "Cơ quan công an không bao giờ yêu cầu chuyển tiền vào tài khoản cá nhân để điều tra. Đây là lừa đảo.",
        },
    },
    "investment": {
        "keywords": ["dau tu", "lai suat", "san dau tu", "san giao dich", "tien ao", "crypto", "loi nhuan"],
        "questions": [
            {
                "id": "q1",
                "text": "Người này có hứa lợi nhuận cao (trên 5%/ngày hoặc 20%/tháng) không?",
                "suspicious_when": True,
            },
            {
                "id": "q2",
                "text": "Bạn đã kiểm tra giấy phép hoạt động của sàn đầu tư này chưa?",
                "suspicious_when": False,
            },
        ],
        "advice": {
            "safe": "Hãy tìm hiểu kỹ về sàn đầu tư và chỉ đầu tư số tiền bạn chấp nhận mất.",
            "suspicious": "Lợi nhuận cao bất thường là dấu hiệu lừa đảo. Kiểm tra giấy phép trên website Ủy ban Chứng khoán.",
            "danger": "Dừng lại, đây rất có thể là sàn đầu tư lừa đảo (Ponzi/Scam). Không chuyển thêm tiền.",
        },
    },
    "booking": {
        "keywords": ["dat phong", "homestay", "tour", "coc phong", "khach san"],
        "questions": [
            {
                "id": "q1",
                "text": "Bạn tìm thấy chỗ ở/tour này qua ứng dụng đặt phòng chính thức (Booking, Agoda, Airbnb...) không?",
                "suspicious_when": False,
            },
            {
                "id": "q2",
                "text": "Họ có yêu cầu chuyển cọc 100% trước vào tài khoản cá nhân không?",
                "suspicious_when": True,
            },
        ],
        "advice": {
            "safe": "Nên đặt phòng qua ứng dụng chính thức để được bảo vệ quyền lợi.",
            "suspicious": "Thận trọng. Hãy tìm số điện thoại khách sạn/homestay trên Google Maps và gọi xác minh trực tiếp.",
            "danger": "Dừng lại. Gọi trực tiếp số khách sạn trên Google Maps để xác minh, không chuyển tiền theo yêu cầu này.",
        },
    },
    "purchase": {
        "keywords": ["mua hang", "ship", "chot don", "ban hang"],
        "questions": [
            {
                "id": "q1",
                "text": "Bạn mua qua sàn thương mại điện tử chính thức (Shopee, Lazada, Tiki...) không?",
                "suspicious_when": False,
            },
            {
                "id": "q2",
                "text": "Người bán có yêu cầu chuyển tiền trước khi giao hàng không?",
                "suspicious_when": True,
            },
        ],
        "advice": {
            "safe": "Nên mua qua sàn thương mại điện tử để được bảo vệ bởi chính sách hoàn tiền.",
            "suspicious": "Thận trọng. Ưu tiên chọn hình thức thanh toán khi nhận hàng (COD) để an toàn hơn.",
            "danger": "Dừng lại. Không chuyển tiền trước. Người bán uy tín luôn hỗ trợ COD hoặc thanh toán qua sàn.",
        },
    },
    "relative_loan": {
        "keywords": ["muon tien", "con can gap", "bo oi", "me oi", "nguoi than"],
        "questions": [
            {
                "id": "q1",
                "text": "Bạn đã gọi điện trực tiếp để xác minh đây có đúng là người thân của bạn không?",
                "suspicious_when": False,
            },
            {
                "id": "q2",
                "text": "Họ liên hệ qua tài khoản mạng xã hội hoặc số điện thoại lạ chưa gặp trước đây không?",
                "suspicious_when": True,
            },
        ],
        "advice": {
            "safe": "Luôn gọi điện xác minh trực tiếp trước khi chuyển tiền cho bất kỳ ai.",
            "suspicious": "Thận trọng. Hãy gọi điện cho người thân theo số bạn đã lưu từ trước, không dùng số lạ.",
            "danger": "Dừng lại. Gọi điện xác minh ngay. Mạo danh người thân nhắn tin mượn tiền là chiêu lừa rất phổ biến.",
        },
    },
    "other": {
        "keywords": [],
        "questions": [
            {
                "id": "q1",
                "text": "Bạn đã gặp trực tiếp hoặc xác minh được danh tính người nhận chưa?",
                "suspicious_when": False,
            },
            {
                "id": "q2",
                "text": "Họ có yêu cầu giữ bí mật hoặc chuyển tiền gấp không?",
                "suspicious_when": True,
            },
        ],
        "advice": {
            "safe": "Chưa thấy dấu hiệu bất thường, nhưng hãy tự kiểm tra lại người nhận trước khi chuyển.",
            "suspicious": "Có một số dấu hiệu đáng ngờ. Hãy xác minh kỹ danh tính người nhận trước khi chuyển tiền.",
            "danger": "Có nhiều dấu hiệu rủi ro. Dừng lại và hỏi ý kiến người thân đáng tin cậy trước khi làm gì tiếp.",
        },
    },
}

# ---------- Pydantic models ----------

class GuardRequest(BaseModel):
    account: str = Field(..., description="Số tài khoản người nhận")
    amount: int = Field(..., ge=0, description="Số tiền chuyển (VND)")
    reason: str = Field(..., min_length=1, max_length=500, description="Lý do chuyển khoản")
    answers: Optional[dict[str, bool]] = Field(
        default=None,
        description="Câu trả lời bước 2: {id_câu_hỏi: bool}. None hoặc rỗng để nhận câu hỏi.",
    )


# ---------- Helpers ----------

def _normalize_text(text: str) -> str:
    """Chữ thường, bỏ dấu tiếng Việt, đ->d."""
    text = text.lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.replace("đ", "d")
    return text


def _normalize_account(raw: str) -> str:
    """Chỉ giữ chữ số."""
    return re.sub(r"\D", "", raw)


def _detect_scenario(normalized_reason: str) -> str:
    for scenario, cfg in SCENARIO_CONFIG.items():
        if scenario == "other":
            continue
        if any(kw in normalized_reason for kw in cfg["keywords"]):
            return scenario
    return "other"


def _get_questions(scenario: str) -> list[dict]:
    return [
        {"id": q["id"], "text": q["text"]}
        for q in SCENARIO_CONFIG[scenario]["questions"]
    ]


def _score_and_reasons(
    account_clean: str,
    amount: int,
    scenario: str,
    answers: dict[str, bool],
) -> tuple[int, list[str]]:
    """Tính điểm và danh sách lý do. Trả (score, reasons)."""
    score = 0
    reasons = []

    # Tài khoản bị tố cáo (+3)
    reported = check_reported_account(account_clean)
    if reported["reported"]:
        score += 3
        reasons.append("Số tài khoản nằm trong danh sách bị tố cáo (dữ liệu demo)")

    # Nhóm lý do không phải "other" thì không cộng; "other" +1
    if scenario == "other":
        score += 1
        reasons.append("Lý do chuyển khoản không khớp nhóm kịch bản nào, cần thận trọng")
    else:
        reasons.append(f"Lý do khớp kịch bản: {_scenario_label(scenario)}")

    # Câu trả lời đáng ngờ (+1 mỗi câu)
    for q in SCENARIO_CONFIG[scenario]["questions"]:
        qid = q["id"]
        if qid in answers and answers[qid] == q["suspicious_when"]:
            score += 1
            reasons.append(_answer_reason(q))

    # Số tiền lớn (+1)
    if amount >= 5_000_000:
        score += 1
        reasons.append("Số tiền chuyển lớn (từ 5 triệu đồng trở lên)")

    return score, reasons


def _scenario_label(scenario: str) -> str:
    labels = {
        "job_deposit": "việc làm đặt cọc",
        "fake_police": "giả danh công an / cơ quan điều tra",
        "investment": "đầu tư tài chính / tiền ảo",
        "booking": "đặt phòng / homestay / tour",
        "purchase": "mua bán hàng hoá trực tuyến",
        "relative_loan": "mạo danh người thân mượn tiền",
        "other": "không xác định",
    }
    return labels.get(scenario, scenario)


def _answer_reason(q: dict) -> str:
    """Câu giải thích tiếng Việt khi câu trả lời đáng ngờ."""
    if q["id"] == "q1":
        if q["suspicious_when"] is False:
            return "Chưa gặp mặt hoặc xác minh được danh tính người nhận"
        return "Đã có dấu hiệu che giấu danh tính"
    # q2
    if q["suspicious_when"] is True:
        return "Bị yêu cầu giữ bí mật hoặc chuyển tiền gấp"
    return "Không cung cấp được thông tin xác minh chính thức"


def _risk_level(score: int) -> str:
    if score == 0:
        return "safe"
    if score == 1:
        return "suspicious"
    return "danger"


# ---------- Endpoint ----------

@router.post("/check")
def guard_check(req: GuardRequest):
    # Validate số tài khoản
    account_clean = _normalize_account(req.account)
    if not (6 <= len(account_clean) <= 19):
        raise HTTPException(
            status_code=400,
            detail="Số tài khoản không hợp lệ. Vui lòng nhập từ 6 đến 19 chữ số.",
        )

    # Phát hiện kịch bản từ lý do
    normalized_reason = _normalize_text(req.reason)
    scenario = _detect_scenario(normalized_reason)

    # Bước 1: chưa có câu trả lời
    if not req.answers:
        pre_findings = []
        if check_reported_account(account_clean)["reported"]:
            pre_findings.append("Số tài khoản nằm trong danh sách bị tố cáo (dữ liệu demo)")
        if req.amount >= 5_000_000:
            pre_findings.append("Số tiền lớn")

        return {
            "step": "questions",
            "questions": _get_questions(scenario),
            "pre_findings": pre_findings,
        }

    # Bước 2: có câu trả lời → phân loại
    score, reasons = _score_and_reasons(
        account_clean, req.amount, scenario, req.answers
    )
    level = _risk_level(score)

    if level == "safe":
        reasons = ["Chưa thấy dấu hiệu bất thường, nhưng hãy tự kiểm tra lại người nhận."]

    advice = SCENARIO_CONFIG[scenario]["advice"][level]

    return {
        "step": "result",
        "risk_level": level,
        "reasons": reasons,
        "advice": advice,
        "requires_confirmation": level != "safe",
    }
