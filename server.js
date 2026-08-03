// ─────────────────────────────────────────────
// server.js — سرور اصلی Express (Render.com)
// ─────────────────────────────────────────────

import 'dotenv/config';
import express        from 'express';
import { mkdirSync }  from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { loadEnv, getAgentApiKey, getDashboardApiKey, ENV }                          from './src/config/env.js';
import { AppError }                               from './src/errors/AppError.js';
import { errorHandler, AuthError, RateLimitError, ValidationError } from './src/http/error-handler.js';
import { ok, fail }                               from './src/http/response.js';
import { requestIdMiddleware }                    from './src/http/request-id.js';
import { maskSensitive, safeError }               from './src/logging/logger.js';
import { validateStatus, validateLimit, validateJobId } from './src/validation/validators.js';
import { backupDatabase, listBackups, restoreBackup }   from './src/db/backup.js';
import { runMigrations, rollbackLastMigration }   from './src/db/migration-runner.js';
import { UsersRepository, ScrapingJobsRepository, LinkedChatsRepository } from './src/db/repository.js';

import { getDb, dbGet, dbAll, dbRun, fromJSON } from './src/lib/db.js';
import { createTelegramAPI }                     from './src/lib/telegram.js';
import { handleMessage }                         from './src/handlers/message.js';
import { handleCallbackQuery }                   from './src/handlers/callback_query.js';

// ─────────────────────────────────────────────
// راه‌اندازی
// ─────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT ?? 3000;

loadEnv();

if (!ENV.BOT_TOKEN) {
  console.error('[خطا] متغیر BOT_TOKEN تنظیم نشده است.');
  process.exit(1);
}

if (!getAgentApiKey()) {
  console.error('[خطا] متغیر AGENT_API_KEY تنظیم نشده است. یک کلید تصادفی امن تولید کنید.');
  process.exit(1);
}

if (!getDashboardApiKey()) {
  console.warn('[هشدار] متغیر DASHBOARD_API_KEY تنظیم نشده — داشبورد با استفاده از AGENT_API_KEY محافظت می‌شود.');
}

const NODE_ENV = ENV.NODE_ENV;

mkdirSync(join(__dirname, 'data'), { recursive: true });

const db = getDb();
const usersRepo = new UsersRepository(db);
const jobsRepo = new ScrapingJobsRepository(db);
const chatsRepo = new LinkedChatsRepository(db);

try {
  await runMigrations();
} catch (err) {
  console.error('[Migration] خطای اجرای مهاجره‌ها:', err);
  process.exit(1);
}

const api = createTelegramAPI(ENV.BOT_TOKEN);
const app = express();

// ─────────────────────────────────────────────
// استانداردهای امنیتی — میان‌افزارهای سراسری
// ─────────────────────────────────────────────

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(requestIdMiddleware);

const rateLimitMap = new Map();
const RATE_LIMIT_FILE = join(__dirname, 'data', 'rate-limits.json');

async function loadRateLimits() {
  try {
    const fs = await import('fs');
    if (fs.existsSync(RATE_LIMIT_FILE)) {
      const raw = fs.readFileSync(RATE_LIMIT_FILE, 'utf8');
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [key, record] of Object.entries(data)) {
        if (now - record.ts < 60000) {
          rateLimitMap.set(key, record);
        }
      }
    }
  } catch {
    // ignore
  }
}

