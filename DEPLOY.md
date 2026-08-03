# راهنمای استقرار — Cloudflare Workers

## پیش‌نیازها
- حساب رایگان در [cloudflare.com](https://cloudflare.com)
- Node.js نصب‌شده

## مراحل استقرار

### ۱. نصب wrangler
```bash
npm install
```

### ۲. لاگین به Cloudflare
```bash
npx wrangler login
```
یک مرورگر باز می‌شه و وارد حساب Cloudflare‌ات می‌شی.

### ۳. ساخت پایگاه داده D1
```bash
npx wrangler d1 create smart-cafe-db
```
بعد از اجرا، یک `database_id` نشون داده می‌شه. اون رو در `wrangler.toml` جایگزین `REPLACE_AFTER_npx_wrangler_d1_create` کن.

### ۴. ساخت جداول
```bash
npx wrangler d1 execute smart-cafe-db --file=schema.sql
```

### ۵. تنظیم secrets (اطلاعات حساس)
```bash
npx wrangler secret put BOT_TOKEN
# مقدار: توکن ربات تلگرام خود را وارد کنید

npx wrangler secret put OPENAI_API_KEY
# مقدار: کلید API هوش مصنوعی خود را وارد کنید

npx wrangler secret put AGENT_API_KEY
# مقدار: یک کلید تصادفی امن تولید کنید (مثال: openssl rand -hex 32)
```

### ۶. استقرار
```bash
npx wrangler deploy
```
آدرسی مثل این می‌گیری:
```
https://smart-cafe-bot.YOUR-SUBDOMAIN.workers.dev
```

### ۷. تنظیم Webhook تلگرام
آدرس بالا رو در این URL جایگزین کن و در مرورگر باز کن:
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://smart-cafe-bot.YOUR-SUBDOMAIN.workers.dev/webhook
```

### ۸. داشبورد
```
https://smart-cafe-bot.YOUR-SUBDOMAIN.workers.dev/dashboard?key=<AGENT_API_KEY>
```

---

## عامل محلی (scraper)
فایل `local_agent/.env` را بساز:
```
BOT_API_URL=https://smart-cafe-bot.YOUR-SUBDOMAIN.workers.dev
AGENT_API_KEY=<AGENT_API_KEY>
SANA_PORTAL_URL=https://sana.ir
GICA_PORTAL_URL=https://gica.ir
```

سپس:
```bash
cd local_agent
npm install
npx playwright install chromium
node scraper.js
```
