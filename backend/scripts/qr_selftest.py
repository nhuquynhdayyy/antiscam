"""Tự kiểm tra giải mã QR. Chạy từ thư mục backend:  python scripts/qr_selftest.py
Cần: pip install opencv-python-headless numpy "qrcode[pil]"
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import qrcode
from PIL import Image, ImageDraw

from app import qr


def tag(i, v):
    return f"{i}{len(v):02d}{v}"


def make_vietqr(bank_bin, account, amount, memo):
    inner = tag("00", NAPAS) + tag("01", tag("00", bank_bin) + tag("01", account)) + tag("02", "QRIBFTTA")
    body = "000201" + "010212" + tag("38", inner) + "5303704" + tag("54", amount) + "5802VN" + tag("62", tag("08", memo)) + "6304"
    return body + qr.crc16_ccitt(body)


NAPAS = "A000000727"


def qr_image(text, box=8):
    return qrcode.make(text, box_size=box, border=4).convert("RGB")


def screenshot_with(qr_img, size=(1080, 1920), pos=(300, 800)):
    canvas = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(canvas)
    d.rectangle([40, 60, size[0] - 40, 400], outline="gray")
    d.text((60, 80), "Tin nhan gia lap de thu QR", fill="black")
    canvas.paste(qr_img, pos)
    return canvas


def to_png(img):
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def check(name, cond):
    print(("OK   " if cond else "LOI  ") + name)
    return cond


ok = True
vq = make_vietqr("970436", "0123456789", "500000", "dat coc nhan viec")
ok &= check("CRC VietQR hợp lệ", vq[-4:] == qr.crc16_ccitt(vq[:-4]))

item = qr.parse_vietqr(vq)
ok &= check("Tách VietQR: ngân hàng, tài khoản, số tiền, nội dung",
            item and item["bank_name"] == "Vietcombank" and item["account"] == "0123456789"
            and item["amount"] == "500000" and item["memo"] == "dat coc nhan viec" and item["crc_ok"])

res = qr.decode_qr(to_png(qr_image("https://vcb-xacthuc.top/login")))
ok &= check("Đọc QR chứa link", res == ["https://vcb-xacthuc.top/login"])

res = qr.read_qr_items(to_png(screenshot_with(qr_image(vq, box=6))))
ok &= check("Đọc VietQR trong ảnh chụp màn hình lớn", len(res) == 1 and res[0]["kind"] == "vietqr" and res[0]["account"] == "0123456789")

small = qr_image("https://evn-thanhtoan.xyz/pay", box=2)
res = qr.decode_qr(to_png(screenshot_with(small, pos=(400, 900))))
ok &= check("Đọc QR nhỏ (cần phóng to)", res == ["https://evn-thanhtoan.xyz/pay"])

a, b = qr_image("https://a.example/x", box=6), qr_image(vq, box=6)
canvas = Image.new("RGB", (1200, 700), "white")
canvas.paste(a, (50, 100)); canvas.paste(b, (600, 100))
res = qr.decode_qr(to_png(canvas))
ok &= check("Đọc 2 mã QR trong một ảnh", len(res) == 2)

ok &= check("Ảnh không có QR trả về rỗng", qr.decode_qr(to_png(Image.new("RGB", (400, 400), "white"))) == [])
ok &= check("Dữ liệu rác không gây lỗi", qr.decode_qr(b"khong phai anh") == [])
ok &= check("describe VietQR", "Tài khoản: 0123456789" in qr.describe(item) and "500.000 VND" in qr.describe(item))
print("\nTẤT CẢ ĐẠT" if ok else "\nCÓ LỖI")