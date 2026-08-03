# AGENTS.md — راهنمای دستیار هوش مصنوعی

## ساختار پروژه

```
smart-cafe-serverless/
├── schema.js              ← تعریف جداول (Drizzle DSL از sdk/db)
├── handlers/
│   ├── message.js         ← هندلر پیام‌های تلگرام (export default)
│   └── callback_query.js  ← هندلر دکمه‌های inline (export default)
├── lib/
│   ├── ai.js              ← یکپارچه‌سازی GPT-4o-mini
│   └── dashboard.js       ← ساخت HTML داشبورد + توابع DB مشترک
└── local_agent/
    └── scraper.js         ← عامل Playwright محلی (مستقل از tgcloud)
```

## قوانین SDK tgcloud

### ایمپورت‌ها
```js
import { api, db, fetch }   from 'sdk';
import { table, integer, text, boolean, json, eq, and, desc, count, sql } from 'sdk/db';
import { fetch }            from 'sdk/fetch';
import { myTable }          from 'schema';        // بدون .js، بدون ./
import { myHelper }         from 'lib/helpers';   // بدون .js، بدون ./
```
- **هرگز** از مسیر نسبی (`./`, `../`) استفاده نکن
- **هرگز** `.js` به آخر ایمپورت اضافه نکن
- **هرگز** پکیج npm خارجی ایمپورت نکن

### هندلرها
```js
// handlers/message.js
export default async function (message) { ... }

// handlers/callback_query.js
export default async function (callbackQuery) { ... }
```
- پارامتر اول مستقیماً شیء update است، نه `ctx`
- `api` مستقیماً Bot API را می‌زند: `api.sendMessage({ chat_id, text })`

### پایگاه داده
```js
// خواندن
const row  = await db.select().from(table).where(eq(table.col, val)).get();
const rows = await db.select().from(table).all();

// نوشتن
await db.insert(table).values({ ... }).run();
await db.update(table).set({ ... }).where(eq(table.id, id)).run();
await db.delete(table).where(eq(table.id, id)).run();
```
- همه query ها async هستند — همیشه `await`
- foreign key وجود ندارد — integrity در کد اپلیکیشن

### استقرار
```bash
npx tgcloud push     # آپلود ماژول‌ها
npx tgcloud migrate  # اعمال تغییرات schema
```

## متغیرهای محیطی (در tgcloud dashboard)
| کلید | توضیح |
|------|-------|
| `OPENAI_API_KEY` | کلید OpenAI برای GPT-4o-mini |
| `AGENT_API_KEY`  | کلید مشترک با عامل محلی |

## منطق اصلی ربات
- `/sana` و `/gica` یک FSM مبتنی بر هوش مصنوعی را شروع می‌کنند
- `users.state` وضعیت FSM را نگه می‌دارد: `START` | `AI_COLLECTING_SANA` | `AI_COLLECTING_GICA`
- پس از جمع‌آوری اطلاعات، یک `scraping_job` با وضعیت `PENDING` ایجاد می‌شود
- عامل محلی (`local_agent/scraper.js`) کارها را poll می‌کند و Playwright را اجرا می‌کند

## استانداردهای امنیتی

### رازها
- **هرگز** راز (API key، توکن، کلید) را در کد منبع یا config commit نکنید.
- کلیدها فقط در متغیرهای محیطی پنل tgcloud/Render یا فایل `.gitignore` شده ذخیره شوند.
- `AGENT_API_KEY` باید با `openssl rand -hex 32` تولید شود.

### احراز هویت
- تمام endpointهای `/api/` با هدر `X-Api-Key` محافظت می‌شوند.
- داشبورد از session-based auth (POST + کوکی) استفاده می‌کند، نه query parameter.
- وب‌هوک تلگرام در صورت امکان با secret token اعتبارسنجی شود.

### اعتبارسنجی ورودی
- تمام ورودی‌ها اعتبارسنجی شوند: اندازه body حداکثر `10kb`، شناسه‌ها عددی معتبر، status از enum مجاز.
- داده‌های JSON قبل از parse بررسی شوند.

### هدرهای امنیتی
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` در production

### خطاها
- در production، جزئیات خطای داخلی به کلاینت نمایش داده نشود.
- خطاها فقط در لاگ ثبت شوند.