async function saveRateLimits() {
  try {
    const fs = await import('fs');
    const obj = Object.fromEntries(rateLimitMap);
    fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function startRateLimitPersistence() {
  setInterval(saveRateLimits, 30000);
  process.on('SIGINT', () => { saveRateLimits(); process.exit(0); });
  process.on('SIGTERM', () => { saveRateLimits(); process.exit(0); });
}

function rateLimit(windowMs = 60000, max = 30) {
  return (req, res, next) => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const record = rateLimitMap.get(key);
    if (!record || now - record.ts > windowMs) {
      rateLimitMap.set(key, { ts: now, count: 1 });
    } else if (record.count >= max) {
      return res.status(429).json({ ...fail(new RateLimitError()).payload });
    } else {
      record.count++;
    }
    next();
  };
}

app.use('/api/', rateLimit());
app.use('/webhook', rateLimit(1000, 10));

await loadRateLimits();
startRateLimitPersistence();

const sessionStore = new Map();
const SESSION_COOKIE = 'cafe_dashboard_session';

function parseCookie(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[decodeURIComponent(k)] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function sessionMiddleware(req, res, next) {
  const cookies = parseCookie(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId && sessionStore.has(sessionId)) {
    req.session = sessionStore.get(sessionId);
  }
  req.session = req.session ?? {};
  res.setHeader('Cache-Control', 'no-store');
  next();
}
app.use(sessionMiddleware);

function sanitizeError(err) {
  if (NODE_ENV === 'production') {
    return { ok: false, error: 'خطای سیستمی.' };
  }
  return { ok: false, error: err.message ?? String(err) };
}

app.use((err, req, res, next) => {
  safeError('[Unhandled]', { error: err.stack ?? String(err) }, req?.id);
  if (!res.headersSent) {
    res.status(500).json(sanitizeError(err));
  }
});

// ─────────────────────────────────────────────
// احراز هویت API عامل محلی
// ─────────────────────────────────────────────

function requireAgentAuth(req, res, next) {
  const key = req.headers['x-api-key'] ?? req.query.api_key;
  if (!key || key !== getAgentApiKey()) {
    return res.status(401).json({ ...fail(new AuthError()).payload });
  }
  next();
}

// ─────────────────────────────────────────────
// وب‌هوک تلگرام
// ─────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const update = req.body;
  if (!update) return;

  try {
    if (update.message) {
      await handleMessage(api, db, update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(api, db, update.callback_query);
    }
  } catch (err) {
    safeError('[Webhook] خطای پردازش:', { error: err.message, stack: err.stack }, req.id);
  }
});

// ─────────────────────────────────────────────
// API عامل محلی
// ─────────────────────────────────────────────

// دریافت یک کار در انتظار
app.get('/api/jobs/next', requireAgentAuth, (req, res) => {
  const job = jobsRepo.findPending()[0] ?? null;
  if (!job) return res.json({ ok: true, job: null });
  res.json({ ok: true, job });
});

// به‌روزرسانی وضعیت کار
app.patch('/api/jobs/:id', requireAgentAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!validateJobId(jobId)) {
    return res.status(400).json({ ...fail(new ValidationError('شناسه کار نامعتبر است.')).payload });
  }

  const { status, error_message } = req.body;

  if (!validateStatus(status, ['PROCESSING', 'COMPLETED', 'FAILED'])) {
    return res.status(400).json({ ...fail(new ValidationError('وضعیت نامعتبر است.')).payload });
  }

  const job = jobsRepo.findById(jobId);
  if (!job) return res.status(404).json({ ...fail(new NotFoundError('کار یافت نشد.')).payload });

  jobsRepo.updateStatus(jobId, status, error_message ?? null);

  if (status === 'COMPLETED' || status === 'FAILED') {
    const user = usersRepo.findById(job.user_id);
    if (user) {
      const taskNameFa = job.task_type === 'SANA' ? 'سانا' : 'گیکا';
      const msg = status === 'COMPLETED'
        ? `✅ درخواست ${taskNameFa} شما (شناسه #${jobId}) با موفقیت ثبت شد!`
        : `❌ متأسفانه درخواست ${taskNameFa} شما (شناسه #${jobId}) ناموفق بود.\n⚠️ دلیل: ${error_message ?? 'نامشخص'}`;
      api.sendMessage({ chat_id: job.user_id, text: msg }).catch(console.error);
    }
  }

  res.json({ ...ok() });
});

// فهرست کارها
app.get('/api/jobs', requireAgentAuth, (req, res) => {
  const { status, limit = 50 } = req.query;
  const parsedLimit = validateLimit(limit, 100);
  const jobs = status
    ? jobsRepo.findByStatus(status, parsedLimit)
    : jobsRepo.findRecent(parsedLimit);
  jobs.forEach(j => { j.payload = fromJSON(j.payload); });
  res.json({ ...ok(jobs) });
});

// ─────────────────────────────────────────────
// داشبورد مدیریتی — HTML فارسی
// ─────────────────────────────────────────────

function requireDashboardAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).send(`
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>ورود — داشبورد کافه الماس</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Vazirmatn','Segoe UI',Tahoma,sans-serif;background:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;direction:rtl}
        .card{background:#1e293b;border-radius:16px;padding:40px;width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
        h2{color:#f1f5f9;font-size:1.4rem;margin-bottom:8px}
        p{color:#94a3b8;font-size:.9rem;margin-bottom:28px}
        form{display:flex;flex-direction:column;gap:12px}
        input{width:100%;padding:12px 16px;background:#0f172a;border:1px solid #334155;border-radius:10px;color:#f1f5f9;font-size:1rem;direction:rtl;outline:none}
        input:focus{border-color:#6366f1}
        button{width:100%;padding:13px;background:#6366f1;border:none;border-radius:10px;color:#fff;font-size:1rem;cursor:pointer;font-family:inherit}
        button:hover{background:#4f46e5}
        .hint{color:#64748b;font-size:.75rem;margin-top:16px}
      </style>
    </head>
    <body>
      <div class="card">
        <h2>🔐 ورود به داشبورد</h2>
        <p>کافه اینترنت الماس</p>
        <form method="post">
          <input name="key" type="password" placeholder="کلید دسترسی را وارد کنید" autofocus required>
          <button type="submit">ورود</button>
        </form>
        <div class="hint">در صورت نیاز، کلید را از مدیر سیستم دریافت کنید.</div>
      </div>
    </body>
    </html>
  `);
}

