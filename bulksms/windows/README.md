# PayamResan Desktop — برنامهٔ ویندوز

برنامهٔ رومیزی برای تحلیل فایل CSV مخاطبین و **کنترل ارسال گروهی روی گوشی اندروید**
از طریق پل وای‌فای. ارسال واقعی پیامک با سیم‌کارت گوشی انجام می‌شود (کامپیوتر مودم
GSM ندارد)؛ این برنامه صف را می‌سازد، متن هر پیام را شخصی‌سازی می‌کند و گوشی را هدایت می‌کند.

## راه‌اندازی سریع

### الف) با فایل EXE (بدون نیاز به Python)
1. `PayamResan-Setup.exe` را از Artifacts اجرای GitHub Actions بگیرید و اجرا کنید.
2. در اپ اندروید، تب «۵» → «روشن کردن پل» → آدرس و توکن را ببینید.
3. در برنامهٔ ویندوز، تب «۱»: همان آدرس/پورت/توکن → «تست اتصال».
4. تب «۲»: انتخاب فایل CSV → تب «۳»: نوشتن متن پیام → تب «۵»: «شروع ارسال».

### ب) با Python (برای توسعه)
```bat
pip install -r requirements.txt
run.bat
```

## تست بدون گوشی
```bat
python tools\mock_phone.py 8765 testtoken 0.2 7
```
سرور جعلی پل گوشی روی `127.0.0.1:8765` با توکن `testtoken` بالا می‌آید
(آرگومان‌های اختیاری: پورت، توکن، فاصلهٔ ارسال، خراب کردن هر چندمین پیام).
همان مشخصات را در تب «۱» برنامه وارد کنید و «شروع ارسال» بزنید — هیچ پیامک واقعی
فرستاده نمی‌شود.

## تست‌های خودکار
```bat
python tools\selftest.py           # ۳۳ تست قوانین CSV، نرمال‌سازی شماره، شمارش پیامک
python tools\gui_smoke.py preview  # رابط گرافیکی + جریان کامل ارسال با سرور جعلی + تصاویر
python tools\mock_phone.py --help   # راهنمای سرور جعلی
```

## ساخت EXE روی ویندوز
```bat
pip install -r requirements.txt pyinstaller
pyinstaller --noconfirm --clean --onefile --windowed ^
  --name PayamResan-Setup ^
  --add-data "payamresan/icon.png;payamresan" ^
  --exclude-module tkinter --exclude-module PySide6.QtWebEngineCore ^
  PayamResan.py
```
خروجی: `dist\PayamResan-Setup.exe`

## قوانین CSV
مرجع کامل: `../docs/CSV_RULES.md` — خلاصه:
- ستون شماره (اجباری): `number` | `phone` | `mobile` | `tel` | `msisdn` | `شماره` | `موبایل` | `تلفن همراه` …
- ستون نام (اختیاری): `name` | `full_name` | `نام` | `نام کامل` | `نام و نام خانوادگی`
- ستون‌های کنترلی: `skip` | `delay_ms` | `group` | `provider`
- شماره‌ها: `09121234567`، `۰۹۱۲۱۲۳۴۵۶۷`، `+989121234567`، `0912 123 4567` → همه به `09XXXXXXXXX` تبدیل می‌شوند.

## ساختار
```
PayamResan.py            نقطهٔ ورود (اجرای مستقیم و ساخت EXE)
payamresan/
  app.py                 رابط گرافیکی (۵ تب، RTL)
  rules.py               قوانین CSV + نرمال‌سازی شماره + شمارش پیامک
  csvio.py               خواندن/نوشتن CSV (انکودینگ و جداکنندهٔ خودکار)
  phone.py               کلاینت پل گوشی + جست‌وجوی شبکه
  icon.png               آیکن برنامه
tools/
  selftest.py            تست قوانین و CSV
  gui_smoke.py           تست رابط + جریان کامل + تصاویر
  mock_phone.py          سرور جعلی پل گوشی
```
