"""تست دودی رابط گرافیکی ویندوز (بدون نمایشگر) + تصویر تب‌ها + تست یکپارچه با سرور جعلی گوشی.

اجرا:  python tools/gui_smoke.py <پوشهٔ خروجی تصاویر>
در CI برای اطمینان از سالم بودن برنامه و ساخت پیش‌نمایش استفاده می‌شود.
"""
from __future__ import annotations

import os
import sys
import threading
import time

# چاپ متن فارسی در کنسول ویندوز (CI) بدون خطای انکودینگ
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["PAYAMRESAN_HEADLESS"] = "1"
os.environ.setdefault("PAYAMRESAN_SETTINGS_DIR", ".")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtCore import Qt                                  # noqa: E402
from PySide6.QtWidgets import QApplication                     # noqa: E402

from payamresan.app import MainWindow, SAMPLES                 # noqa: E402
from tools.mock_phone import serve as serve_mock               # noqa: E402

DEMO_ROWS = [
    ("علی رضایی", "09121234567", "مشتری"),
    ("مریم حسینی", "09351234568", "همکار"),
    ("محمد کریمی", "+989121234569", "دوست"),
    ("سارا محمدی", "۰۹۱۹۱۲۳۴۵۶۷", "خانواده"),
    ("رضا احمدی", "09361112233", "مشتری"),
    ("نگار سلطانی", "09201234567", ""),
    ("شرکت پارس", "02188776655", ""),
    ("تست نمونه", "09123456789", ""),
    ("علی رضایی", "0912 123 4567", "تکراری"),
]

MOCK_PORT = 8799
MOCK_TOKEN = "smoketoken"


def spin(app, seconds=0.5):
    """اجرای حلقهٔ رویداد Qt به‌مدت مشخص."""
    end = time.time() + seconds
    while time.time() < end:
        app.processEvents()
        time.sleep(0.02)


