// ─────────────────────────────────────────────
// src/index.js — Serverless Cloudflare Workers Entry Point
// Supports:
//   • Service-End Bot (/webhook, /webhook/service)
//   • Manager-End Bot (/webhook/manager)
//   • n8n Automation Bridge (/api/n8n/webhook)
//   • Local Playwright Agent & Admin REST API (/api/*)
//   • Scheduled Cron Routines (scheduled handler)
// ─────────────────────────────────────────────

import { createTelegramAPI }                     from './lib/telegram.js';
import { handleMessage }                         from './handlers/message.js';
import { handleCallbackQuery }                   from './handlers/callback_query.js';
import { handleManagerMessage, handleManagerCallbackQuery } from './handlers/manager.js';
import { handleN8nWebhook }                      from './handlers/n8n.js';
import { SCHEMA_SQL, SCHEMA_ALTER_STATEMENTS }   from './db/schema.js';
import { SERVICES_CATALOG, SERVICE_CATEGORIES, TASK_NAME_FA } from './lib/services.js';
import {
  ManagersRepository,
  TimeSlotsRepository,
  ScrapingJobsRepository,
  SupportTicketsRepository,
} from './db/repository.js';

async function ensureSchema(db) {
  try {
    for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(stmt).run();
    }
    for (const alter of SCHEMA_ALTER_STATEMENTS) {
      try { await db.prepare(alter).run(); } catch {}
    }
  } catch (err) {
    console.error('[Schema] خطا:', err.message);
  }
}

// ── محدودیت نرخ (Rate Limit) ─────────────────
const rateLimitMap = new Map();
function checkRateLimit(key, windowMs = 60000, max = 60) {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  if (!record || now - record.ts > windowMs) {
    rateLimitMap.set(key, { ts: now, count: 1 });
    return true;
  } else if (record.count >= max) {
    return false;
  } else {
    record.count++;
    return true;
  }
}

// ── هدرهای امنیتی ──────────────────────────────
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
  };
}

