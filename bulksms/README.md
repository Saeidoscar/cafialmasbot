# PayamResan — ارسال پیامک گروهی با سیم‌کارت گوشی (CSV → SMS)
# Bulk SMS with your own SIM card: Android APK + Windows EXE, driven by a CSV

<div dir="rtl">

**پیام‌رسان گروهی** دو برنامه است که با هم کار می‌کنند و پیامک‌ها را **با سیم‌کارت واقعی
گوشی خودتان** (Poco M5s — همراه اول) می‌فرستند؛ نه با سرویس ابری، نه با درگاه پیامکی،
نه با وب‌سایت واسطه:

| خروجی | چیست | چه کاری می‌کند |
|-------|------|----------------|
| **`payamresan-android-apk`** → `app-release.apk` | اپ اندروید (مستقل) | فایل CSV را می‌خواند، متن پیام را می‌گیرد، با سیم‌کارت انتخابی **ارسال گروهی** می‌کند — با سقف روزانه، فاصله‌گذاری، توقف/ادامه و لاگ CSV |
| **`payamresan-windows-exe`** → `PayamResan-Setup.exe` | برنامهٔ ویندوز | CSV را با همان قوانین تحلیل می‌کند، خطاها را گزارش می‌دهد، قالب پیام می‌سازد، پیش‌نمایش و زمان‌بندی می‌دهد و از طریق پل وای‌فای، ارسال را **روی گوشی** راه می‌اندازد |

نکتهٔ مهم: کامپیوتر شما **مودم GSM ندارد**، پس نمی‌تواند خودش پیامک بفرستد. به همین
دلیل ارسال همیشه با سیم‌کارت گوشی انجام می‌شود و برنامهٔ ویندوز «دوربین کنترل» است:
تحلیل CSV، تنظیم قواعد، نمایش پیشرفت و گزارش‌گیری.

## دیدن فایل‌های نهایی (APK و EXE)

فایل‌های ساخته‌شده به‌صورت خودکار توسط GitHub Actions تولید می‌شوند:

**Actions → Build PayamResan (APK + EXE) → آخرین اجرا → بخش Artifacts**

- `payamresan-android-apk` — فایل نصبی اندروید
- `payamresan-windows-exe` — برنامهٔ ویندوز
- `payamresan-gui-preview` — تصاویر محیط برنامهٔ ویندوز
- `payamresan-signing-key` — کلید امضا (بار اول؛ روش ثابت کردنش در `docs/INSTALL.md`)

راهنمای نصب گام‌به‌گام: [`docs/INSTALL.md`](docs/INSTALL.md)

## قوانین CSV (خلاصه — سند کامل: [`docs/CSV_RULES.md`](docs/CSV_RULES.md))

فایل باید **یک ستون شماره** داشته باشد. نام ستون می‌تواند هر یک از این‌ها باشد
(به فاصله، `_`، `-`، حروف بزرگ/کوچک و نیم‌فاصله حساس نیست):

```
number | phone | phone_number | mobile | mobile_number | cell | tel | msisdn | contact
شماره | شماره تماس | شماره موبایل | شماره تلفن | موبایل | تلفن | تلفن همراه | همراه
```

ستون نام (اختیاری):

```
name | full_name | display_name | نام | نام کامل | نام و نام خانوادگی
first_name/firstname/نام کوچک   و   last_name/family/نام خانوادگی
```

ستون‌های کنترلی (اختیاری): `skip`/`رد` · `delay_ms`/`تاخیر` · `group`/`گروه` ·
`provider`/`اپراتور` — و **هر ستون دلخواه دیگر** که با `{نامستون}` در متن پیام می‌آید.

شماره‌ها در همهٔ این شکل‌ها پذیرفته و به `09XXXXXXXXX` تبدیل می‌شوند:

```
09121234567 · ۰۹۱۲۱۲۳۴۵۶۷ · ٠٩١٢١٢٣٤٥٦٧ · 0912 123 4567
+989121234567 · 00989121234567 · 989121234567
```

رد می‌شوند (با دلیل در گزارش): شمارهٔ کوتاه، تلفن ثابت (`021…`)، شمارهٔ نمونه/جعلی
(`09123456789`, `09111111111`)، سیم‌کارت مودم (`0941…`)، شمارهٔ تکراری و ردیف بدون شماره.

نمونهٔ درست:

```csv
name,number,group,delay_ms
علی رضایی,09121234567,مشتری,5000
مریم حسینی,+989351234568,همکار,
سارا محمدی,۰۹۱۹۱۲۳۴۵۶۷,خانواده,3000
```

نمونه‌های آماده در [`samples/`](samples) و قرارداد ماشین‌خوان در
[`schema/contacts.rules.json`](schema/contacts.rules.json).

