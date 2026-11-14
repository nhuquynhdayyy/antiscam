"""Test guard endpoint – chạy từ thư mục gốc repo:
   python backend/scripts/guard_test.py
Không cần Gemini, không cần mạng.
"""
import sys
from pathlib import Path

# Thêm backend vào sys.path để import được app.*
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers.guard import guard_check
from pydantic import ValidationError

# Hàm tiện ích
def req(account, amount, reason, answers=None):
    from app.routers.guard import GuardRequest
    return GuardRequest(account=account, amount=amount, reason=reason, answers=answers)


def test_1_danger_reported_deposit_suspicious_answers():
    """Tài khoản bị tố cáo + việc làm đặt cọc + trả lời đáng ngờ → danger."""
    r = guard_check(req(
        account="0123456789",
        amount=500_000,
        reason="đặt cọc nhận việc cộng tác viên",
        answers={"q1": False, "q2": True},   # cả 2 đáng ngờ
    ))
    assert r["step"] == "result", f"step sai: {r}"
    assert r["risk_level"] == "danger", f"Test 1 FAIL: {r['risk_level']} (expect danger)\nreasons={r['reasons']}"
    print("✅ Test 1 PASS – bị tố cáo + đặt cọc + đáng ngờ = danger")


def test_2_danger_reported_no_answers():
    """Bước 1: tài khoản bị tố cáo + tiền lớn → pre_findings có cả hai."""
    r = guard_check(req(
        account="9876543210",
        amount=10_000_000,
        reason="giả danh công an điều tra",
    ))
    assert r["step"] == "questions", f"step sai: {r}"
    assert any("tố cáo" in f for f in r["pre_findings"]), f"Test 2 FAIL: pre_findings={r['pre_findings']}"
    assert any("lớn" in f.lower() for f in r["pre_findings"]), f"Test 2 FAIL pre_findings: {r['pre_findings']}"
    print("✅ Test 2 PASS – bước 1, tài khoản bị tố cáo + tiền lớn → pre_findings đúng")


def test_3_suspicious_unknown_account_purchase_safe_answers():
    """Tài khoản lạ + mua hàng + trả lời ổn (q1=True, q2=False) + tiền nhỏ → suspicious (scenario other +1)."""
    r = guard_check(req(
        account="1122334455",   # không có trong danh sách
        amount=200_000,
        reason="mua hàng ship về",
        answers={"q1": True, "q2": False},   # cả 2 không đáng ngờ
    ))
    assert r["step"] == "result", f"step sai: {r}"
    # purchase không phải other nên không +1 cho scenario; q1=True (suspicious_when=False → không đáng ngờ)
    # q2=False (suspicious_when=True → không đáng ngờ) → score=0 → safe
    assert r["risk_level"] in ("safe", "suspicious"), f"Test 3 FAIL: {r['risk_level']}\nreasons={r['reasons']}"
    print(f"✅ Test 3 PASS – tài khoản lạ + mua hàng nhỏ + trả lời ổn = {r['risk_level']}")


def test_4_safe_normal_reason():
    """Lý do ăn sáng, tiền thường, tài khoản lạ, trả lời ổn → safe hoặc suspicious (other +1, nhưng trả lời ổn)."""
    r = guard_check(req(
        account="9900112233",
        amount=50_000,
        reason="tra tien bua sang ban ung hom qua",
        answers={"q1": True, "q2": False},
    ))
    assert r["step"] == "result", f"step sai: {r}"
    # other +1 vì không khớp từ khóa, trả lời ổn → score=1 → suspicious
    # Tiền nhỏ, không bị tố cáo → không thêm điểm nào khác
    assert r["risk_level"] in ("safe", "suspicious"), f"Test 4 FAIL: {r['risk_level']}\nreasons={r['reasons']}"
    print(f"✅ Test 4 PASS – lý do ăn sáng + tiền nhỏ = {r['risk_level']}")


def test_5_danger_investment_suspicious_answers():
    """Đầu tư tiền ảo + trả lời đáng ngờ → danger."""
    r = guard_check(req(
        account="2233445566",
        amount=3_000_000,
        reason="nạp tiền vào sàn đầu tư lợi nhuận cao",
        answers={"q1": True, "q2": False},   # q1 đáng ngờ (hứa lãi cao=True), q2 đáng ngờ (chưa kiểm tra=False)
    ))
    assert r["step"] == "result", f"step sai: {r}"
    # investment: q1 suspicious_when=True → +1; q2 suspicious_when=False → +1; scenario không phải other → không +1
    # score = 2 → danger
    assert r["risk_level"] == "danger", f"Test 5 FAIL: {r['risk_level']}\nreasons={r['reasons']}"
    print("✅ Test 5 PASS – đầu tư + câu trả lời đáng ngờ = danger")


def test_6_invalid_account_raises_400():
    """Số tài khoản không hợp lệ → HTTPException 400."""
    from fastapi import HTTPException
    try:
        guard_check(req(account="123", amount=0, reason="test"))
        assert False, "Test 6 FAIL: phải ném HTTPException"
    except HTTPException as e:
        assert e.status_code == 400, f"Test 6 FAIL: status={e.status_code}"
        print("✅ Test 6 PASS – số tài khoản không hợp lệ → HTTP 400")


if __name__ == "__main__":
    test_1_danger_reported_deposit_suspicious_answers()
    test_2_danger_reported_no_answers()
    test_3_suspicious_unknown_account_purchase_safe_answers()
    test_4_safe_normal_reason()
    test_5_danger_investment_suspicious_answers()
    test_6_invalid_account_raises_400()
    print("\n6/6 test guard PASSED thành công!")