// ── داشبورد HTML ────────────────────────────────
function buildDashboard(stats, jobs, managers = [], slots = [], tickets = []) {
  const sl = { PENDING: 'در انتظار', PROCESSING: 'در پردازش', COMPLETED: 'تکمیل‌شده', FAILED: 'ناموفق' };
  const sc = { PENDING: '#f59e0b',   PROCESSING: '#3b82f6',   COMPLETED: '#10b981',    FAILED: '#ef4444' };
  const sb = { PENDING: '#fffbeb',   PROCESSING: '#eff6ff',   COMPLETED: '#ecfdf5',    FAILED: '#fef2f2' };

  const rows = jobs.map((j) => {
    const d = j.created_at ? new Date(j.created_at * 1000).toISOString().substring(0, 16).replace('T', ' ') : '—';
    return `<tr>
      <td>#${j.id}</td>
      <td><span class="badge" style="background:${sb[j.status] ?? '#f9fafb'};color:${sc[j.status] ?? '#6b7280'};border:1px solid ${sc[j.status] ?? '#6b7280'}">${TASK_NAME_FA[j.task_type] ?? j.task_type}</span></td>
      <td>${j.user_id}</td>
      <td>${j.assigned_manager_id ?? 'صف عمومی'}</td>
      <td><span class="badge" style="background:${sb[j.status] ?? '#f9fafb'};color:${sc[j.status] ?? '#6b7280'};border:1px solid ${sc[j.status] ?? '#6b7280'}">${sl[j.status] ?? j.status}</span></td>
      <td dir="ltr" style="font-family:monospace;font-size:12px">${d}</td>
    </tr>`;
  }).join('');

  const mgrRows = managers.map((m) => `<tr>
    <td>${m.display_name}</td>
    <td><code>${m.telegram_id}</code></td>
    <td>${m.is_active ? '🟢 آنلاین' : '🔴 آفلاین'}</td>
    <td>${m.completed_count ?? 0}</td>
    <td>${m.rating_count ? (m.rating_sum / m.rating_count).toFixed(1) + ' ⭐' : 'جدید'}</td>
  </tr>`).join('');

  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>داشبورد کافه هوشمند الماس — ربات مشتری و مدیر</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Vazirmatn',Tahoma,sans-serif;background:#f1f5f9;color:#1e293b;font-size:14px;direction:rtl}
header{background:#1e293b;color:#f8fafc;padding:0 32px;height:60px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.brand{font-size:16px;font-weight:700}.brand span{color:#38bdf8}
.meta{font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:16px}
.pulse{width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block}
main{max-width:1150px;margin:0 auto;padding:28px 20px 60px}
h2{font-size:18px;font-weight:600;color:#0f172a;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:6px}
.lbl{font-size:12px;color:#64748b;font-weight:500}.val{font-size:28px;font-weight:700;line-height:1.1}.sub{font-size:11px;color:#94a3b8}
.c-blue{color:#3b82f6}.c-amber{color:#f59e0b}.c-green{color:#10b981}.c-red{color:#ef4444}.c-purple{color:#8b5cf6}
.tcard{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:24px}
.thead{padding:14px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}
.thead h3{font-size:14px;font-weight:600}
table{width:100%;border-collapse:collapse}
thead th{background:#f8fafc;padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;text-align:right;border-bottom:1px solid #e2e8f0}
tbody td{padding:11px 14px;border-bottom:1px solid #f1f5f9;color:#334155}
.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
footer{text-align:center;padding:20px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}
</style></head><body>
<header>
  <div class="brand">کافه هوشمند الماس <span>|</span> سامانه دوگانه مشتری و مدیر (Serverless)</div>
  <div class="meta"><span><span class="pulse"></span> آنلاین</span></div>
</header>
<main>
  <h2>نمای کلی اکوسیستم دو ربات (Service Bot + Manager Bot)</h2>
  <div class="grid">
    <div class="card"><div class="lbl">کل مشتریان</div><div class="val c-blue">${stats.total_users}</div><div class="sub">ربات خدمات</div></div>
    <div class="card"><div class="lbl">کارشناسان (Managers)</div><div class="val c-purple">${stats.total_managers ?? managers.length}</div><div class="sub">ربات مدیران</div></div>
    <div class="card"><div class="lbl">نوبت‌های باز</div><div class="val c-green">${stats.open_slots ?? slots.length}</div><div class="sub">قابل رزرو</div></div>
    <div class="card"><div class="lbl">در انتظار</div><div class="val c-amber">${stats.pending}</div><div class="sub">صف سرویس</div></div>
    <div class="card"><div class="lbl">در حال انجام</div><div class="val c-blue">${stats.processing}</div><div class="sub">توسط کارشناس</div></div>
    <div class="card"><div class="lbl">تکمیل‌شده</div><div class="val c-green">${stats.completed}</div><div class="sub">تحویل نتیجه</div></div>
    <div class="card"><div class="lbl">تیکت‌های باز</div><div class="val c-red">${stats.open_tickets ?? tickets.length}</div><div class="sub">پشتیبانی</div></div>
  </div>
  <div class="tcard">
    <div class="thead"><h3>👨‍💼 کارشناسان و ارائه‌دهندگان خدمات (Managers)</h3></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>نام کارشناس</th><th>شناسه تلگرام</th><th>وضعیت</th><th>تکمیل‌شده</th><th>امتیاز</th></tr></thead>
      <tbody>${mgrRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">هنوز کارشناسی ثبت نشده است</td></tr>'}</tbody>
    </table></div>
  </div>
  <div class="tcard">
    <div class="thead"><h3>📋 آخرین درخواست‌های مشتریان (۹ سرویس)</h3></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>شناسه</th><th>سرویس</th><th>مشتری</th><th>کارشناس مسئول</th><th>وضعیت</th><th>زمان ثبت</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">هیچ کاری ثبت نشده است</td></tr>'}</tbody>
    </table></div>
  </div>
</main>
<footer>سامانه Serverless کافه الماس · پشتیبانی از Cloudflare Workers D1 + Express + n8n Workflows</footer>
</body></html>`;
}

// ── هندلر اصلی Cloudflare Workers ──────────────
export default {
  async fetch(request, env) {
    const db          = env.DB;
    const customerApi = createTelegramAPI(env.BOT_TOKEN);
    const managerApi  = createTelegramAPI(env.MANAGER_BOT_TOKEN || env.BOT_TOKEN);
    const url         = new URL(request.url);
    const ip          = request.headers.get('cf-connecting-ip') ?? 'unknown';

    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ error: 'تعداد درخواست‌ها بیش از حد مجاز است.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...securityHeaders() },
      });
    }

    const corsHeaders = {
      ...securityHeaders(),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── Schema init ──────────────────────────────
    await ensureSchema(db);

    const managersRepo = new ManagersRepository(db);
    const slotsRepo    = new TimeSlotsRepository(db);
    const jobsRepo     = new ScrapingJobsRepository(db);
    const ticketsRepo  = new SupportTicketsRepository(db);

    // ── داشبورد ──────────────────────────────────
    if (url.pathname === '/dashboard' && request.method === 'GET') {
      const [users, jobs, pending, processing, completed, failed, managers, slots, tickets] = await Promise.all([
        db.prepare('SELECT COUNT(*) as n FROM users').first(),
        db.prepare('SELECT COUNT(*) as n FROM scraping_jobs').first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='PENDING'").first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='PROCESSING'").first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='COMPLETED'").first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='FAILED'").first(),
        managersRepo.listAll(),
        slotsRepo.listOpenSlots('ALL', 20),
        ticketsRepo.listOpen(20),
      ]);
      const recentJobs = await db.prepare(
        'SELECT * FROM scraping_jobs ORDER BY created_at DESC LIMIT 20'
      ).all();
      const stats = {
        total_users: users?.n ?? 0,
        total_jobs: jobs?.n ?? 0,
        pending: pending?.n ?? 0,
        processing: processing?.n ?? 0,
        completed: completed?.n ?? 0,
        failed: failed?.n ?? 0,
        total_managers: managers.length,
        open_slots: slots.length,
        open_tickets: tickets.length,
      };
      return new Response(buildDashboard(stats, recentJobs.results ?? [], managers, slots, tickets), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // ── REST API برای عامل محلی، n8n و پنل مدیریت ──
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            bots: ['service_end_bot', 'manager_end_bot'],
            services_count: Object.keys(SERVICES_CATALOG).length,
            timestamp: new Date().toISOString(),
          }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      if (url.pathname === '/api/services' && request.method === 'GET') {
        return new Response(
          JSON.stringify({
            ok: true,
            categories: Object.values(SERVICE_CATEGORIES),
            services: Object.values(SERVICES_CATALOG),
          }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      const providedKey = request.headers.get('x-api-key');
      if (!providedKey || providedKey !== env.AGENT_API_KEY) {
        return new Response(JSON.stringify({ error: 'احراز هویت ناموفق' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ── n8n Webhook Endpoint ──
      if (url.pathname === '/api/n8n/webhook' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const result = await handleN8nWebhook(body, db, customerApi, managerApi);
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ── Managers API ──
      if (url.pathname === '/api/managers' && request.method === 'GET') {
        const list = await managersRepo.listAll();
        return new Response(JSON.stringify({ ok: true, managers: list }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (url.pathname === '/api/managers' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const mgr = await managersRepo.upsert(
          String(body.telegram_id),
          body.username ?? 'manager',
          body.display_name ?? 'کارشناس',
          body.services_offered
        );
        return new Response(JSON.stringify({ ok: true, manager: mgr }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ── Time Slots API ──
      if (url.pathname === '/api/slots' && request.method === 'GET') {
        const serviceType = url.searchParams.get('service') ?? 'ALL';
        const slots = await slotsRepo.listOpenSlots(serviceType, 30);
        return new Response(JSON.stringify({ ok: true, slots }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (url.pathname === '/api/slots' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const slot = await slotsRepo.createSlot(
          String(body.manager_id),
          body.slot_date,
          body.start_time,
          body.end_time,
          body.service_type ?? 'ALL',
          body.capacity ?? 1
        );
        return new Response(JSON.stringify({ ok: true, slot }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ── Support Tickets API ──
      if (url.pathname === '/api/tickets' && request.method === 'GET') {
        const tickets = await ticketsRepo.listOpen(30);
        return new Response(JSON.stringify({ ok: true, tickets }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ── Scraping Jobs API ──
      if (url.pathname === '/api/jobs' && request.method === 'GET') {
        const status = url.searchParams.get('status') ?? 'PENDING';
        const rawLimit = parseInt(url.searchParams.get('limit') ?? '5');
        const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 5;
        const rows = await db.prepare(
          'SELECT * FROM scraping_jobs WHERE status=? ORDER BY created_at ASC LIMIT ?'
        ).bind(status, limit).all();
        return new Response(JSON.stringify({ jobs: rows.results ?? [] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const claimMatch = url.pathname.match(/^\/api\/jobs\/(\d+)\/claim$/);
      if (claimMatch && request.method === 'POST') {
        const jobId = parseInt(claimMatch[1]);
        const claimed = await jobsRepo.claim(jobId);
        if (!claimed) {
          return new Response(JSON.stringify({ error: 'کار در دسترس نیست' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return new Response(JSON.stringify({ message: 'کار دریافت شد.', job_id: claimMatch[1] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const completeMatch = url.pathname.match(/^\/api\/jobs\/(\d+)\/complete$/);
      if (completeMatch && request.method === 'POST') {
        const jobId = parseInt(completeMatch[1]);
        const body = await request.json().catch(() => ({}));
        const job = await jobsRepo.findById(jobId);
        await jobsRepo.complete(jobId, {
          summary: body.result_text ?? 'انجام شد',
          completed_at: new Date().toISOString(),
        });
        if (job) {
          const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
          await customerApi.sendMessage({
            chat_id: job.user_id,
            text: `✅ درخواست ${taskNameFa} (#${jobId}) با موفقیت ثبت و تکمیل شد!\n${body.result_text ? `\n📋 نتیجه: ${body.result_text}` : ''}`,
          }).catch(() => {});
        }
        return new Response(JSON.stringify({ message: 'کار تکمیل شد.', job_id: completeMatch[1] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const failMatch = url.pathname.match(/^\/api\/jobs\/(\d+)\/fail$/);
      if (failMatch && request.method === 'POST') {
        const jobId = parseInt(failMatch[1]);
        const body = await request.json().catch(() => ({}));
        const errMsg = typeof body?.error_message === 'string' ? body.error_message : 'خطای ناشناخته';
        const job = await jobsRepo.findById(jobId);
        await jobsRepo.fail(jobId, errMsg);
        if (job) {
          const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
          await customerApi.sendMessage({
            chat_id: job.user_id,
            text: `❌ درخواست ${taskNameFa} (#${jobId}) ناموفق بود.\n⚠️ علت: ${errMsg}`,
          }).catch(() => {});
        }
        return new Response(JSON.stringify({ message: 'کار ناموفق ثبت شد.', job_id: failMatch[1] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ error: 'مسیر یافت نشد' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ── Webhook ربات مدیران (Manager-End Bot) ────
    if (url.pathname === '/webhook/manager' && request.method === 'POST') {
      let update;
      try {
        const text = await request.text();
        if (!text || text.length > 10240) {
          return new Response('Bad Request', { status: 400, headers: corsHeaders });
        }
        update = JSON.parse(text);
      } catch {
        return new Response('Bad Request', { status: 400, headers: corsHeaders });
      }

      try {
        if (update.message) {
          await handleManagerMessage(managerApi, db, update.message, env, customerApi);
        } else if (update.callback_query) {
          await handleManagerCallbackQuery(managerApi, db, update.callback_query, env, customerApi);
        }
      } catch (err) {
        console.error('[ManagerWorker] خطا:', err);
      }

      return new Response('OK', { headers: corsHeaders });
    }

    // ── Webhook ربات خدمات مشتریان (Service-End Bot) ──
    if ((url.pathname === '/webhook' || url.pathname === '/webhook/service') && request.method === 'POST') {
      let update;
      try {
        const text = await request.text();
        if (!text || text.length > 10240) {
          return new Response('Bad Request', { status: 400, headers: corsHeaders });
        }
        update = JSON.parse(text);
      } catch {
        return new Response('Bad Request', { status: 400, headers: corsHeaders });
      }

      try {
        if (update.message) {
          await handleMessage(customerApi, db, update.message, env, managerApi);
        } else if (update.callback_query) {
          await handleCallbackQuery(customerApi, db, update.callback_query, env, managerApi);
        }
      } catch (err) {
        console.error('[ServiceWorker] خطای کلی:', err);
      }

      return new Response('OK', { headers: corsHeaders });
    }

    // ── صفحه اصلی ────────────────────────────────
    if (url.pathname === '/') {
      return new Response(
        '🤖 سامانه هوشمند دوگانه کافه الماس (Service Bot + Manager Bot) در حال اجراست.\nداشبورد: /dashboard',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders } }
      );
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },

  // ── زمان‌بند خودکار Cloudflare Cron (الهام‌گرفته از freezerain/telegram-bot) ──
  async scheduled(event, env) {
    try {
      const db = env.DB;
      if (!db) return;
      await ensureSchema(db);
      const managerApi = createTelegramAPI(env.MANAGER_BOT_TOKEN || env.BOT_TOKEN);
      const managersRepo = new ManagersRepository(db);
      const jobsRepo = new ScrapingJobsRepository(db);

      const pendingJobs = await jobsRepo.findPending();
      if (pendingJobs.length > 0) {
        const activeManagers = await managersRepo.listActive();
        for (const mgr of activeManagers) {
          await managerApi.sendMessage({
            chat_id: mgr.telegram_id,
            text: `⏰ یادآوری خودکار: در حال حاضر ${pendingJobs.length} درخواست مشتری در صف انتظار بررسی است.\nبرای مشاهده: /manager`,
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[Scheduled] خطا در اجرای کرون:', err.message);
    }
  },
};
