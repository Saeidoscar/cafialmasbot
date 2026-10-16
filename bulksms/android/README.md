# پیام‌رسان گروهی — اپ اندروید (Kotlin)
# PayamResan — Android app (Kotlin, no third-party runtime deps)

اپ مستقل اندروید برای خواندن CSV مخاطبین و **ارسال گروهی پیامک با سیم‌کارت خود گوشی**.
بدون سرویس ابری، بدون SDK تجاری، بدون دسترسی اینترنت برای ارسال (فقط برای پل اختیاری).

## ساخت

```bash
cd bulksms/android
gradle assembleDebug        # خروجی: app/build/outputs/apk/debug/app-debug.apk
gradle assembleRelease      # خروجی: app/build/outputs/apk/release/app-release.apk
```

نیازمندی‌ها: JDK 17، Android SDK (compileSdk 34، build-tools 34) و Gradle 8.7+.
برای امضای نسخهٔ release چهار متغیر محیطی بگذارید (وگرنه با کلید debug امضا می‌شود):

```bash
export RELEASE_STORE_FILE=/path/to/payamresan.p12
export RELEASE_STORE_PASSWORD=…
export RELEASE_KEY_ALIAS=payamresan
export RELEASE_KEY_PASSWORD=…
```

ساخت خودکار روی GitHub Actions: `.github/workflows/build-payamresan.yml` (job «android»).

## ساختار کد

| فایل | مسئولیت |
|------|---------|
| `Rules.kt` | **مرجع قوانین CSV**: نام ستون‌ها، نرمال‌سازی شمارهٔ ایران، پیش‌شمارهٔ اپراتورها، شماره‌های نمونه، شمارش پیامک |
| `Csv.kt` | خواندن CSV: تشخیص BOM/انکودینگ (UTF-8، UTF-16، windows-1256)، تشخیص جداکننده (`,` `;` tab `|`)، فیلدهای کوتیشن‌دار |
| `Contacts.kt` | تحلیل ردیف‌ها → مخاطب معتبر/نامعتبر/تکراری/ردشده + گزارش JSON و CSV |
| `Sms.kt` | ارسال با `SmsManager` روی سیم‌کارت انتخابی، انتظار برای نتیجهٔ واقعی هر پیامک، فهرست سیم‌کارت‌ها، تقسیم پیام چندبخشی |
| `Engine.kt` | صف ارسال: سقف روزانه، فاصلهٔ تصادفی، استراحت دسته‌ای، بازهٔ ساعتی، توقف/ادامه، ذخیرهٔ وضعیت، لاگ `sent-YYYY-MM-DD.csv`، قالب `{name}` |
| `SendService.kt` | سرویس پیش‌زمینه تا ارسال با خاموش شدن صفحه قطع نشود |
| `Bridge.kt` | پل HTTP محلی (توکن‌دار) برای کنترل از کامپیوتر/Agent |
| `ApiExtra.kt` | نقاط پایانی `/parse` و `/send` + صندوق ورودی و تشخیص «لغو» (لیست سیاه) |
| `MainActivity.kt` | رابط فارسی: انتخاب CSV، گزارش، متن پیام، تنظیمات ایمنی، شروع/توقف، پیشرفت زنده |

## مجوزهای اپ و دلیل هر کدام

| مجوز | چرا |
|------|-----|
| `SEND_SMS` | ارسال واقعی پیامک (بدون آن اپ بی‌فایده است) |
| `READ_PHONE_STATE`, `READ_PHONE_NUMBERS` | شناسایی سیم‌کارت‌های فعال برای انتخاب سیم ارسال |
| `RECEIVE_SMS`, `READ_SMS` | تشخیص پاسخ‌های «لغو/STOP» و افزودن آن‌ها به لیست سیاه (اختیاری) |
| `INTERNET`, `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE` | فقط برای پل وای‌فای اختیاری با کامپیوتر |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` | ادامهٔ ارسال با خاموش شدن صفحه + نمایش وضعیت |
| `WAKE_LOCK`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | جلوگیری از متوقف شدن ارسال توسط بهینه‌سازی باتری |

## نکات پیاده‌سازی

- ارسال با `sendMultipartTextMessage` و انتظار روی `PendingIntent` نتیجه انجام می‌شود؛
  یعنی «ارسال شد» فقط وقتی ثبت می‌شود که شبکه پذیرش را تأیید کند (نه فقط با صف شدن).
- `Engine` وضعیت صف را در `campaign-state.json` ذخیره می‌کند تا اگر برنامه بسته شد،
  ادامهٔ ارسال از همان‌جا امکان‌پذیر باشد (دکمهٔ بازیابی در شروع اپ).
- سقف روزانه در `quota.json` با کلید تاریخ ذخیره می‌شود (به‌تفکیک روز).
- پل با توکن تصادفی در `bridge-token.txt` محافظت می‌شود و فقط روی شبکهٔ محلی گوش می‌دهد؛
  در `docs/BRIDGE_API.md` کامل مستند شده است.

## ساخت مجدد سریع (CI)

`.github/workflows/build-payamresan.yml` → job «android»:
JDK 17 → کلید امضا (از Secrets یا کش) → `assembleDebug assembleRelease` →
آرتیفکت `payamresan-android-apk` (شامل `SHA256SUMS-apk.txt`) + آرتیفکت کلید امضا.
