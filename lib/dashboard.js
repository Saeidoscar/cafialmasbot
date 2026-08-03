// ─────────────────────────────────────────────
// api.js — داشبورد مدیریتی + REST API برای عامل محلی
//
// SDK جدید tgcloud:
//   • db از 'sdk' — query builder
//   • این فایل در handlers/ نیست — از طریق index.js صدا زده می‌شود
//     اما در tgcloud SDK جدید، HTTP handling مستقیماً در اختیار ما نیست.
//     این فایل یک lib ماژول است که از handlers/message.js فراخوانی می‌شود.
//
// نکته: در tgcloud SDK جدید، HTTP endpoint سفارشی وجود ندارد.
//       داشبورد از طریق دستور /dashboard در ربات ارسال می‌شود.
// ─────────────────────────────────────────────

import { db }                         from 'sdk';
import { eq, desc, count, sql }       from 'sdk/db';
import { users, scrapingJobs }        from 'schema';

const AGENT_API_KEY = process.env.AGENT_API_KEY;

// ═══════════════════════════════════════════════
// احراز هویت عامل محلی
// ═══════════════════════════════════════════════

export function verifyAgentKey(providedKey) {
  if (!AGENT_API_KEY) return false;
  return providedKey === AGENT_API_KEY;
}

// ═══════════════════════════════════════════════
// دریافت آمار برای داشبورد
// ═══════════════════════════════════════════════

export async function getStats() {
  const [totalUsers] = await db.select({ n: count() }).from(users).all();
  const [totalJobs]  = await db.select({ n: count() }).from(scrapingJobs).all();
  const [pending]    = await db.select({ n: count() }).from(scrapingJobs).where(eq(scrapingJobs.status, 'PENDING')).all();
  const [processing] = await db.select({ n: count() }).from(scrapingJobs).where(eq(scrapingJobs.status, 'PROCESSING')).all();
  const [completed]  = await db.select({ n: count() }).from(scrapingJobs).where(eq(scrapingJobs.status, 'COMPLETED')).all();
  const [failed]     = await db.select({ n: count() }).from(scrapingJobs).where(eq(scrapingJobs.status, 'FAILED')).all();

  return {
    total_users: totalUsers?.n ?? 0,
    total_jobs:  totalJobs?.n  ?? 0,
    pending:     pending?.n    ?? 0,
    processing:  processing?.n ?? 0,
    completed:   completed?.n  ?? 0,
    failed:      failed?.n     ?? 0,
  };
}

export async function getRecentJobs(limit = 20) {
  return db.select().from(scrapingJobs)
    .orderBy(desc(scrapingJobs.createdAt))
    .limit(limit)
    .all();
}

// ═══════════════════════════════════════════════
// عملیات کار (برای عامل محلی از طریق Telegram)
// ═══════════════════════════════════════════════

export async function getPendingJobs(limit = 3) {
  return db.select().from(scrapingJobs)
    .where(eq(scrapingJobs.status, 'PENDING'))
    .orderBy(scrapingJobs.createdAt)
    .limit(limit)
    .all();
}

export async function claimJob(jobId) {
  const result = await db.update(scrapingJobs)
    .set({ status: 'PROCESSING', updatedAt: new Date() })
    .where(sql`${scrapingJobs.id} = ${jobId} AND ${scrapingJobs.status} = 'PENDING'`)
    .run();
  return (result?.changes ?? result?.rowsAffected ?? 0) > 0;
}

export async function completeJob(jobId) {
  await db.update(scrapingJobs)
    .set({ status: 'COMPLETED', errorMessage: null, updatedAt: new Date() })
    .where(eq(scrapingJobs.id, jobId))
    .run();
}

export async function failJob(jobId, errorMessage) {
  await db.update(scrapingJobs)
    .set({ status: 'FAILED', errorMessage, updatedAt: new Date() })
    .where(eq(scrapingJobs.id, jobId))
    .run();
}

// ═══════════════════════════════════════════════
// ساخت HTML داشبورد
// ═══════════════════════════════════════════════

