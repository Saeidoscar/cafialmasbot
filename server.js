// ─────────────────────────────────────────────
// server.js — سرور اصلی Express (Render.com & Local Preview)
// Supports:
//   • Service-End Bot (/webhook, /webhook/service)
//   • Manager-End Bot (/webhook/manager)
//   • n8n Automation Bridge (/api/n8n/webhook)
//   • Interactive Dual-Bot Simulator (/demo, /api/simulate)
//   • Management Dashboard (/dashboard)
// ─────────────────────────────────────────────

import 'dotenv/config';
import express        from 'express';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { loadEnv, getAgentApiKey, getDashboardApiKey, ENV } from './src/config/env.js';
import { NotFoundError }                          from './src/errors/AppError.js';
import { errorHandler, AuthError, RateLimitError, ValidationError } from './src/http/error-handler.js';
import { ok, fail }                               from './src/http/response.js';
import { requestIdMiddleware }                    from './src/http/request-id.js';
import { safeError }                              from './src/logging/logger.js';
import { validateStatus, validateLimit, validateJobId } from './src/validation/validators.js';
import { runMigrations }                          from './src/db/migration-runner.js';
import {
  UsersRepository,
  ScrapingJobsRepository,
  LinkedChatsRepository,
  ManagersRepository,
  TimeSlotsRepository,
  SupportTicketsRepository,
} from './src/db/repository.js';

import { getDb, dbAll, fromJSON }                 from './src/lib/db.js';
import { createTelegramAPI }                      from './src/lib/telegram.js';
import { SERVICES_CATALOG, SERVICE_CATEGORIES, TASK_NAME_FA } from './src/lib/services.js';
import { handleMessage }                          from './src/handlers/message.js';
import { handleCallbackQuery }                    from './src/handlers/callback_query.js';
import { handleManagerMessage, handleManagerCallbackQuery } from './src/handlers/manager.js';
import { handleN8nWebhook }                       from './src/handlers/n8n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = Number(process.env.PORT ?? 3000);

// Provide safe development defaults if .env is not yet created
if (!process.env.BOT_TOKEN) process.env.BOT_TOKEN = 'test-service-bot-token';
if (!process.env.MANAGER_BOT_TOKEN) process.env.MANAGER_BOT_TOKEN = process.env.BOT_TOKEN;
if (!process.env.AGENT_API_KEY) process.env.AGENT_API_KEY = 'dev-agent-key-cafialmas-2026';

loadEnv();

const NODE_ENV = ENV.NODE_ENV;
mkdirSync(join(__dirname, 'data'), { recursive: true });

const db          = getDb();
const usersRepo   = new UsersRepository(db);
const jobsRepo    = new ScrapingJobsRepository(db);
const chatsRepo   = new LinkedChatsRepository(db);
const managersRepo = new ManagersRepository(db);
const slotsRepo   = new TimeSlotsRepository(db);
const ticketsRepo = new SupportTicketsRepository(db);

try {
  await runMigrations();
} catch (err) {
  console.error('[Migration] خطای اجرای مهاجره‌ها:', err);
}

// Seed a default active manager and sample time slots if none exist so the system is immediately ready
try {
  if (managersRepo.count() === 0) {
    managersRepo.upsert('9001001', 'ali_expert', 'مهندس علی رضایی (کارشناس ارشد)');
    managersRepo.upsert('9001002', 'sara_admin', 'سارا محمدی (امور مالیاتی و ثنا)');
    slotsRepo.createSlot('9001001', '1405/07/25', '09:00', '10:30', 'ALL', 3);
    slotsRepo.createSlot('9001001', '1405/07/25', '11:00', '12:30', 'ALL', 3);
    slotsRepo.createSlot('9001002', '1405/07/25', '14:00', '16:00', 'ALL', 2);
  }
} catch {}

const customerApi = createTelegramAPI(process.env.BOT_TOKEN);
const managerApi  = createTelegramAPI(process.env.MANAGER_BOT_TOKEN || process.env.BOT_TOKEN);
const app = express();

// ─────────────────────────────────────────────
// استانداردهای امنیتی — میان‌افزارهای سراسری
// ─────────────────────────────────────────────