## ارسال ۱۰۰۰ پیام — طرح پیشنهادی

سقف سیم‌کارت شخصی در ایران حدود **۲۰۰ تا ۵۰۰ پیام در ۲۴ ساعت** است (هر پیامک فارسی
۷۰ کاراکتر = ۱ صفحه). با پیش‌فرض‌های این برنامه:

| روز | تعداد | مدت تقریبی ارسال پیوسته |
|-----|-------|--------------------------|
| ۱ | ۲۰۰ | ≈ ۴۵ دقیقه |
| ۲ | ۲۰۰ | ≈ ۴۵ دقیقه |
| ۳ | ۲۰۰ | ≈ ۴۵ دقیقه |
| ۴ | ۲۰۰ | ≈ ۴۵ دقیقه |
| ۵ | ۲۰۰ | ≈ ۴۵ دقیقه |

برای این کار در برنامهٔ ویندوز/اندروید:

- سقف روزانه: `200`
- فاصلهٔ ارسال: `5` ثانیه + نوسان `3` ثانیه
- استراحت: هر `20` پیام، `300` ثانیه
- بازهٔ ساعتی: `9` تا `21`
- گزینهٔ **«پس از پر شدن سقف روزانه، خودکار فردا ادامه بده»** را روشن کنید تا صف بدون
  دخالت شما در چند روز تمام شود (گوشی باید روشن و شارژ باشد).

جزئیات قانونی و ریسک‌ها: [`docs/LIMITS_AND_LAW.md`](docs/LIMITS_AND_LAW.md).

## امکانات

**اپ اندروید**
- خواندن CSV از حافظه/دانلود/درایو با تشخیص خودکار انکودینگ (UTF-8/UTF-16/windows-1256)
  و جداکننده (کاما/نقطه‌ویرگول/Tab/پایپ)
- تحلیل و گزارش: معتبر، نامعتبر (با دلیل)، تکراری، ردشده + خروجی CSV خطاها و لیست تمیز
- انتخاب سیم‌کارت (دو سیم Poco M5s)، ارسال با `SmsManager` و انتظار برای نتیجهٔ واقعی هر پیامک
- سقف روزانه، فاصلهٔ تصادفی، استراحت دسته‌ای، بازهٔ ساعتی، توقف/ادامه/توقف کامل
- سرویس پیش‌زمینه تا با خاموش شدن نمایشگر قطع نشود + ذخیرهٔ وضعیت صف برای ادامهٔ بعدی
- لاگ روزانه `sent-YYYY-MM-DD.csv` و خواندن صندوق ورودی برای تشخیص «لغو» (لیست سیاه)
- پل HTTP برای کنترل از کامپیوتر (بدون اینترنت، فقط وای‌فای محلی)

**برنامهٔ ویندوز**
- رابط کامل فارسی/RTL، پنج تب: اتصال، مخاطبین، متن پیام، تنظیمات، ارسال
- تحلیل CSV با همان موتور قوانین، جدول مخاطبین، خروجی خطاها/لیست تمیز/گزارش
- پیش‌نمایش زندهٔ متن با شمارش کاراکتر و تعداد پیامک (۷۰ کاراکتر فارسی / ۱۶۰ لاتین)
- شبیه‌سازی کامل «بدون ارسال» + برآورد زمان و تعداد روز
- جست‌وجوی خودکار گوشی در شبکه، گزارش مصرف ۱۴ روز، آیکن سینی سیستم، توقف فوری
- لاگ CSV محلی از نتایج واقعی ارسال

## مستندات

| سند | محتوا |
|-----|-------|
| [`docs/INSTALL.md`](docs/INSTALL.md) | نصب اندروید/ویندوز، تنظیمات Poco M5s، رفع اشکال |
| [`docs/CSV_RULES.md`](docs/CSV_RULES.md) | قرارداد کامل CSV (نسخهٔ ۱.۰) |
| [`docs/LIMITS_AND_LAW.md`](docs/LIMITS_AND_LAW.md) | سقف اپراتورها، قوانین، روش درست ارسال |
| [`docs/AGENT_PROMPT.md`](docs/AGENT_PROMPT.md) | پرامپت آماده برای عامل‌های هوش مصنوعی که CSV می‌سازند |
| [`docs/BRIDGE_API.md`](docs/BRIDGE_API.md) | پل HTTP گوشی برای اتوماسیون |
| [`schema/contacts.rules.json`](schema/contacts.rules.json) | قوانین ماشین‌خوان (نسخهٔ ۱.۰) |
| [`demo.html`](demo.html) | صفحهٔ نمای کلی و راهنما (قابل باز شدن در مرورگر) |

## ساختار پروژه

