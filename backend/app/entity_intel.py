"""Entity Intel: trích thực thể + luật kiểm tra nhanh (không cần AI).
Luật có quyền quyết định cuối: merge_with_analyst() chỉ NÂNG mức rủi ro, không bao giờ hạ.
Chạy thử (từ thư mục backend/): python -m app.entity_intel
"""
import json
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

# ---------- Cấu hình (kiểm tra lại danh sách tên miền chính thức trước khi demo) ----------
LEGIT_DOMAINS = {
    "vietcombank.com.vn", "techcombank.com", "mbbank.com.vn", "bidv.com.vn",
    "vietinbank.vn", "agribank.com.vn", "acb.com.vn", "tpb.vn", "vpbank.com.vn",
    "sacombank.com.vn", "momo.vn", "zalopay.vn", "vneid.gov.vn",
    "dichvucong.gov.vn", "evn.com.vn", "evncpc.vn", "evnhcmc.vn", "evnnpc.vn",
    "vnpost.vn", "google.com", "facebook.com", "zalo.me", "booking.com", "agoda.com",
}
# từ khóa thương hiệu hay bị giả mạo -> tên tổ chức
BRAND_KEYWORDS = {
    "vietcombank": "Vietcombank", "vcb": "Vietcombank", "techcombank": "Techcombank",
    "mbbank": "MB Bank", "bidv": "BIDV", "vietinbank": "VietinBank",
    "agribank": "Agribank", "tpbank": "TPBank", "vpbank": "VPBank",
    "sacombank": "Sacombank", "momo": "MoMo", "zalopay": "ZaloPay",
    "vneid": "VNeID", "dichvucong": "Dịch vụ công", "evn": "EVN", "vnpost": "VNPost",
    "booking": "Booking", "agoda": "Agoda",
}
SUSPICIOUS_TLDS = {"top", "xyz", "vip", "icu", "click", "shop", "club", "online",
                   "site", "live", "cfd", "sbs", "buzz", "work", "rest", "cyou"}
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "cutt.ly", "rebrand.ly", "shorturl.at", "is.gd", "tiny.cc"}
LURE_WORDS = ["login", "verify", "xacthuc", "xac-thuc", "capnhat", "cap-nhat",
              "thanhtoan", "thanh-toan", "otp", "secure", "account", "khoa", "nhantien", "booking"]
TWO_LEVEL = {"com.vn", "net.vn", "gov.vn", "edu.vn", "org.vn", "co.uk"}
INJECTION_PATTERNS = [
    r"b[ỏo]\s*qua\s+(m[ọo]i\s+)?h[ưu][ớo]ng\s*d[ẫa]n", r"ignore\s+(all\s+)?(previous|prior)",
    r"tr[ảa]\s*l[ờo]i\s+(r[ằa]ng\s+)?.{0,40}an\s*to[àa]n", r"risk_level\s*=", r"\bsystem\s*prompt\b",
]

# ---------- Trích thực thể ----------
PHONE_RE = re.compile(r"(?<!\d)(?:\+?84|0)(?:3|5|7|8|9)\d{8}(?!\d)")
URL_RE = re.compile(
    r"(?:https?://)?(?:[a-z0-9\-]+\.)+(?:[a-z]{2,})(?:/[^\s\]\)\"']*)?", re.IGNORECASE)
ACCOUNT_RE = re.compile(r"(?<![\d.,])\d{8,16}(?![\d.,])")
ACCOUNT_CTX = re.compile(r"(stk|tk|tài khoản|tai khoan|số tk|chuyển (?:khoản|vào|tiền))", re.IGNORECASE)


def extract_phones(text):
    return sorted({m.group(0) for m in PHONE_RE.finditer(text)})


def extract_urls(text):
    urls = []
    for m in URL_RE.finditer(text):
        u = m.group(0).rstrip(".,;:!?")
        host = urlparse(u if u.startswith("http") else "http://" + u).hostname or ""
        # bỏ các chuỗi giống tên file/số thập phân, hoặc email-domain thông thường
        if "." in host and not re.fullmatch(r"[\d.]+", host):
            urls.append(u)
    return sorted(set(urls))