app.post('/dashboard/login', express.urlencoded({ extended: false }), (req, res) => {
  const key = req.body.key;
  const dashboardKey = getDashboardApiKey() || getAgentApiKey();
  if (!key || key !== dashboardKey) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html lang="fa" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>ورود — داشبورد کافه الماس</title>
        <style>
          *{box-sizing:border-box;margin:0;padding:0}
          body{font-family:'Vazirmatn','Segoe UI',Tahoma,sans-serif;background:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;direction:rtl}
          .card{background:#1e293b;border-radius:16px;padding:40px;width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
          h2{color:#f1f5f9;font-size:1.4rem;margin-bottom:8px}
          p{color:#ef4444;font-size:.9rem;margin-bottom:20px}
          a{color:#6366f1;text-decoration:none}
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🔐 ورود به داشبورد</h2>
          <p>کلید دسترسی نامعتبر است.</p>
          <a href="/dashboard">بازگشت به صفحه ورود</a>
        </div>
      </body>
      </html>
    `);
  }
  const sessionId = generateSessionId();
  sessionStore.set(sessionId, { authenticated: true, createdAt: Date.now() });
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`);
  res.redirect('/dashboard');
});

app.get('/dashboard', requireDashboardAuth, (req, res) => {
  const totalUsers    = usersRepo.count();
  const totalJobs     = jobsRepo.count();
  const pendingJobs   = jobsRepo.countByStatus('PENDING');
  const processingJobs= jobsRepo.countByStatus('PROCESSING');
  const completedJobs = jobsRepo.countByStatus('COMPLETED');
  const failedJobs    = jobsRepo.countByStatus('FAILED');
  const recentJobs    = dbAll(db,
    `SELECT j.*, u.username FROM scraping_jobs j
     LEFT JOIN users u ON u.telegram_id = j.user_id
     ORDER BY j.created_at DESC LIMIT 20`);

  const statusLabel = { PENDING:'در انتظار', PROCESSING:'در حال پردازش', COMPLETED:'تکمیل‌شده', FAILED:'ناموفق' };
  const statusClass = { PENDING:'badge-warn', PROCESSING:'badge-info', COMPLETED:'badge-success', FAILED:'badge-danger' };

  const maskId = (val) => val ? String(val).slice(0, 3) + '***' + String(val).slice(-2) : '—';

  const rowsHtml = recentJobs.map(j => {
    const pl = fromJSON(j.payload);
    const dt = new Date(j.created_at * 1000).toLocaleDateString('fa-IR', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    return `
      <tr>
        <td>#${j.id}</td>
        <td>${j.username ?? j.user_id}</td>
        <td><span class="type-badge">${j.task_type}</span></td>
        <td>${maskId(pl.national_id)}</td>
        <td><span class="badge ${statusClass[j.status] ?? ''}">${statusLabel[j.status] ?? j.status}</span></td>
        <td class="time-col">${dt}</td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>داشبورد مدیریتی — کافه اینترنت الماس</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0f172a;--surface:#1e293b;--surface2:#273347;--border:#334155;
      --text:#f1f5f9;--muted:#94a3b8;--accent:#6366f1;--accent2:#818cf8;
      --green:#22c55e;--yellow:#f59e0b;--red:#ef4444;--blue:#3b82f6;
    }
    body{font-family:'Vazirmatn','Segoe UI',Tahoma,sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh}
    a{color:inherit;text-decoration:none}

    /* هدر */
    header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:62px;position:sticky;top:0;z-index:100}
    .logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem}
    .logo-icon{width:36px;height:36px;background:var(--accent);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
    .header-right{display:flex;align-items:center;gap:16px}
    .live-dot{width:8px;height:8px;background:var(--green);border-radius:50%;animation:blink 1.6s infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    .live-text{font-size:.8rem;color:var(--green)}
    .refresh-btn{padding:7px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--muted);cursor:pointer;font-family:inherit;font-size:.85rem}
    .refresh-btn:hover{color:var(--text);border-color:var(--accent)}

    /* محتوا */
    main{max-width:1200px;margin:0 auto;padding:28px 20px}

    /* کارت‌های آمار */
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px}
    .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:8px;transition:border-color .2s}
    .stat-card:hover{border-color:var(--accent)}
    .stat-title{font-size:.8rem;color:var(--muted);font-weight:500}
    .stat-value{font-size:2rem;font-weight:700;line-height:1}
    .stat-sub{font-size:.75rem;color:var(--muted)}
    .c-total{color:var(--accent2)}
    .c-pending{color:var(--yellow)}
    .c-proc{color:var(--blue)}
    .c-done{color:var(--green)}
    .c-fail{color:var(--red)}
    .c-user{color:#c084fc}

    /* جدول */
    .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
    .section-title{font-size:1rem;font-weight:600}
    .table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}
    table{width:100%;border-collapse:collapse;font-size:.875rem}
    th{padding:13px 16px;text-align:right;font-weight:600;font-size:.78rem;color:var(--muted);background:var(--surface2);border-bottom:1px solid var(--border);white-space:nowrap}
    td{padding:12px 16px;border-bottom:1px solid var(--border);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:var(--surface2)}

    /* نشانه‌ها */
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
    .badge-warn   {background:rgba(245,158,11,.15);color:#fbbf24}
    .badge-info   {background:rgba(59,130,246,.15); color:#60a5fa}
    .badge-success{background:rgba(34,197,94,.15);  color:#4ade80}
    .badge-danger {background:rgba(239,68,68,.15);  color:#f87171}
    .type-badge{background:rgba(99,102,241,.15);color:#a5b4fc;padding:3px 10px;border-radius:6px;font-size:.75rem;font-weight:600;font-family:monospace}
    .time-col{color:var(--muted);font-size:.8rem;white-space:nowrap}

    /* نشانگر خالی */
    .empty{text-align:center;padding:48px;color:var(--muted)}
    .empty-icon{font-size:2.5rem;margin-bottom:12px}

    /* فوتر */
    footer{text-align:center;padding:28px 20px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);margin-top:40px}
  </style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-icon">☕</div>
    <span>کافه اینترنت الماس</span>
  </div>
  <div class="header-right">
    <div class="live-dot"></div>
    <span class="live-text">زنده</span>
    <button class="refresh-btn" onclick="location.reload()">🔄 به‌روزرسانی</button>
  </div>
</header>

<main>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-title">کل درخواست‌ها</div>
      <div class="stat-value c-total">${totalJobs}</div>
      <div class="stat-sub">از ابتدا تا کنون</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">در انتظار</div>
      <div class="stat-value c-pending">${pendingJobs}</div>
      <div class="stat-sub">نیاز به پردازش</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">در حال پردازش</div>
      <div class="stat-value c-proc">${processingJobs}</div>
      <div class="stat-sub">در جریان</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">تکمیل‌شده</div>
      <div class="stat-value c-done">${completedJobs}</div>
      <div class="stat-sub">با موفقیت</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">ناموفق</div>
      <div class="stat-value c-fail">${failedJobs}</div>
      <div class="stat-sub">نیاز به بررسی</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">کاربران ثبت‌شده</div>
      <div class="stat-value c-user">${totalUsers}</div>
      <div class="stat-sub">در ربات</div>
    </div>
  </div>

  <div class="section-header">
    <div class="section-title">📋 آخرین درخواست‌ها (۲۰ مورد)</div>
  </div>

  <div class="table-wrap">
    ${recentJobs.length === 0 ? `
      <div class="empty">
        <div class="empty-icon">📭</div>
        <div>هنوز هیچ درخواستی ثبت نشده است.</div>
      </div>
    ` : `
    <table>
      <thead>
        <tr>
          <th>شناسه</th>
          <th>کاربر</th>
          <th>نوع</th>
          <th>کد ملی</th>
          <th>وضعیت</th>
          <th>تاریخ ثبت</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    `}
  </div>

</main>

<footer>کافه اینترنت الماس &mdash; پنل مدیریت &mdash; نسخه ۱.۰<br>صفحه هر ۳۰ ثانیه به‌طور خودکار به‌روز می‌شود</footer>

</body>
</html>`);
});

// ─────────────────────────────────────────────
// صفحه اصلی / وضعیت سلامت
// ─────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    ok:      true,
    service: 'ربات هوشمند کافه اینترنت الماس',
    version: '1.0.0',
    status:  'در حال اجرا',
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/dashboard/logout', (req, res) => {
  const cookies = parseCookie(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) sessionStore.delete(sessionId);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`);
  res.redirect('/dashboard');
});

// ─────────────────────────────────────────────
// ثبت وب‌هوک و شروع گوش دادن
// ─────────────────────────────────────────────

async function registerWebhook() {
  const base = ENV.APP_URL;
  if (!base) {
    console.warn('[Webhook] متغیر APP_URL تنظیم نشده — وب‌هوک ثبت نشد.');
    return;
  }
  const webhookUrl = `${base.replace(/\/$/, '')}/webhook`;
  try {
    const result = await api.setWebhook({ url: webhookUrl });
    if (result) console.log('[Webhook] با موفقیت ثبت شد:', webhookUrl);
    else        console.warn('[Webhook] ثبت ناموفق بود.');
  } catch (err) {
    safeError('[Webhook] خطا:', { error: err.message });
  }
}

app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`[سرور] در حال اجرا روی پورت ${PORT}`);
  await registerWebhook();
});