def wait_for(app, predicate, timeout=25.0):
    end = time.time() + timeout
    while time.time() < end:
        app.processEvents()
        if predicate():
            return True
        time.sleep(0.05)
    return False


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    failures = []

    print("گام ۱: ساخت QApplication")
    app = QApplication(sys.argv[:1])
    app.setLayoutDirection(Qt.RightToLeft)

    print("گام ۲: ساخت پنجرهٔ اصلی")
    win = MainWindow()
    win.resize(1150, 830)
    win.show()
    spin(app, 0.3)

    # ---------- CSV
    print("گام ۳: خواندن فایل نمونه")
    csv_path = os.path.join(out, "demo-contacts.csv")
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("name,number,group,delay_ms\n")
        for i, (n, num, g) in enumerate(DEMO_ROWS):
            f.write(f"{n},{num},{g},{5000 if i % 2 == 0 else ''}\n")
    win.load_csv(csv_path)
    spin(app, 0.3)
    print("  CSV:", win.lbl_csv.text().replace("\n", " | "))
    if "معتبر" not in win.lbl_csv.text():
        failures.append("گزارش CSV ساخته نشد")
    if len(win.rep.valid) != 6:
        failures.append(f"تعداد مخاطب معتبر غیرمنتظره: {len(win.rep.valid)} (انتظار: ۶)")
    if len(win.rep.invalid) != 2:
        failures.append(f"تعداد ردیف نامعتبر غیرمنتظره: {len(win.rep.invalid)} (انتظار: ۲)")
    if win.rep.duplicates != 1:
        failures.append(f"تعداد تکراری غیرمنتظره: {win.rep.duplicates} (انتظار: ۱)")

    # ---------- قالب، متغیرها، شبیه‌سازی
    print("گام ۴: قالب پیام و متغیرها")
    win.edt_template.setPlainText(SAMPLES[0][1])
    win.refresh_tokens(win.rep)
    win.cmb_tokens.setCurrentIndex(1)
    win.insert_token(0)
    win.cmb_samples.setCurrentIndex(1)
    win.apply_sample(0)
    win.simulate()
    win.show_rules()
    win.show_limits()
    win.export_invalid()
    win.export_clean()
    win.save_sample_csv()
    spin(app, 0.2)
    prev = win.lbl_preview.text()
    print("  پیش‌نمایش:", prev.replace("\n", " | ")[:160])
    if "کاراکتر" not in prev:
        failures.append("پیش‌نمایش متن ساخته نشد")

    # ---------- سرور جعلی گوشی (تست یکپارچه از دید برنامهٔ ویندوز)
    print("گام ۵: راه‌اندازی سرور جعلی گوشی")
    httpd = serve_mock(port=MOCK_PORT, token=MOCK_TOKEN, gap=0.02)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    win.ed_host.setText("127.0.0.1")
    win.sp_port.setValue(MOCK_PORT)
    win.ed_token.setText(MOCK_TOKEN)
    win.test_connection()
    if not wait_for(app, lambda: not win.busy(), timeout=15):
        failures.append("تست اتصال به سرور جعلی پاسخ نداد")
    if not wait_for(app, lambda: win.cmb_sim.count() > 0 and "127" not in win.lbl_conn.text(), timeout=10):
        pass
    print("  وضعیت اتصال:", win.lbl_conn.text(), "| سیم‌کارت‌ها:", win.cmb_sim.count())

    print("گام ۶: ارسال صف به گوشی (شبیه‌سازی‌شده) و پیگیری وضعیت")
    win.push_config(start=True)
    wait_for(app, lambda: not win.busy(), timeout=20)
    for _ in range(60):
        win.poll()
        spin(app, 0.15)
        if win.progress.value() >= win.progress.maximum() and win.progress.maximum() > 1:
            break
    for _ in range(3):
        win.poll()
        spin(app, 0.2)
    print("  پیشرفت:", win.progress.value(), "/", win.progress.maximum())
    print("  نتایج ثبت‌شده:", len(win.result_rows))
    if len(win.result_rows) < 6:
        failures.append(f"نتایج واقعی ثبت نشد: {len(win.result_rows)} (انتظار ≥ ۶)")
    out_dir = win.out_dir
    if not out_dir or not os.path.isdir(out_dir):
        failures.append("پوشهٔ خروجی ساخته نشد")
    html_files = os.listdir(out_dir) if out_dir and os.path.isdir(out_dir) else []
    print("  پوشهٔ خروجی:", out_dir, html_files)
    if not any(str(f).startswith("results-") for f in html_files):
        failures.append("فایل گزارش CSV ساخته نشد")
    win.export_results()
    win.apply_optouts()
    win.refresh_sims()
    spin(app, 0.4)

    print("گام ۷: تست هم‌زمانی درخواست‌ها (status/results/metrics)")
    for _ in range(6):
        win.poll()
        win.submit("results", win.phone().results)
        win.submit("metrics", win.phone().metrics)
        spin(app, 0.1)
    if not wait_for(app, lambda: not win.busy(), timeout=15):
        failures.append("درخواست‌های هم‌زمان تمام نشدند (احتمال قفل شدن)")
    print("  در جریان:", win.inflight)

    print("گام ۸: گرفتن تصاویر تب‌ها")
    names = ["1-connection", "2-contacts", "3-message", "4-settings", "5-send"]
    for i, name in enumerate(names):
        win.tabs.setCurrentIndex(i)
        spin(app, 0.15)
        win.grab().save(os.path.join(out, f"tab{i + 1}-{name}.png"))
    for extra, name in ((1, "help-rules"),):
        pass

    httpd.shutdown()

    print()
    if failures:
        for f in failures:
            print("❌ " + f)
        return 1
    print("✅ تست رابط گرافیکی و جریان کامل ارسال موفق بود")
    return 0


if __name__ == "__main__":
    sys.exit(main())
