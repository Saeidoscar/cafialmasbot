// ─────────────────────────────────────────────
// src/index.js — entry point Cloudflare Workers
// ─────────────────────────────────────────────

import { createTelegramAPI }    from './lib/telegram.js';
import { handleMessage }        from './handlers/message.js';
import { handleCallbackQuery }  from './handlers/callback_query.js';
import { dbRun }                from './lib/db.js';
import { SCHEMA_SQL }            from './db/schema.js';

async function ensureSchema(db) {
  try {
    for (const stmt of SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean)) {
      await db.prepare(stmt).run();
    }
  } catch (err) {
    console.error('[Schema] خطا:', err.message);
  }
}

// ── محدودیت نرخ (Rate Limit) ─────────────────
const rateLimitMap = new Map();
function checkRateLimit(key, windowMs = 60000, max = 30) {
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
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
  };
}

// ── داشبورد HTML ────────────────────────────────
function buildDashboard(stats, jobs) {
  const sl = { PENDING: 'در انتظار', PROCESSING: 'در پردازش', COMPLETED: 'تکمیل‌شده', FAILED: 'ناموفق' };
  const sc = { PENDING: '#f59e0b',   PROCESSING: '#3b82f6',   COMPLETED: '#10b981',    FAILED: '#ef4444' };
  const sb = { PENDING: '#fffbeb',   PROCESSING: '#eff6ff',   COMPLETED: '#ecfdf5',    FAILED: '#fef2f2' };

  const rows = jobs.map(j => {
    const d = j.created_at ? new Date(j.created_at * 1000).toISOString().substring(0,16).replace('T',' ') : '—';
    return `<tr>
      <td>#${j.id}</td>
      <td><span class="badge" style="background:${sb[j.status]??'#f9fafb'};color:${sc[j.status]??'#6b7280'};border:1px solid ${sc[j.status]??'#6b7280'}">${j.task_type}</span></td>
      <td>${j.user_id}</td>
      <td><span class="badge" style="background:${sb[j.status]??'#f9fafb'};color:${sc[j.status]??'#6b7280'};border:1px solid ${sc[j.status]??'#6b7280'}">${sl[j.status]??j.status}</span></td>
      <td dir="ltr" style="font-family:monospace;font-size:12px">${d}</td>
      <td style="color:#ef4444;font-size:12px">${j.error_message?String(j.error_message).substring(0,55):'—'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>داشبورد کافه هوشمند</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Vazirmatn',Tahoma,sans-serif;background:#f1f5f9;color:#1e293b;font-size:14px;direction:rtl}
header{background:#1e293b;color:#f8fafc;padding:0 32px;height:60px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.brand{font-size:16px;font-weight:700}.brand span{color:#38bdf8}
.meta{font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:16px}
.pulse{width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}
main{max-width:1100px;margin:0 auto;padding:28px 20px 60px}
h2{font-size:18px;font-weight:600;color:#0f172a;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:32px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;display:flex;flex-direction:column;gap:6px}
.lbl{font-size:12px;color:#64748b;font-weight:500}.val{font-size:32px;font-weight:700;line-height:1.1}.sub{font-size:11px;color:#94a3b8}
.c-blue{color:#3b82f6}.c-amber{color:#f59e0b}.c-green{color:#10b981}.c-red{color:#ef4444}.c-purple{color:#8b5cf6}
.tcard{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:28px}
.thead{padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}
.thead h3{font-size:14px;font-weight:600}
.rbtn{font-size:12px;color:#3b82f6;cursor:pointer;border:none;background:none;font-family:inherit;padding:4px 10px;border-radius:6px}
table{width:100%;border-collapse:collapse}
thead th{background:#f8fafc;padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;text-align:right;border-bottom:1px solid #e2e8f0;white-space:nowrap}
tbody td{padding:11px 14px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}tbody tr:hover{background:#f8fafc}
.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap}
footer{text-align:center;padding:20px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}
.ov{display:none;position:fixed;inset:0;background:rgba(255,255,255,.6);z-index:999;align-items:center;justify-content:center}
.ov.on{display:flex}.sp{width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:600px){main{padding:16px 12px 48px}.grid{grid-template-columns:1fr 1fr}}
</style></head><body>
<div class="ov" id="ov"><div class="sp"></div></div>
<header>
  <div class="brand">کافه هوشمند <span>|</span> پنل مدیریت</div>
  <div class="meta"><span id="clk" dir="ltr"></span><span><span class="pulse"></span> آنلاین</span></div>
</header>
<main>
  <h2>نمای کلی سیستم</h2>
  <div class="grid">
    <div class="card"><div class="lbl">کل کاربران</div><div class="val c-blue">${stats.total_users}</div><div class="sub">کاربر ثبت‌شده</div></div>
    <div class="card"><div class="lbl">در انتظار</div><div class="val c-amber">${stats.pending}</div><div class="sub">کار در صف</div></div>
    <div class="card"><div class="lbl">در حال پردازش</div><div class="val c-blue">${stats.processing}</div><div class="sub">کار جاری</div></div>
    <div class="card"><div class="lbl">تکمیل‌شده</div><div class="val c-green">${stats.completed}</div><div class="sub">کار موفق</div></div>
    <div class="card"><div class="lbl">ناموفق</div><div class="val c-red">${stats.failed}</div><div class="sub">کار ناموفق</div></div>
    <div class="card"><div class="lbl">کل کارها</div><div class="val c-purple">${stats.total_jobs}</div><div class="sub">سانا + گیکا</div></div>
  </div>
  <div class="tcard">
    <div class="thead"><h3>آخرین کارهای ثبت‌شده</h3><button class="rbtn" onclick="reload()">↻ بارگذاری مجدد</button></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>شناسه</th><th>نوع</th><th>کاربر</th><th>وضعیت</th><th>زمان ثبت</th><th>خطا</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:32px">هیچ کاری ثبت نشده است</td></tr>'}</tbody>
    </table></div>
  </div>
</main>
<footer>آخرین بارگذاری: <span id="lr" dir="ltr"></span> &nbsp;·&nbsp; بارگذاری خودکار هر ۳۰ ثانیه &nbsp;·&nbsp; Made with IBM Bob</footer>
<script>
function tick(){document.getElementById('clk').textContent=new Date().toLocaleTimeString('fa-IR',{hour12:false})}
tick();setInterval(tick,1000);
document.getElementById('lr').textContent=new Date().toLocaleString('fa-IR',{hour12:false});
function reload(){document.getElementById('ov').classList.add('on');location.reload()}
setTimeout(reload,30000);
</script></body></html>`;
}

// ── هندلر اصلی ─────────────────────────────────
export default {
  async fetch(request, env) {
    const db  = env.DB;
    const api = createTelegramAPI(env.BOT_TOKEN);
    const url = new URL(request.url);
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';

    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ error: 'تعداد درخواست‌ها بیش از حد مجاز است.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...securityHeaders() },
      });
    }

    const corsHeaders = {
      ...securityHeaders(),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── Schema init ──────────────────────────────
    await ensureSchema(db);

    // ── داشبورد ──────────────────────────────────
    if (url.pathname === '/dashboard' && request.method === 'GET') {
      const [users, jobs, pending, processing, completed, failed] = await Promise.all([
        db.prepare('SELECT COUNT(*) as n FROM users').first(),
        db.prepare('SELECT COUNT(*) as n FROM scraping_jobs').first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='PENDING'").first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='PROCESSING'").first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='COMPLETED'").first(),
        db.prepare("SELECT COUNT(*) as n FROM scraping_jobs WHERE status='FAILED'").first(),
      ]);
      const recentJobs = await db.prepare(
        'SELECT * FROM scraping_jobs ORDER BY created_at DESC LIMIT 20'
      ).all();
      const stats = {
        total_users: users?.n ?? 0, total_jobs: jobs?.n ?? 0,
        pending: pending?.n ?? 0,   processing: processing?.n ?? 0,
        completed: completed?.n ?? 0, failed: failed?.n ?? 0,
      };
      return new Response(buildDashboard(stats, recentJobs.results ?? []), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // ── REST API برای عامل محلی ──────────────────
    if (url.pathname.startsWith('/api/')) {
      const providedKey = request.headers.get('x-api-key');
      if (!providedKey || providedKey !== env.AGENT_API_KEY) {
        return new Response(JSON.stringify({ error: 'احراز هویت ناموفق' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (url.pathname === '/api/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

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
        if (!Number.isInteger(jobId) || jobId <= 0) {
          return new Response(JSON.stringify({ error: 'شناسه کار نامعتبر است.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const result = await db.prepare(
          "UPDATE scraping_jobs SET status='PROCESSING', updated_at=unixepoch() WHERE id=? AND status='PENDING'"
        ).bind(claimMatch[1]).run();
        if (!result.meta?.changes) return new Response(JSON.stringify({ error: 'کار در دسترس نیست' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
        return new Response(JSON.stringify({ message: 'کار دریافت شد.', job_id: claimMatch[1] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const completeMatch = url.pathname.match(/^\/api\/jobs\/(\d+)\/complete$/);
      if (completeMatch && request.method === 'POST') {
        const jobId = parseInt(completeMatch[1]);
        if (!Number.isInteger(jobId) || jobId <= 0) {
          return new Response(JSON.stringify({ error: 'شناسه کار نامعتبر است.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        await db.prepare(
          "UPDATE scraping_jobs SET status='COMPLETED', error_message=NULL, updated_at=unixepoch() WHERE id=?"
        ).bind(completeMatch[1]).run();
        return new Response(JSON.stringify({ message: 'کار تکمیل شد.', job_id: completeMatch[1] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const failMatch = url.pathname.match(/^\/api\/jobs\/(\d+)\/fail$/);
      if (failMatch && request.method === 'POST') {
        const jobId = parseInt(failMatch[1]);
        if (!Number.isInteger(jobId) || jobId <= 0) {
          return new Response(JSON.stringify({ error: 'شناسه کار نامعتبر است.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const body = await request.json().catch(() => ({}));
        const errMsg = typeof body?.error_message === 'string' ? body.error_message : 'خطای ناشناخته';
        await db.prepare(
          "UPDATE scraping_jobs SET status='FAILED', error_message=?, updated_at=unixepoch() WHERE id=?"
        ).bind(errMsg, failMatch[1]).run();
        return new Response(JSON.stringify({ message: 'کار ناموفق ثبت شد.', job_id: failMatch[1] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ error: 'مسیر یافت نشد' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ── Webhook تلگرام ───────────────────────────
    if (url.pathname === '/webhook' && request.method === 'POST') {
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
          await handleMessage(api, db, update.message, env);
        } else if (update.callback_query) {
          await handleCallbackQuery(api, db, update.callback_query);
        }
      } catch (err) {
        console.error('[Worker] خطای کلی:', err);
      }

      return new Response('OK', { headers: corsHeaders });
    }

    // ── صفحه اصلی ────────────────────────────────
    if (url.pathname === '/') {
      return new Response(
        '🤖 ربات هوشمند کافه اینترنت در حال اجراست.\nداشبورد: /dashboard',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders } }
      );
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