app.use(express.json({ limit: '25kb' }));
app.use(express.urlencoded({ extended: false, limit: '25kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(requestIdMiddleware);

const rateLimitMap = new Map();
function rateLimit(windowMs = 60000, max = 120) {
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
app.use('/webhook', rateLimit(1000, 30));

const sessionStore = new Map();
const SESSION_COOKIE = 'cafe_dashboard_session';

function parseCookie(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((c) => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[decodeURIComponent(k)] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

app.use((req, res, next) => {
  const cookies = parseCookie(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId && sessionStore.has(sessionId)) {
    req.session = sessionStore.get(sessionId);
  }
  req.session = req.session ?? {};
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function requireAgentAuth(req, res, next) {
  const key = req.headers['x-api-key'] ?? req.query.api_key;
  if (!key || key !== getAgentApiKey()) {
    return res.status(401).json({ ...fail(new AuthError()).payload });
  }
  next();
}

// ─────────────────────────────────────────────
// وب‌هوک‌های تلگرام (Service Bot + Manager Bot)
// ─────────────────────────────────────────────

app.post(['/webhook', '/webhook/service'], async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  try {
    if (update.message) {
      await handleMessage(customerApi, db, update.message, process.env, managerApi);
    } else if (update.callback_query) {
      await handleCallbackQuery(customerApi, db, update.callback_query, process.env, managerApi);
    }
  } catch (err) {
    safeError('[ServiceWebhook] خطا:', { error: err.message, stack: err.stack }, req.id);
  }
});

app.post('/webhook/manager', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  try {
    if (update.message) {
      await handleManagerMessage(managerApi, db, update.message, process.env, customerApi);
    } else if (update.callback_query) {
      await handleManagerCallbackQuery(managerApi, db, update.callback_query, process.env, customerApi);
    }
  } catch (err) {
    safeError('[ManagerWebhook] خطا:', { error: err.message, stack: err.stack }, req.id);
  }
});

// ─────────────────────────────────────────────
// شبیه‌ساز زنده دو ربات (Interactive Dual-Bot Simulator API)
// ─────────────────────────────────────────────

app.post('/api/simulate', async (req, res) => {
  const {
    bot = 'service', // 'service' | 'manager'
    type = 'message', // 'message' | 'callback_query'
    text = '/start',
    data = '',
    user_id = bot === 'manager' ? '9001001' : '1002003',
    username = bot === 'manager' ? 'ali_expert' : 'moshtari_1',
    first_name = bot === 'manager' ? 'مهندس علی رضایی' : 'رضا محمدی',
  } = req.body ?? {};

  const customerOutbox = [];
  const managerOutbox  = [];

  const captureCustomerApi = {
    sendMessage: async (p) => { customerOutbox.push({ method: 'sendMessage', ...p }); return { message_id: Date.now() }; },
    editMessageText: async (p) => { customerOutbox.push({ method: 'editMessageText', ...p }); return { message_id: p.message_id || Date.now() }; },
    answerCallbackQuery: async (p) => { if (p.text) customerOutbox.push({ method: 'toast', text: p.text }); return true; },
    getChatMember: async () => ({ status: 'creator' }),
    getChat: async () => ({ title: 'گروه کافه الماس' }),
  };

  const captureManagerApi = {
    sendMessage: async (p) => { managerOutbox.push({ method: 'sendMessage', ...p }); return { message_id: Date.now() }; },
    editMessageText: async (p) => { managerOutbox.push({ method: 'editMessageText', ...p }); return { message_id: p.message_id || Date.now() }; },
    answerCallbackQuery: async (p) => { if (p.text) managerOutbox.push({ method: 'toast', text: p.text }); return true; },
  };

  const fromObj = { id: Number(user_id), username, first_name };
  const chatObj = { id: Number(user_id), type: 'private' };

  try {
    if (bot === 'manager') {
      if (type === 'callback_query') {
        await handleManagerCallbackQuery(
          captureManagerApi,
          db,
          { id: 'cq_' + Date.now(), from: fromObj, message: { chat: chatObj, message_id: 1 }, data },
          process.env,
          captureCustomerApi
        );
      } else {
        const handled = await handleManagerMessage(
          captureManagerApi,
          db,
          { message_id: Date.now(), from: fromObj, chat: chatObj, text },
          process.env,
          captureCustomerApi
        );
        if (!handled) {
          await handleMessage(
            captureManagerApi,
            db,
            { message_id: Date.now(), from: fromObj, chat: chatObj, text },
            process.env,
            captureManagerApi
          );
        }
      }
    } else {
      if (type === 'callback_query') {
        await handleCallbackQuery(
          captureCustomerApi,
          db,
          { id: 'cq_' + Date.now(), from: fromObj, message: { chat: chatObj, message_id: 1 }, data },
          process.env,
          captureManagerApi
        );
      } else {
        await handleMessage(
          captureCustomerApi,
          db,
          { message_id: Date.now(), from: fromObj, chat: chatObj, text },
          process.env,
          captureManagerApi
        );
      }
    }

    res.json({
      ok: true,
      customer_messages: customerOutbox,
      manager_messages: managerOutbox,
      stats: {
        total_jobs: jobsRepo.count(),
        pending: jobsRepo.countByStatus('PENDING'),
        processing: jobsRepo.countByStatus('PROCESSING'),
        completed: jobsRepo.countByStatus('COMPLETED'),
        failed: jobsRepo.countByStatus('FAILED'),
        managers: managersRepo.listAll(),
        open_slots: slotsRepo.listOpenSlots('ALL', 20),
        recent_jobs: jobsRepo.findRecent(10),
        open_tickets: ticketsRepo.listOpen(10),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// API عمومی وضعیت و کاتالوگ سرویس‌ها
// ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    bots: ['service_end_bot', 'manager_end_bot'],
    services_count: Object.keys(SERVICES_CATALOG).length,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/services', (req, res) => {
  res.json({
    ok: true,
    categories: Object.values(SERVICE_CATEGORIES),
    services: Object.values(SERVICES_CATALOG),
  });
});

app.get('/api/overview', (req, res) => {
  res.json({
    ok: true,
    stats: {
      total_users: usersRepo.count(),
      total_jobs: jobsRepo.count(),
      pending: jobsRepo.countByStatus('PENDING'),
      processing: jobsRepo.countByStatus('PROCESSING'),
      completed: jobsRepo.countByStatus('COMPLETED'),
      failed: jobsRepo.countByStatus('FAILED'),
      total_managers: managersRepo.count(),
    },
    managers: managersRepo.listAll(),
    slots: slotsRepo.listOpenSlots('ALL', 25),
    jobs: jobsRepo.findRecent(15),
    tickets: ticketsRepo.listOpen(15),
  });
});

// ─────────────────────────────────────────────
// API محافظت‌شده (n8n، عامل Playwright، مدیران)
// ─────────────────────────────────────────────

app.post('/api/n8n/webhook', requireAgentAuth, async (req, res) => {
  const result = await handleN8nWebhook(req.body, db, customerApi, managerApi);
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/managers', requireAgentAuth, (req, res) => {
  res.json({ ok: true, managers: managersRepo.listAll() });
});

app.post('/api/managers', requireAgentAuth, (req, res) => {
  const { telegram_id, username, display_name, services_offered } = req.body ?? {};
  if (!telegram_id) {
    return res.status(400).json({ ...fail(new ValidationError('telegram_id الزامی است.')).payload });
  }
  const mgr = managersRepo.upsert(String(telegram_id), username, display_name, services_offered);
  res.json({ ok: true, manager: mgr });
});

app.get('/api/slots', requireAgentAuth, (req, res) => {
  const service = req.query.service ?? 'ALL';
  res.json({ ok: true, slots: slotsRepo.listOpenSlots(service, 50) });
});

app.post('/api/slots', requireAgentAuth, (req, res) => {
  const { manager_id, slot_date, start_time, end_time, service_type = 'ALL', capacity = 1 } = req.body ?? {};
  if (!manager_id || !slot_date || !start_time || !end_time) {
    return res.status(400).json({ ...fail(new ValidationError('فیلدهای نوبت ناقص است.')).payload });
  }
  const slot = slotsRepo.createSlot(manager_id, slot_date, start_time, end_time, service_type, capacity);
  res.json({ ok: true, slot });
});

app.get('/api/tickets', requireAgentAuth, (req, res) => {
  res.json({ ok: true, tickets: ticketsRepo.listOpen(30) });
});

// دریافت یک کار در انتظار
app.get('/api/jobs/next', requireAgentAuth, (req, res) => {
  const job = jobsRepo.findPending()[0] ?? null;
  res.json({ ok: true, job });
});

// فهرست کارها
app.get('/api/jobs', requireAgentAuth, (req, res) => {
  const { status, limit = 50 } = req.query;
  const parsedLimit = validateLimit(limit, 100);
  const jobs = status
    ? jobsRepo.findByStatus(status, parsedLimit)
    : jobsRepo.findRecent(parsedLimit);
  res.json({ ...ok(jobs), jobs });
});

// Claim job (used by local_agent/scraper.js)
app.post('/api/jobs/:id/claim', requireAgentAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!validateJobId(jobId)) {
    return res.status(400).json({ ...fail(new ValidationError('شناسه کار نامعتبر است.')).payload });
  }
  const claimed = jobsRepo.claim(jobId, req.body?.manager_id ?? null);
  if (!claimed) {
    return res.status(409).json({ ok: false, error: 'کار قبلاً دریافت شده یا در دسترس نیست.' });
  }
  res.json({ ok: true, message: 'کار دریافت شد.', job_id: jobId });
});

// Complete job (used by local_agent/scraper.js & n8n)
app.post('/api/jobs/:id/complete', requireAgentAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!validateJobId(jobId)) {
    return res.status(400).json({ ...fail(new ValidationError('شناسه کار نامعتبر است.')).payload });
  }
  const job = jobsRepo.findById(jobId);
  if (!job) return res.status(404).json({ ...fail(new NotFoundError('کار یافت نشد.')).payload });

  const summary = req.body?.result_text ?? 'ثبت در سامانه با موفقیت انجام شد.';
  jobsRepo.complete(jobId, { summary, completed_at: new Date().toISOString() });

  const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
  customerApi.sendMessage({
    chat_id: job.user_id,
    text: `✅ درخواست ${taskNameFa} شما (شناسه #${jobId}) با موفقیت ثبت شد!\n📋 نتیجه: ${summary}`,
  }).catch(() => {});

  res.json({ ok: true, message: 'کار تکمیل شد.', job_id: jobId });
});

// Fail job (used by local_agent/scraper.js & n8n)
app.post('/api/jobs/:id/fail', requireAgentAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!validateJobId(jobId)) {
    return res.status(400).json({ ...fail(new ValidationError('شناسه کار نامعتبر است.')).payload });
  }
  const job = jobsRepo.findById(jobId);
  if (!job) return res.status(404).json({ ...fail(new NotFoundError('کار یافت نشد.')).payload });

  const errMsg = req.body?.error_message ?? 'خطای ناشناخته';
  jobsRepo.fail(jobId, errMsg);

  const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
  customerApi.sendMessage({
    chat_id: job.user_id,
    text: `❌ متأسفانه درخواست ${taskNameFa} شما (شناسه #${jobId}) ناموفق بود.\n⚠️ دلیل: ${errMsg}`,
  }).catch(() => {});

  res.json({ ok: true, message: 'کار ناموفق ثبت شد.', job_id: jobId });
});

// به‌روزرسانی وضعیت کار (PATCH)
app.patch('/api/jobs/:id', requireAgentAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!validateJobId(jobId)) {
    return res.status(400).json({ ...fail(new ValidationError('شناسه کار نامعتبر است.')).payload });
  }

  const { status, error_message, result_text } = req.body;
  if (!validateStatus(status, ['PROCESSING', 'COMPLETED', 'FAILED'])) {
    return res.status(400).json({ ...fail(new ValidationError('وضعیت نامعتبر است.')).payload });
  }

  const job = jobsRepo.findById(jobId);
  if (!job) return res.status(404).json({ ...fail(new NotFoundError('کار یافت نشد.')).payload });

  if (status === 'COMPLETED' && result_text) {
    jobsRepo.complete(jobId, { summary: result_text, completed_at: new Date().toISOString() });
  } else {
    jobsRepo.updateStatus(jobId, status, error_message ?? null);
  }

  if (status === 'COMPLETED' || status === 'FAILED') {
    const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
    const msg = status === 'COMPLETED'
      ? `✅ درخواست ${taskNameFa} شما (شناسه #${jobId}) با موفقیت ثبت شد!${result_text ? `\n📋 نتیجه: ${result_text}` : ''}`
      : `❌ متأسفانه درخواست ${taskNameFa} شما (شناسه #${jobId}) ناموفق بود.\n⚠️ دلیل: ${error_message ?? 'نامشخص'}`;
    customerApi.sendMessage({ chat_id: job.user_id, text: msg }).catch(() => {});
  }

  res.json({ ...ok() });
});

// ─────────────────────────────────────────────
// صفحات وب: شبیه‌ساز تعاملی دو ربات (/) و داشبورد (/dashboard)
// ─────────────────────────────────────────────

app.get(['/', '/demo'], (req, res) => {
  const demoPath = join(__dirname, 'demo.html');
  if (existsSync(demoPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(readFileSync(demoPath, 'utf8'));
  }
  res.json({
    ok: true,
    service: 'سامانه هوشمند دوگانه کافه الماس (Service Bot + Manager Bot)',
    version: '2.0.0',
  });
});

app.get('/dashboard', (req, res) => {
  const totalUsers     = usersRepo.count();
  const totalJobs      = jobsRepo.count();
  const pendingJobs    = jobsRepo.countByStatus('PENDING');
  const processingJobs = jobsRepo.countByStatus('PROCESSING');
  const completedJobs  = jobsRepo.countByStatus('COMPLETED');
  const failedJobs     = jobsRepo.countByStatus('FAILED');
  const managers       = managersRepo.listAll();
  const openSlots      = slotsRepo.listOpenSlots('ALL', 20);
  const openTickets    = ticketsRepo.listOpen(20);
  const recentJobs     = dbAll(
    db,
    `SELECT j.*, u.username FROM scraping_jobs j
     LEFT JOIN users u ON u.telegram_id = j.user_id
     ORDER BY j.created_at DESC LIMIT 20`
  );

  const statusLabel = { PENDING: 'در انتظار', PROCESSING: 'در حال پردازش', COMPLETED: 'تکمیل‌شده', FAILED: 'ناموفق' };
  const statusClass = { PENDING: 'badge-warn', PROCESSING: 'badge-info', COMPLETED: 'badge-success', FAILED: 'badge-danger' };
  const maskId = (val) => (val ? String(val).slice(0, 3) + '***' + String(val).slice(-2) : '—');

  const rowsHtml = recentJobs.map((j) => {
    const pl = fromJSON(j.payload);
    const resData = fromJSON(j.result_data);
    const dt = new Date(j.created_at * 1000).toLocaleDateString('fa-IR', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return `
      <tr>
        <td>#${j.id}</td>
        <td>${j.username ?? j.user_id}</td>
        <td><span class="type-badge">${TASK_NAME_FA[j.task_type] ?? j.task_type}</span></td>
        <td>${maskId(pl.national_id)}</td>
        <td>${j.assigned_manager_id ?? 'صف عمومی'}</td>
        <td><span class="badge ${statusClass[j.status] ?? ''}">${statusLabel[j.status] ?? j.status}</span></td>
        <td>${resData?.summary ? String(resData.summary).slice(0, 40) : '—'}</td>
        <td class="time-col">${dt}</td>
      </tr>`;
  }).join('');

  const mgrRowsHtml = managers.map((m) => {
    const avg = m.rating_count > 0 ? (m.rating_sum / m.rating_count).toFixed(1) + ' ⭐' : 'جدید';
    const wh = m.working_hours ?? { start: '08:00', end: '20:00' };
    return `
      <tr>
        <td><b>${m.display_name}</b></td>
        <td><code>${m.telegram_id}</code></td>
        <td>${m.is_active ? '<span class="badge badge-success">🟢 آنلاین</span>' : '<span class="badge badge-danger">🔴 آفلاین</span>'}</td>
        <td>${wh.start} تا ${wh.end}</td>
        <td>${(m.services_offered ?? []).length} سرویس</td>
        <td>${m.completed_count ?? 0}</td>
        <td>${avg}</td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>داشبورد مدیریتی — سامانه دوگانه کافه الماس</title>
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
    header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:62px;position:sticky;top:0;z-index:100}
    .logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem}
    .logo-icon{width:36px;height:36px;background:var(--accent);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
    .header-right{display:flex;align-items:center;gap:12px}
    .refresh-btn{padding:7px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-family:inherit;font-size:.82rem}
    .refresh-btn:hover{border-color:var(--accent)}
    main{max-width:1240px;margin:0 auto;padding:28px 20px}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
    .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:6px}
    .stat-title{font-size:.78rem;color:var(--muted);font-weight:500}
    .stat-value{font-size:1.85rem;font-weight:700;line-height:1}
    .stat-sub{font-size:.72rem;color:var(--muted)}
    .c-total{color:var(--accent2)}.c-pending{color:var(--yellow)}.c-proc{color:var(--blue)}.c-done{color:var(--green)}.c-fail{color:var(--red)}.c-user{color:#c084fc}
    .section-header{display:flex;align-items:center;justify-content:space-between;margin:24px 0 12px}
    .section-title{font-size:1rem;font-weight:600}
    .table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow-x:auto;margin-bottom:24px}
    table{width:100%;border-collapse:collapse;font-size:.85rem}
    th{padding:12px 14px;text-align:right;font-weight:600;font-size:.76rem;color:var(--muted);background:var(--surface2);border-bottom:1px solid var(--border);white-space:nowrap}
    td{padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.73rem;font-weight:600}
    .badge-warn{background:rgba(245,158,11,.15);color:#fbbf24}
    .badge-info{background:rgba(59,130,246,.15);color:#60a5fa}
    .badge-success{background:rgba(34,197,94,.15);color:#4ade80}
    .badge-danger{background:rgba(239,68,68,.15);color:#f87171}
    .type-badge{background:rgba(99,102,241,.15);color:#a5b4fc;padding:3px 10px;border-radius:6px;font-size:.75rem;font-weight:600}
    .time-col{color:var(--muted);font-size:.78rem;white-space:nowrap}
    footer{text-align:center;padding:24px 20px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);margin-top:30px}
  </style>
</head>
<body>
<header>
  <div class="logo">
    <div class="logo-icon">☕</div>
    <span>کافه اینترنت الماس — مرکز کنترل دو ربات (مشتری و مدیر)</span>
  </div>
  <div class="header-right">
    <a href="/demo" class="refresh-btn" style="background:#6366f1;color:#fff;border-color:#6366f1">🤖 شبیه‌ساز زنده دو ربات</a>
    <button class="refresh-btn" onclick="location.reload()">🔄 به‌روزرسانی</button>
  </div>
</header>
<main>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-title">کل درخواست‌ها</div><div class="stat-value c-total">${totalJobs}</div><div class="stat-sub">۹ سرویس دولتی</div></div>
    <div class="stat-card"><div class="stat-title">در انتظار</div><div class="stat-value c-pending">${pendingJobs}</div><div class="stat-sub">صف کارشناسان</div></div>
    <div class="stat-card"><div class="stat-title">در حال انجام</div><div class="stat-value c-proc">${processingJobs}</div><div class="stat-sub">توسط مدیران</div></div>
    <div class="stat-card"><div class="stat-title">تکمیل‌شده</div><div class="stat-value c-done">${completedJobs}</div><div class="stat-sub">تحویل نتیجه</div></div>
    <div class="stat-card"><div class="stat-title">کارشناسان فعال</div><div class="stat-value c-user">${managers.length}</div><div class="stat-sub">Manager Bot</div></div>
    <div class="stat-card"><div class="stat-title">نوبت‌های باز</div><div class="stat-value c-done">${openSlots.length}</div><div class="stat-sub">رزرو زمانی</div></div>
    <div class="stat-card"><div class="stat-title">تیکت‌های پشتیبانی</div><div class="stat-value c-pending">${openTickets.length}</div><div class="stat-sub">ارتباط دوطرفه</div></div>
    <div class="stat-card"><div class="stat-title">مشتریان</div><div class="stat-value c-user">${totalUsers}</div><div class="stat-sub">Service Bot</div></div>
  </div>

  <div class="section-header">
    <div class="section-title">👨‍💼 کارشناسان و مدیران خدمات (Manager-End Bot)</div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>نام کارشناس</th><th>شناسه تلگرام</th><th>وضعیت</th><th>ساعت کاری</th><th>پوشش خدمات</th><th>تکمیل‌شده</th><th>امتیاز</th></tr></thead>
      <tbody>${mgrRowsHtml || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">هنوز کارشناسی ثبت نشده است</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section-header">
    <div class="section-title">📋 آخرین درخواست‌های سرویس مشتریان (Service-End Bot)</div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>شناسه</th><th>مشتری</th><th>سرویس</th><th>کد ملی</th><th>کارشناس</th><th>وضعیت</th><th>نتیجه</th><th>تاریخ</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--muted)">هنوز درخواستی ثبت نشده است</td></tr>'}</tbody>
    </table>
  </div>
</main>
<footer>کافه اینترنت الماس &mdash; معماری Serverless دو ربات (Service Bot + Manager Bot + n8n Workflows)</footer>
</body>
</html>`);
});

async function registerWebhook() {
  const base = ENV.APP_URL;
  if (!base) return;
  const cleanBase = base.replace(/\/$/, '');
  try {
    await customerApi.setWebhook({ url: `${cleanBase}/webhook` });
    if (process.env.MANAGER_BOT_TOKEN && process.env.MANAGER_BOT_TOKEN !== process.env.BOT_TOKEN) {
      await managerApi.setWebhook({ url: `${cleanBase}/webhook/manager` });
    }
  } catch (err) {
    safeError('[Webhook] خطا:', { error: err.message });
  }
}

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[سرور] در حال اجرا روی http://0.0.0.0:${PORT}`);
  await registerWebhook();
});
