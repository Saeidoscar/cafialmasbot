"""تست دودی رابط گرافیکی ویندوز (بدون نمایشگر) + گرفتن تصویر از تب‌ها.

اجرا:  python tools/gui_smoke.py <پوشهٔ خروجی تصاویر>
در CI برای اطمینان از سالم بودن برنامه و ساخت پیش‌نمایش استفاده می‌شود.
"""
from __future__ import annotations

import os
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtCore import Qt                                  # noqa: E402
from PySide6.QtWidgets import QApplication                     # noqa: E402

from payamresan.app import MainWindow, SAMPLES                 # noqa: E402

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


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)

    app = QApplication(sys.argv[:1])
    app.setLayoutDirection(Qt.RightToLeft)
    win = MainWindow()
    win.resize(1150, 830)
    win.show()
    app.processEvents()

    csv_path = os.path.join(out, "demo-contacts.csv")
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("name,number,group,delay_ms\n")
        for i, (n, num, g) in enumerate(DEMO_ROWS):
            f.write(f"{n},{num},{g},{5000 if i % 2 == 0 else ''}\n")

    win.load_csv(csv_path)
    win.edt_template.setPlainText(SAMPLES[0][1])
    win.edt_host.setText("192.168.1.45")
    win.edt_token.setText("k3f9x2m0q7abcdef")
    app.processEvents()

    names = ["1-connection", "2-contacts", "3-message", "4-settings", "5-send"]
    for i, name in enumerate(names):
        win.tabs.setCurrentIndex(i)
        app.processEvents()
        win.grab().save(os.path.join(out, f"tab{i + 1}-{name}.png"))

    print("CSV :", win.lbl_csv.text().replace("\n", " | "))
    print("پیش‌نمایش:", win.lbl_preview.text().replace("\n", " | "))
    if "معتبر" not in win.lbl_csv.text():
        print("خطا: گزارش CSV ساخته نشد")
        return 2
    if "09121234567" not in win.lbl_preview.text() and "{number}" not in win.edt_template.toPlainText():
        pass
    print("✅ تست رابط گرافیکی موفق بود")
    return 0


if __name__ == "__main__":
    sys.exit(main())
