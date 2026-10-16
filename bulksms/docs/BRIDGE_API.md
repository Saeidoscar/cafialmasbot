# پل HTTP اپ اندروید (PayamResan Bridge) — برای عامل‌های هوش مصنوعی و اتوماسیون
# Bridge API v1

اپ اندروید یک سرور کوچک HTTP روی شبکهٔ محلی باز می‌کند تا کامپیوتر (یا هر Agent روی
کامپیوتر) بتواند فایل CSV را تحلیل کرده و ارسال را با سیم‌کارت گوشی مدیریت کند.

- آدرس پیش‌فرض: `http://<آی‌پی-گوشی>:8765`
- **همهٔ** درخواست‌ها (به‌جز `/ping`) باید هدر `X-Api-Token: <توکن>` داشته باشند؛ توکن در
  تب «۵» اپ اندروید نمایش داده می‌شود و در فایل `bridge-token.txt` داخل اپ ذخیره است.
- این پل **فقط** برای شبکهٔ محلی است. هرگز آن را روی اینترنت/روتر فوروارد باز نکنید.
- پاسخ‌ها JSON با کدگذاری UTF-8 هستند.

## نقاط پایانی

| متد | مسیر | توضیح |
|-----|------|-------|
| GET | `/ping` | بدون توکن. `{ok, app:"payamresan-android", rules, state, quota_today}` — برای جست‌وجو در شبکه |
| GET | `/status` | پیشرفت زنده: `total, done, failed, remaining, sent_run, sent_today, daily_cap, state, last` + فهرست سیم‌کارت‌ها + قوانین |
| GET | `/rules` | قوانین CSV به‌صورت JSON (همان `schema/contacts.rules.json`) |
| GET | `/sims` | سیم‌کارت‌های فعال: `subId, slot, name, carrier` |
| GET | `/contacts` | گزارش کامل فایل بارگذاری‌شده (شماره، نام، گروه) |
| GET | `/results` | فقط مخاطبین رسیده به وضعیت پایانی: `status, parts, error, sentAt, operator` |
| GET | `/metrics` | سقف امروز + مصرف ۱۴ روز اخیر + لیست کامل مخاطبین با وضعیت |
| GET | `/logs` | فهرست فایل‌های لاگ روزانه (`sent-YYYY-MM-DD.csv`) |
| GET | `/download?name=sent-2026-10-16.csv` | دانلود فایل لاگ |
| GET | `/inbox?limit=200` | پیام‌های دریافتی + پرچم `opt_out` |
| GET | `/optout` | پاسخ‌های «لغو/STOP» را در لیست سیاه می‌گذارد |
| POST | `/parse` | تحلیل CSV: `{csv_text}` یا `{csv_base64}`، `file_name`، `strict_provider` |
| POST | `/send` | بارگذاری صف + قالب + تنظیمات و/یا شروع/توقف ارسال |
| POST | `/send/start` \| `/send/pause` \| `/send/stop` | کنترل موتور ارسال |
| POST | `/quit` | خاموش کردن پل |

## مثال‌ها

```bash
# تست اتصال (بدون توکن)
curl http://192.168.1.45:8765/ping

# وضعیت
curl -H "X-Api-Token: k3f9x2m0q7" http://192.168.1.45:8765/status

# تحلیل یک CSV
curl -X POST -H "X-Api-Token: k3f9x2m0q7" -H "Content-Type: application/json" \
  -d '{"csv_text":"name,number\nعلی,09121234567\n","file_name":"c.csv"}' \
  http://192.168.1.45:8765/parse
```

```jsonc
// POST /send — بدنهٔ کامل
{
  "file_name": "contacts.csv",
  "template": "{name} عزیز، سلام. فاکتور شما آماده است. برای لغو پاسخ دهید: لغو",
  "contacts": [
    {"number": "09121234567", "name": "علی رضایی", "group": "مشتری", "delay_ms": 5000},
    {"number": "+989351234568", "name": "مریم حسینی", "group": "همکار"}
  ],
  "settings": {
    "gap_ms": 5000,                 // فاصلهٔ ارسال
    "jitter_ms": 3000,              // نوسان تصادفی
    "batch_size": 20,               // تعداد هر دسته
    "long_pause_ms": 300000,        // استراحت بین دسته‌ها
    "daily_cap": 200,               // سقف ۲۴ ساعت
    "sub_id": -1,                   // شناسهٔ سیم‌کارت (از /sims)؛ -۱ = پیش‌فرض
    "delivery_report": true,
    "dry_run": false,               // true = بدون ارسال واقعی
    "auto_continue_next_day": false,
    "retry_failed": false,
    "window": {"enabled": true, "start_hour": 9, "end_hour": 21}
  },
  "action": "start"                 // load | start | pause | resume | stop | reset
}
```

پاسخ `/send` شامل `state, total, done, failed, remaining, sent_today, preview{text, chars, parts, encoding}` است.

## نمونهٔ کلاینت پایتون (برای Agent روی PC)

```python
from bulksms.windows.payamresan.phone import Phone   # یا کپی همان فایل

p = Phone("192.168.1.45", 8765, "k3f9x2m0q7")
print(p.ping())
print(p.status())
p.send(
    contacts=[{"number": "09121234567", "name": "علی"}],
    template="{name} عزیز، سلام. این یک پیام آزمایشی است. برای لغو پاسخ دهید: لغو",
    settings={"gap_ms": 5000, "daily_cap": 50, "dry_run": True},
    action="start",
)
```

## نکات مهم برای اتوماسیون

1. `/ping` تنها مسیری است که توکن نمی‌خواهد؛ برای کشف گوشی در شبکه استفاده کنید.
2. قبل از شروع ارسال، همیشه `/parse` یا تحلیل سمت ویندوز را اجرا کنید تا ردیف‌های خراب
   وارد صف نشوند.
3. برای ارسال‌های بزرگ، سقف روزانه را از ۲۰۰ بالاتر نبرید (بند سقف اپراتور در
   `LIMITS_AND_LAW.md`).
4. پس از پایان کار، `/results` را بگیرید و در فایل CSV خودتان ذخیره کنید (برنامهٔ
   ویندوز این کار را خودکار انجام می‌دهد).
5. `/optout` را بعد از هر کمپین صدا بزنید تا پاسخ‌های لغو در لیست سیاه ثبت شوند.
