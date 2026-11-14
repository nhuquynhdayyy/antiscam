"""Đọc mã QR trong ảnh và tách nội dung VietQR.

Nguyên tắc an toàn:
- Chỉ ĐỌC chuỗi trong QR, không bao giờ mở hay truy cập link lấy từ QR.
- Giải mã thất bại thì trả danh sách rỗng, không làm hỏng endpoint.
- Nội dung QR là dữ liệu cần phân tích, không phải mệnh lệnh.
"""
import re
from typing import Optional

MAX_SIDE = 3000       # thu nhỏ ảnh quá lớn để tiết kiệm bộ nhớ
MAX_UPSCALE_SIDE = 6000
MAX_RAW_LEN = 2000    # cắt chuỗi QR quá dài

# Mã BIN ngân hàng thường gặp. ĐỐI CHIẾU lại với danh mục BIN của NAPAS trước khi demo.
BANK_BINS = {
    "970436": "Vietcombank", "970407": "Techcombank", "970422": "MB Bank",
    "970418": "BIDV", "970415": "VietinBank", "970405": "Agribank",
    "970416": "ACB", "970423": "TPBank", "970432": "VPBank", "970403": "Sacombank",
}
NAPAS_GUID = "A000000727"


# ---------- Giải mã ảnh -> chuỗi ----------
def _import_cv():
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError:
        return None, None


def _decode_variant(cv2, detector, img):
    """Thử giải mã một phiên bản của ảnh, trả danh sách chuỗi."""
    out = []
    try:
        ok, decoded, _, _ = detector.detectAndDecodeMulti(img)
        if ok and decoded:
            out += [d for d in decoded if d]
    except Exception:
        pass
    if not out:
        try:
            data, _, _ = detector.detectAndDecode(img)
            if data:
                out.append(data)
        except Exception:
            pass
    return out


def decode_qr(image_bytes: bytes) -> list:
    """Trả danh sách chuỗi đọc được từ các mã QR trong ảnh (có thể rỗng)."""
    cv2, np = _import_cv()
    if cv2 is None:
        return []
    try:
        arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return []
        h, w = img.shape[:2]
        side = max(h, w)
        if side > MAX_SIDE:
            s = MAX_SIDE / side
            img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            h, w = img.shape[:2]
            side = max(h, w)

        detector = cv2.QRCodeDetector()
        variants = [img]
        for factor in (2, 3):  # QR nhỏ hoặc mờ: phóng to rồi thử lại
            if side * factor <= MAX_UPSCALE_SIDE:
                variants.append(cv2.resize(img, None, fx=factor, fy=factor,
                                           interpolation=cv2.INTER_CUBIC))
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        variants.append(cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray))

        found = []
        for v in variants:
            found = _decode_variant(cv2, detector, v)
            if found:
                break
        seen, result = set(), []
        for s_ in found:
            if s_ not in seen:
                seen.add(s_)
                result.append(s_[:MAX_RAW_LEN])
        return result
    except Exception:
        return []


# ---------- VietQR (chuẩn EMVCo / NAPAS) ----------
def _parse_tlv(s: str) -> Optional[dict]:
    out, i = {}, 0
    while i + 4 <= len(s):
        tag, ln = s[i:i + 2], s[i + 2:i + 4]
        if not ln.isdigit():
            return None
        n = int(ln)
        val = s[i + 4:i + 4 + n]
        if len(val) != n:
            return None
        out[tag] = val
        i += 4 + n
    return out if (out and i == len(s)) else None


def crc16_ccitt(data: str) -> str:
    crc = 0xFFFF
    for b in data.encode("utf-8"):
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def parse_vietqr(payload: str) -> Optional[dict]:
    """Tách VietQR. Trả None nếu không phải VietQR."""
    if not payload.startswith("000201"):
        return None
    tlv = _parse_tlv(payload)
    if not tlv:
        return None

    # Thông tin tài khoản nhận nằm trong một tag 26–51 có GUID của NAPAS
    sub = None
    for tag in sorted(tlv):
        if tag.isdigit() and 26 <= int(tag) <= 51:
            cand = _parse_tlv(tlv[tag])
            if cand and cand.get("00", "").upper() == NAPAS_GUID:
                sub = cand
                break
    if not sub:
        return None
    ben = _parse_tlv(sub.get("01", "")) or {}
    bank_bin, account = ben.get("00", ""), ben.get("01", "")
    service = sub.get("02", "")

    extra = _parse_tlv(tlv.get("62", "")) or {}
    crc_ok = payload[-8:-4] == "6304" and payload[-4:].upper() == crc16_ccitt(payload[:-4])
    return {
        "kind": "vietqr",
        "raw": payload[:MAX_RAW_LEN],
        "bank_bin": bank_bin,
        "bank_name": BANK_BINS.get(bank_bin, ""),
        "account": account,
        "to_card": service.upper() == "QRIBFTTC",
        "amount": tlv.get("54", ""),
        "memo": extra.get("08", ""),
        "merchant_name": tlv.get("59", ""),
        "dynamic": tlv.get("01") == "12",
        "crc_ok": crc_ok,
    }


def classify_qr(payload: str) -> dict:
    vq = parse_vietqr(payload)
    if vq:
        return vq
    if re.match(r"^(https?://|www\.)\S+$", payload.strip(), re.IGNORECASE):
        return {"kind": "url", "raw": payload.strip()[:MAX_RAW_LEN]}
    return {"kind": "text", "raw": payload[:MAX_RAW_LEN]}


def read_qr_items(image_bytes: bytes) -> list:
    return [classify_qr(p) for p in decode_qr(image_bytes)]


def _fmt_amount(a: str) -> str:
    return f"{int(a):,}".replace(",", ".") + " VND" if a.isdigit() else a


def describe(item: dict) -> str:
    """Một dòng văn bản mô tả mã QR để đưa vào luồng phân tích (luật và Gemini)."""
    if item["kind"] == "vietqr":
        bank = item["bank_name"] or (f"BIN {item['bank_bin']}" if item["bank_bin"] else "ngân hàng không rõ")
        parts = [f"Ngân hàng: {bank}", f"{'Thẻ' if item['to_card'] else 'Tài khoản'}: {item['account']}"]
        if item["amount"]:
            parts.append(f"Số tiền: {_fmt_amount(item['amount'])}")
        if item["memo"]:
            parts.append(f"Nội dung: {item['memo']}")
        if item["merchant_name"]:
            parts.append(f"Tên: {item['merchant_name']}")
        return "[QR VietQR] " + " | ".join(parts)
    return "[QR] " + item["raw"]