export function buildDashboardHTML(stats, recentJobs) {
  const statusLabel = { PENDING: 'در انتظار', PROCESSING: 'در حال پردازش', COMPLETED: 'تکمیل‌شده', FAILED: 'ناموفق' };
  const statusColor = { PENDING: '#f59e0b', PROCESSING: '#3b82f6', COMPLETED: '#10b981', FAILED: '#ef4444' };
  const statusBg    = { PENDING: '#fffbeb', PROCESSING: '#eff6ff', COMPLETED: '#ecfdf5', FAILED: '#fef2f2' };

  const jobRows = recentJobs.map(j => {
    const sc   = statusColor[j.status] ?? '#6b7280';
    const sb   = statusBg[j.status]    ?? '#f9fafb';
    const sl   = statusLabel[j.status] ?? j.status;
    const date = j.createdAt ? String(j.createdAt).substring(0, 16).replace('T', ' ') : '—';
    const err  = j.errorMessage ? String(j.errorMessage).substring(0, 55) : '—';
    return `<tr>
      <td>#${j.id}</td>
      <td><span class="badge" style="background:${sb};color:${sc};border:1px solid ${sc}">${j.taskType}</span></td>
      <td>${j.userId}</td>
      <td><span class="badge" style="background:${sb};color:${sc};border:1px solid ${sc}">${sl}</span></td>
      <td dir="ltr" style="font-family:monospace;font-size:12px">${date}</td>
      <td style="color:#ef4444;font-size:12px">${err}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>داشبورد کافه هوشمند</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Vazirmatn',Tahoma,sans-serif;background:#f1f5f9;color:#1e293b;font-size:14px;line-height:1.7;direction:rtl}
header{background:#1e293b;color:#f8fafc;padding:0 32px;height:60px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.brand{font-size:16px;font-weight:700}.brand span{color:#38bdf8}
.meta{font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:16px}
.pulse{width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}
main{max-width:1100px;margin:0 auto;padding:28px 20px 60px}
h2{font-size:18px;font-weight:600;color:#0f172a;margin-bottom:16px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:32px}
.stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;display:flex;flex-direction:column;gap:6px;transition:box-shadow .2s}
.stat-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08)}
.stat-card .lbl{font-size:12px;color:#64748b;font-weight:500}
.stat-card .val{font-size:32px;font-weight:700;line-height:1.1}
.stat-card .sub{font-size:11px;color:#94a3b8}
.c-blue{color:#3b82f6}.c-amber{color:#f59e0b}.c-green{color:#10b981}.c-red{color:#ef4444}.c-purple{color:#8b5cf6}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:28px}
.card-header{padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}
.card-header h3{font-size:14px;font-weight:600}
.rbtn{font-size:12px;color:#3b82f6;cursor:pointer;border:none;background:none;font-family:inherit;padding:4px 10px;border-radius:6px;transition:background .15s}
.rbtn:hover{background:#eff6ff}
table{width:100%;border-collapse:collapse}
thead th{background:#f8fafc;padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;text-align:right;border-bottom:1px solid #e2e8f0;white-space:nowrap}
tbody td{padding:11px 14px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:#f8fafc}
.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap}
.cmds{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.cmd{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start}
.cmd code{font-family:'Courier New',monospace;background:#1e293b;color:#38bdf8;padding:2px 8px;border-radius:5px;font-size:12px;white-space:nowrap;direction:ltr;display:inline-block}
.cmd-desc{font-size:13px;color:#475569}
footer{text-align:center;padding:20px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;margin-top:20px}
.ov{display:none;position:fixed;inset:0;background:rgba(255,255,255,.6);z-index:999;align-items:center;justify-content:center}
.ov.on{display:flex}
.sp{width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:600px){header{padding:0 16px}main{padding:16px 12px 48px}.stats-grid{grid-template-columns:1fr 1fr}table{font-size:12px}thead th,tbody td{padding:8px 10px}}
</style>
</head>
<body>
<div class="ov" id="ov"><div class="sp"></div></div>
<header>
  <div class="brand">کافه هوشمند <span>|</span> پنل مدیریت</div>
  <div class="meta">
    <span id="clk" dir="ltr"></span>
    <span><span class="pulse"></span> آنلاین</span>
  </div>
</header>
<main>
  <h2>نمای کلی سیستم</h2>
  <div class="stats-grid">
    <div class="stat-card"><div class="lbl">کل کاربران</div><div class="val c-blue">${stats.total_users}</div><div class="sub">کاربر ثبت‌شده</div></div>
    <div class="stat-card"><div class="lbl">در انتظار</div><div class="val c-amber">${stats.pending}</div><div class="sub">کار در صف</div></div>
    <div class="stat-card"><div class="lbl">در حال پردازش</div><div class="val c-blue">${stats.processing}</div><div class="sub">کار جاری</div></div>
    <div class="stat-card"><div class="lbl">تکمیل‌شده</div><div class="val c-green">${stats.completed}</div><div class="sub">کار موفق</div></div>
    <div class="stat-card"><div class="lbl">ناموفق</div><div class="val c-red">${stats.failed}</div><div class="sub">کار ناموفق</div></div>
    <div class="stat-card"><div class="lbl">کل کارها</div><div class="val c-purple">${stats.total_jobs}</div><div class="sub">سانا + گیکا</div></div>
  </div>
  <div class="card">
    <div class="card-header"><h3>آخرین کارهای ثبت‌شده</h3><button class="rbtn" onclick="reload()">↻ بارگذاری مجدد</button></div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>شناسه</th><th>نوع</th><th>شناسه کاربر</th><th>وضعیت</th><th>زمان ثبت</th><th>خطا</th></tr></thead>
      <tbody>${jobRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:32px">هیچ کاری ثبت نشده است</td></tr>'}</tbody>
    </table></div>
  </div>
  <div class="card">
    <div class="card-header"><h3>دستورات ربات تلگرام</h3></div>
    <div style="padding:16px 20px"><div class="cmds">
      <div class="cmd"><div><code>/start</code></div><div class="cmd-desc">پیام خوش‌آمدگویی و فهرست دستورات</div></div>
      <div class="cmd"><div><code>/help</code></div><div class="cmd-desc">راهنمای کامل استفاده از ربات</div></div>
      <div class="cmd"><div><code>/sana</code></div><div class="cmd-desc">ثبت درخواست سانا با کمک هوش مصنوعی</div></div>
      <div class="cmd"><div><code>/gica</code></div><div class="cmd-desc">ثبت درخواست گیکا با کمک هوش مصنوعی</div></div>
      <div class="cmd"><div><code>/add_doc [نام] [مقدار]</code></div><div class="cmd-desc">ذخیره مدرک — مثال: <code>/add_doc national_id 0012345678</code></div></div>
      <div class="cmd"><div><code>/my_docs</code></div><div class="cmd-desc">نمایش مدارک ذخیره‌شده</div></div>
      <div class="cmd"><div><code>/link_chat [chat_id]</code></div><div class="cmd-desc">اتصال گروه یا کانال تلگرام</div></div>
      <div class="cmd"><div><code>/cancel</code></div><div class="cmd-desc">لغو عملیات جاری</div></div>
      <div class="cmd"><div><code>/dashboard</code></div><div class="cmd-desc">نمایش لینک داشبورد مدیریتی (فقط ادمین)</div></div>
    </div></div>
  </div>
</main>
<footer>آخرین بارگذاری: <span id="lr" dir="ltr"></span> &nbsp;·&nbsp; بارگذاری خودکار هر ۳۰ ثانیه &nbsp;·&nbsp; Made with IBM Bob</footer>
<script>
function tick(){document.getElementById('clk').textContent=new Date().toLocaleTimeString('fa-IR',{hour12:false})}
tick();setInterval(tick,1000);
document.getElementById('lr').textContent=new Date().toLocaleString('fa-IR',{hour12:false});
function reload(){document.getElementById('ov').classList.add('on');location.reload()}
setTimeout(reload,30000);
</script>
</body></html>`;
}