```
bulksms/
├── android/                      اپ اندروید (Kotlin، بدون وابستگی سنگین)
│   └── app/src/main/java/ir/payamresan/bulk/
│       ├── Rules.kt              مرجع قوانین CSV + نرمال‌سازی شماره
│       ├── Csv.kt                خواندن CSV (انکودینگ/جداکننده/کوتیشن)
│       ├── Contacts.kt           تحلیل، اعتبارسنجی، گزارش خطاها
│       ├── Sms.kt                SmsManager + نتیجهٔ واقعی + سیم‌کارت‌ها
│       ├── Engine.kt             صف، سقف روزانه، بازهٔ ساعتی، بایگانی وضعیت
│       ├── SendService.kt        سرویس پیش‌زمینه
│       ├── Bridge.kt/ApiExtra.kt پل HTTP + صندوق ورودی/لغو
│       └── MainActivity.kt       رابط فارسی اپ
├── windows/                      برنامهٔ ویندوز (Python + PySide6 → EXE)
│   ├── payamresan/rules.py       همان قوانین، پورت‌شده
│   ├── payamresan/csvio.py       خواندن/نوشتن CSV
│   ├── payamresan/phone.py       کلاینت پل گوشی + جست‌وجوی شبکه
│   ├── payamresan/app.py         رابط گرافیکی (۵ تب)
│   └── tools/                    selftest.py و gui_smoke.py
├── schema/                       قرارداد ماشین‌خوان قوانین
├── samples/                      نمونه فایل‌های CSV
└── docs/                         مستندات + صفحهٔ HTML
```

## ساخت خودکار

`.github/workflows/build-payamresan.yml` با هر push روی `bulksms/**`:

1. **job اندروید:** JDK 17 + Gradle 8.9 → `assembleDebug assembleRelease` → آرتیفکت APK
   (کلید امضا از Secrets یا کش یا کلید تازه)
2. **job ویندوز:** Python 3.11 + PySide6 → `selftest.py` (۳۳ تست قوانین/CSV) →
   `gui_smoke.py` (تست رابط + تصاویر) → PyInstaller → آرتیفکت EXE

## محدودیت‌ها (صادقانه)

- ارسال از سیم‌کارت شخصی سقف دارد (۲۰۰–۵۰۰ در ۲۴ ساعت). برای تبلیغات انبوه با مخاطب
  ناشناس، مسیر قانونی استفاده از **پنل پیامکی** است، نه این برنامه.
- گزارش تحویل (Delivery Report) در ایران همیشه از سمت اپراتور برنمی‌گردد؛ برنامه
  نتیجهٔ **پذیرش شبکه** را ثبت می‌کند و «تحویل» را در صورت دریافت علامت می‌زند.
- این برنامه پیامک **دریافتی** را فقط در صورت دادن دسترسی «خواندن پیامک» می‌بیند و
  صرفاً برای تشخیص «لغو» استفاده می‌کند.
- پل HTTP فقط برای شبکهٔ محلی است؛ روی اینترنت بازش نکنید (توکن محافظت اولیه است).
- مسئولیت محتوا، رضایت گیرندگان و رعایت مقررات با کاربر است.
</div>

---

## English summary

`bulksms/` contains a personal bulk-SMS toolkit that sends through **your own SIM card**
(no cloud SMS gateway):

- **Android app (Kotlin, ~1 MB APK)** — reads CSV, validates Iranian mobile numbers,
  renders per-contact templates, and sends via `SmsManager` on a chosen SIM with a daily
  cap, randomized spacing, batch pauses, quiet hours, pause/resume, foreground service,
  persisted queue, CSV logs and an SMS inbox opt-out scanner. Also exposes a
  token-protected LAN HTTP bridge.
- **Windows app (PySide6 → single EXE)** — analyzes the CSV with the identical rule engine,
  builds the message template with live preview and segment counting, estimates run time,
  and drives the phone over Wi-Fi (`POST /send`), including auto-discovery, progress,
  14-day quota history and local CSV result logs.

**CSV contract v1.0** — required number column with 26 accepted aliases (English + Persian),
optional name/group/skip/delay/provider columns, Persian/Arabic digit normalization to
`09XXXXXXXXX`, rejection of landlines/fake/duplicate/data-only-SIM numbers, UTF-8/UTF-16/
windows-1256 input, `, ; tab |` delimiters. Machine-readable version:
`schema/contacts.rules.json`.

Both artifacts are built by GitHub Actions (`Build PayamResan (APK + EXE)`); download them
from the run's **Artifacts** section. See `docs/INSTALL.md` for setup and
`docs/LIMITS_AND_LAW.md` for the operator limits (≈200–500 SMS per 24 h on personal SIMs).

> Personal use. Sending unsolicited bulk advertising from a personal Iranian SIM is
> restricted by regulators and can get the SIM blocked — always include an opt-out line
> and keep within the daily cap.
