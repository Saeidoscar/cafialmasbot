# امنیت پروژه — استانداردها و ملاحظات

## ۱. مدیریت رازها (Secrets)

- **هرگز** رازها را در کد منبع، `wrangler.toml`، `.env.example` یا README commit نکنید.
- کلیدها فقط در یکی از این محل‌ها ذخیره شوند:
  - **tgcloud**: از `npx wrangler secret put <KEY>` استفاده کنید.
  - **Render**: از متغیرهای محیطی پنل Render استفاده کنید.
  - **محلی**: فایل `.env` در `local_agent/` (که در `.gitignore` قرار دارد).
- `AGENT_API_KEY` باید با `openssl rand -hex 32` تولید شود و به طور دوره‌ای تغییر کند.

## ۲. احراز هویت و授权

- تمام APIهای داخلی (`/api/*`) با `X-Api-Key` یا هدر مشابه محافظت می‌شوند.
- داشبورد مدیریتی از session-based auth پس از ورود با POST استفاده می‌کند (نه query parameter در URL).
- کلید در URL به هیچ وجه منتقل نشود — در logها، referrer و تاریخچه مرورگر قابل مشاهده است.

## ۳. محدودیت نرخ (Rate Limiting)

- APIها و وب‌هوک از محدودیت نرخ در سمت سرور استفاده می‌کنند.
- در production از سرویس CDN/WAF (مثل Cloudflare Rate Limit) برای محافظت از DDoS استفاده کنید.

## ۴. اعتبارسنجی ورودی (Input Validation)

- تمام ورودی‌های کاربر (شامل پیام‌های تلگرام، callback data و bodyهای API) اعتبارسنجی می‌شوند.
- محدودیت اندازه بدنه درخواست: `10kb` برای JSON، `10kb` برای form data.
- شناسه‌های عددی (مثل `jobId`) قبل از استفاده از `Number.isInteger()` بررسی می‌شوند.

## ۵. امنیت هدرها (Security Headers)

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` در production

## ۶. محافظت از وب‌هوک تلگرام

- در صورت امکان، webhook secret token را در Telegram BotFather تنظیم کنید و در سرور اعتبارسنجی کنید.
- پاسخ فوری `200` به تلگرام ارسال می‌شود تا webhook به دلیل تاخیر timeout نشود.

## ۷. گزارش خطا

- در production، جزئیات خطای داخلی به کاربر نمایش داده نمی‌شود.
- خطاها فقط در لاگ سرور ثبت می‌شوند و حاوی مسیر فایل یا stacktrace حساس نیستند.

## ۸. پایگاه داده

- تمام کوئری‌ها از parameterized queries استفاده می‌کنند (SQL injection نمی‌خورد).
-foreign keyها در کد اپلیکیشن مدیریت می‌شوند (integrety در لاجیک برنامه).
- در صورت استفاده از SQLite، فایل `.db` هرگز در repository قرار نگیرد.

## ۹. وابستگی‌ها

- از آخرین نسخه‌های امن `express`، `better-sqlite3` و `playwright` استفاده کنید.
- قبل از استقرار، `npm audit` را اجرا کنید.

## ۱۰. پشتیبان‌گیری

- پایگاه داده به طور دوره‌ای پشتیبان‌گیری شود.
- فایل‌های `.env` و secrets به صورت رمزنگاری‌شده در جای امن ذخیره شوند.