def extract_accounts(text, phones):
    out = set()
    for m in ACCOUNT_RE.finditer(text):
        s = m.group(0)
        if s in phones or any(p.endswith(s[-9:]) for p in phones if len(s) >= 9 and s.startswith(("0", "84"))
                              and PHONE_RE.fullmatch(s)):
            continue
        window = text[max(0, m.start() - 40): m.start()]
        if ACCOUNT_CTX.search(window):
            out.add(s)
    return sorted(out)


# ---------- Phân tích URL ----------
def registrable_domain(host):
    parts = host.lower().split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in TWO_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _normalize(s):
    return s.translate(str.maketrans("0134", "olea")).replace("rn", "m")


def levenshtein(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def analyze_url(url):
    host = (urlparse(url if url.startswith("http") else "http://" + url).hostname or "").lower()
    dom = registrable_domain(host)
    tld = dom.split(".")[-1]
    reasons, level, brand = [], "none", None

    if dom in LEGIT_DOMAINS or any(host == d or host.endswith("." + d) for d in LEGIT_DOMAINS):
        return {"url": url, "domain": dom, "level": "none", "reasons": ["Tên miền chính thức"], "brand": None}

    if dom in SHORTENERS:
        reasons.append("Link rút gọn, che giấu đích đến"); level = "suspicious"
    if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", host):
        reasons.append("Dùng địa chỉ IP thay cho tên miền"); level = "danger"
    if tld in SUSPICIOUS_TLDS:
        reasons.append(f"Đuôi .{tld} hay bị lạm dụng trong lừa đảo"); level = max(level, "suspicious", key=_rank)
    if host.count("-") >= 2:
        reasons.append("Nhiều dấu gạch ngang trong tên miền"); level = max(level, "suspicious", key=_rank)
    if any(w in host + url.lower() for w in LURE_WORDS):
        reasons.append("Chứa từ khóa dụ dỗ (xác thực/cập nhật/thanh toán...)")
        level = max(level, "suspicious", key=_rank)

    label = dom.split(".")[0]
    norm = _normalize(host)
    for kw, name in BRAND_KEYWORDS.items():
        if kw in norm.replace("-", "") or kw in host.replace("-", ""):
            brand = name
            reasons.append(f"Giả mạo thương hiệu {name} nhưng không phải tên miền chính thức ({dom})")
            level = "danger"
            break
    if not brand:  # gần giống tên miền thật (typosquatting)
        for legit in LEGIT_DOMAINS:
            if levenshtein(dom, legit) <= 2 and dom != legit:
                brand = legit
                reasons.append(f"Tên miền gần giống {legit} (typosquatting)")
                level = "danger"
                break
    return {"url": url, "domain": dom, "level": level, "reasons": reasons, "brand": brand}


_ORDER = {"none": 0, "safe": 0, "suspicious": 1, "danger": 2}


def _rank(x):
    return _ORDER[x]


# ---------- Hàm chính cho tool analyze_entities() ----------
def analyze_entities(text):
    phones = extract_phones(text)
    urls = extract_urls(text)
    accounts = extract_accounts(text, phones)
    url_reports = [analyze_url(u) for u in urls]

    level, reasons, orgs = "none", [], set()
    for r in url_reports:
        if _rank(r["level"]) > _rank(level):
            level = r["level"]
        reasons += [f'{r["url"]}: {x}' for x in r["reasons"] if x != "Tên miền chính thức"]
        if r["brand"] and r["level"] == "danger":
            orgs.add(r["brand"])

    injection = any(re.search(p, text, re.IGNORECASE) for p in INJECTION_PATTERNS)
    if injection:
        level = "danger"
        reasons.append("Tin nhắn cố chèn lệnh để đánh lừa AI (prompt injection)")

    return {"phones": phones, "urls": urls, "accounts": accounts, "organizations": sorted(orgs),
            "url_reports": url_reports, "rule_level": level, "rule_reasons": reasons,
            "injection_detected": injection}


def merge_with_analyst(llm, ent):
    """Luật thắng: chỉ nâng mức rủi ro, gộp thực thể, thêm lý do."""
    out = dict(llm)
    if _rank(ent["rule_level"]) > _rank(out["risk_level"]):
        out["risk_level"] = ent["rule_level"]
        out["decided_by"] = "rules"
        if out["risk_level"] == "danger":
            out["ask_trusted_circle"] = True
    else:
        out.setdefault("decided_by", "ai")
    e = out.get("entities", {})
    for k in ("phones", "urls", "accounts", "organizations"):
        e[k] = sorted(set(e.get(k, [])) | set(ent[k]))
    out["entities"] = e
    out["rule_reasons"] = ent["rule_reasons"]
    return out


# ---------- Danh sách tài khoản đã bị tố cáo ----------
_REPORTED_ACCOUNTS_CACHE = None
REPORTED_ACCOUNTS_PATH = Path(__file__).resolve().parents[2] / "data" / "reported_accounts.json"


def _load_reported_accounts(custom_path: Optional[Path] = None) -> dict:
    target = custom_path or REPORTED_ACCOUNTS_PATH
    if not target.is_file():
        alt_target = Path(__file__).resolve().parents[1] / "data" / "reported_accounts.json"
        if alt_target.is_file():
            target = alt_target
        else:
            return {}
    try:
        with open(target, "r", encoding="utf-8") as f:
            data = json.load(f)
            accounts_map = {}
            for item in data.get("accounts", []):
                acc = re.sub(r"\D", "", str(item.get("account", "")))
                if acc:
                    accounts_map[acc] = item.get("note", "")
            return accounts_map
    except Exception:
        return {}


def check_reported_account(account: str) -> dict:
    """Kiểm tra số tài khoản có trong danh sách đen/tố cáo hay không.
    Chuẩn hóa bỏ dấu cách, gạch ngang, chấm.
    Trả đúng: {"reported": bool, "note": str}
    """
    global _REPORTED_ACCOUNTS_CACHE
    if _REPORTED_ACCOUNTS_CACHE is None:
        _REPORTED_ACCOUNTS_CACHE = _load_reported_accounts()

    clean_acc = re.sub(r"\D", "", str(account)) if account is not None else ""
    if clean_acc and clean_acc in _REPORTED_ACCOUNTS_CACHE:
        return {"reported": True, "note": _REPORTED_ACCOUNTS_CACHE[clean_acc]}
    return {"reported": False, "note": ""}


def test_check_reported_account():
    # Test 1: Số khớp
    res1 = check_reported_account("0123456789")
    assert res1["reported"] is True, f"Lỗi test 1: kết quả {res1}"
    assert "tuyển cộng tác viên" in res1["note"], f"Lỗi test 1: ghi chú không khớp: {res1['note']}"

    # Test 2: Số không khớp
    res2 = check_reported_account("9999999999")
    assert res2 == {"reported": False, "note": ""}, f"Lỗi test 2: kết quả {res2}"

    # Test 3: Số có dấu cách, chấm, gạch ngang
    res3 = check_reported_account(" 0123.456-789 ")
    assert res3["reported"] is True, f"Lỗi test 3: kết quả {res3}"
    assert res3["note"] == res1["note"], f"Lỗi test 3: ghi chú không khớp: {res3['note']}"

    # Test 4: File thiếu (không ném lỗi, trả về reported=False)
    global _REPORTED_ACCOUNTS_CACHE, REPORTED_ACCOUNTS_PATH
    orig_cache = _REPORTED_ACCOUNTS_CACHE
    orig_path = REPORTED_ACCOUNTS_PATH
    try:
        REPORTED_ACCOUNTS_PATH = Path(__file__).resolve().parent / "non_existent_accounts.json"
        _REPORTED_ACCOUNTS_CACHE = None
        res4 = check_reported_account("0123456789")
        assert res4 == {"reported": False, "note": ""}, f"Lỗi test 4: kết quả {res4}"
    finally:
        REPORTED_ACCOUNTS_PATH = orig_path
        _REPORTED_ACCOUNTS_CACHE = orig_cache


if __name__ == "__main__":
    test_check_reported_account()
    print("4/4 test check_reported_account passed thành công!")
    samples = json.load(open(Path(__file__).resolve().parents[2] / "data" / "sample_messages.json", encoding="utf-8"))
    for s in samples:
        r = analyze_entities(s["text"])
        print(f'{s["id"]:<20} rule={r["rule_level"]:<10} urls={r["urls"]} phones={r["phones"]} acc={r["accounts"]}')
