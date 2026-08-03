// dashboard/server.js — Node.js server with PHP emulation for local development
// Run: node dashboard/server.js
// Then open: http://localhost:8080

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Session store (in-memory)
const sessions = new Map();

// Mock database
const mockDb = {
  jobs: [
    { id: 124, task_type: 'MYGOV', username: '@ali', status: 'PENDING', created_at: Date.now()/1000 - 300, user_id: '123' },
    { id: 123, task_type: 'INSURANCE', username: '@sara', status: 'COMPLETED', created_at: Date.now()/1000 - 600, user_id: '456' },
    { id: 122, task_type: 'SANA', username: '@reza', status: 'PROCESSING', created_at: Date.now()/1000 - 900, user_id: '789' },
    { id: 121, task_type: 'TAX', username: '@mina', status: 'COMPLETED', created_at: Date.now()/1000 - 1200, user_id: '012' },
    { id: 120, task_type: 'MOJAVEZ', username: '@ahmad', status: 'FAILED', created_at: Date.now()/1000 - 1500, user_id: '345' },
    { id: 119, task_type: 'AMLAK', username: '@sara', status: 'COMPLETED', created_at: Date.now()/1000 - 1800, user_id: '456' },
    { id: 118, task_type: 'KHODNEWIS', username: '@reza', status: 'FAILED', created_at: Date.now()/1000 - 2100, user_id: '789' },
    { id: 117, task_type: 'SAMAN', username: '@ali', status: 'COMPLETED', created_at: Date.now()/1000 - 2400, user_id: '123' },
  ],
  users: [
    { telegram_id: '123456789', username: 'ali', role: 'user', state: 'START', created_at: Date.now()/1000 - 86400 },
    { telegram_id: '987654321', username: 'sara', role: 'user', state: 'START', created_at: Date.now()/1000 - 172800 },
    { telegram_id: '555555555', username: 'reza', role: 'admin', state: 'START', created_at: Date.now()/1000 - 259200 },
  ]
};

const taskLabels = {
  SANA: 'سانا', GICA: 'گیکا', MYGOV: 'my.gov.ir',
  TAX: 'my.tax.gov.ir', INSURANCE: 'بیمه', MOJAVEZ: 'مجوز کسب',
  AMLAK: 'املاک', KHODNEWIS: 'خنویس', SAMAN: 'وام سامان',
};

const statusLabels = {
  PENDING: 'در انتظار', PROCESSING: 'در حال پردازش',
  COMPLETED: 'تکمیل‌شده', FAILED: 'ناموفق'
};

function getSessionId(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/cafe_dashboard_session=([^;]+)/);
  return match ? match[1] : null;
}

function requireAuth(req, res) {
  const sid = getSessionId(req);
  if (!sid || !sessions.has(sid)) {
    res.writeHead(302, { Location: '/login.php' });
    res.end();
    return false;
  }
  return true;
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 
      'Content-Type': contentType + '; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  
  // API routes
  if (pathname === '/api.php') {
    const action = url.searchParams.get('action') || '';
    
    // Auth check for API
    const sid = getSessionId(req);
    if (!sid || !sessions.has(sid)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'احراز هویت ناموفق' }));
      return;
    }
    
    // Rate limit
    const ip = req.connection.remoteAddress || 'unknown';
    if (!rateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'تعداد درخواست‌ها بیش از حد مجاز' }));
      return;
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    
    switch (action) {
      case 'stats': {
        const stats = {
          total_jobs: mockDb.jobs.length,
          pending: mockDb.jobs.filter(j => j.status === 'PENDING').length,
          processing: mockDb.jobs.filter(j => j.status === 'PROCESSING').length,
          completed: mockDb.jobs.filter(j => j.status === 'COMPLETED').length,
          failed: mockDb.jobs.filter(j => j.status === 'FAILED').length,
          total_users: mockDb.users.length,
        };
        res.end(JSON.stringify(stats));
        break;
      }
      case 'jobs': {
        const jobs = mockDb.jobs.map(j => ({
          ...j,
          payload: {},
          created_at: Math.floor(j.created_at)
        }));
        res.end(JSON.stringify({ jobs }));
        break;
      }
      case 'users': {
        res.end(JSON.stringify({ users: mockDb.users }));
        break;
      }
      default:
        res.end(JSON.stringify({ error: 'عملیات نامعتبر' }));
    }
    return;
  }
  
  // Login page
  if (pathname === '/login.php') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const key = params.get('key') || '';
        
        if (key === (process.env.DASHBOARD_API_KEY || process.env.AGENT_API_KEY || 'cafe-almas-secret-2024')) {
          const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
          sessions.set(sid, { authenticated: true, login_time: Date.now() });
          res.writeHead(302, { 
            Location: '/',
            'Set-Cookie': `cafe_dashboard_session=${sid}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`
          });
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html lang="fa" dir="rtl">
            <head>
              <meta charset="UTF-8">
              <title>ورود — کافه هوشمند</title>
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
                <a href="/login.php">بازگشت به صفحه ورود</a>
              </div>
            </body>
            </html>
          `);
        }
      });
      return;
    }
    
    // GET login page
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="fa" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ورود — کافه هوشمند</title>
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
    return;
  }
  
  // Logout
  if (pathname === '/logout' && req.method === 'POST') {
    const sid = getSessionId(req);
    if (sid) sessions.delete(sid);
    res.writeHead(302, { 
      'Location': '/login.php',
      'Set-Cookie': 'cafe_dashboard_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict'
    });
    res.end();
    return;
  }
  
  // Main dashboard
  if (pathname === '/' || pathname === '/index.php') {
    if (!requireAuth(req, res)) return;
    
    const stats = {
      total_jobs: mockDb.jobs.length,
      pending: mockDb.jobs.filter(j => j.status === 'PENDING').length,
      processing: mockDb.jobs.filter(j => j.status === 'PROCESSING').length,
      completed: mockDb.jobs.filter(j => j.status === 'COMPLETED').length,
      failed: mockDb.jobs.filter(j => j.status === 'FAILED').length,
      total_users: mockDb.users.length,
    };
    
    const recentJobs = mockDb.jobs.slice(0, 20);
    const recentUsers = mockDb.users.slice(0, 10);
    
    const taskLabelsMap = {
      SANA: 'سانا', GICA: 'گیکا', MYGOV: 'my.gov.ir',
      TAX: 'my.tax.gov.ir', INSURANCE: 'بیمه', MOJAVEZ: 'مجوز کسب',
      AMLAK: 'املاک', KHODNEWIS: 'خنویس', SAMAN: 'وام سامان',
    };
    
    const statusLabelsMap = {
      PENDING: 'در انتظار', PROCESSING: 'در حال پردازش',
      COMPLETED: 'تکمیل‌شده', FAILED: 'ناموفق'
    };
    
    let jobsHtml = recentJobs.map(job => {
      const date = new Date(job.created_at * 1000).toLocaleString('fa-IR');
      const statusClass = job.status.toLowerCase();
      let actions = '';
      if (job.status === 'PENDING') {
        actions = `<form method="post" action="/api.php?action=cancel" style="display:inline" onsubmit="return confirm('لغو این درخواست؟')">
          <input type="hidden" name="csrf" value="mock">
          <input type="hidden" name="action" value="cancel">
          <input type="hidden" name="job_id" value="${job.id}">
          <button type="submit" class="btn btn-danger" style="padding:4px 12px;font-size:.75rem">لغو</button>
        </form>`;
      }
      if (job.status === 'FAILED') {
        actions = `<form method="post" action="/api.php?action=retry" style="display:inline" onsubmit="return confirm('تلاش مجدد؟')">
          <input type="hidden" name="csrf" value="mock">
          <input type="hidden" name="action" value="retry">
          <input type="hidden" name="job_id" value="${job.id}">
          <button type="submit" class="btn btn-primary" style="padding:4px 12px;font-size:.75rem">تلاش مجدد</button>
        </form>`;
      }
      return `<tr>
        <td>#${job.id}</td>
        <td><span class="task-badge">${taskLabelsMap[job.task_type] || job.task_type}</span></td>
        <td>${job.username || job.user_id || 'ناشناس'}</td>
        <td><span class="badge badge-${statusClass}">${statusLabelsMap[job.status] || job.status}</span></td>
        <td>${date}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
    
    let usersHtml = recentUsers.map(user => {
      const date = new Date(user.created_at * 1000).toLocaleString('fa-IR');
      return `<tr>
        <td>${user.telegram_id}</td>
        <td>${user.username || 'ناشناس'}</td>
        <td><span class="badge" style="background:rgba(99,102,241,.15);color:#a5b4fc">${user.role || 'user'}</span></td>
        <td>${user.state || 'START'}</td>
        <td>${date}</td>
      </tr>`;
    }).join('');
    
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>داشبورد مدیریتی — کافه هوشمند</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f172a;--surface:#1e293b;--surface2:#273347;--border:#334155;--text:#f1f5f9;--muted:#94a3b8;--accent:#6366f1;--accent2:#818cf8;--green:#22c55e;--yellow:#f59e0b;--red:#ef4444;--blue:#3b82f6}
body{font-family:'Vazirmatn','Segoe UI',Tahoma,sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh}
header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:62px;position:sticky;top:0;z-index:100}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem}
.logo-icon{width:36px;height:36px;background:var(--accent);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
.header-right{display:flex;align-items:center;gap:16px}
.live-dot{width:8px;height:8px;background:var(--green);border-radius:50%;animation:blink 1.6s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.live-text{font-size:.8rem;color:var(--green)}
.logout-btn{padding:7px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--muted);cursor:pointer;font-family:inherit;font-size:.85rem;transition:all .2s}
.logout-btn:hover{color:var(--red);border-color:var(--red)}
main{max-width:1200px;margin:0 auto;padding:28px 20px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:8px;transition:border-color .2s}
.stat-card:hover{border-color:var(--accent)}
.stat-title{font-size:.8rem;color:var(--muted);font-weight:500}
.stat-value{font-size:2rem;font-weight:700;line-height:1}
.stat-sub{font-size:.75rem;color:var(--muted)}
.c-total{color:var(--accent2)}.c-pending{color:var(--yellow)}.c-proc{color:var(--blue)}.c-done{color:var(--green)}.c-fail{color:var(--red)}.c-user{color:#c084fc}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:28px}
.card-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.card-header h3{font-size:1rem;font-weight:600}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{padding:13px 16px;text-align:right;font-weight:600;font-size:.78rem;color:var(--muted);background:var(--surface2);border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:12px 16px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--surface2)}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
.badge-pending{background:rgba(245,158,11,.15);color:#fbbf24}.badge-processing{background:rgba(59,130,246,.15);color:#60a5fa}.badge-completed{background:rgba(34,197,94,.15);color:#4ade80}.badge-failed{background:rgba(239,68,68,.15);color:#f87171}
.task-badge{background:rgba(99,102,241,.15);color:#a5b4fc;padding:3px 10px;border-radius:6px;font-size:.75rem;font-weight:600;font-family:monospace}
.empty{text-align:center;padding:48px;color:var(--muted)}
.refresh-btn{padding:7px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--muted);cursor:pointer;font-family:inherit;font-size:.85rem;transition:all .2s}
.refresh-btn:hover{color:var(--text);border-color:var(--accent)}
.tabs{display:flex;gap:8px;padding:16px 20px;border-bottom:1px solid var(--border)}
.tab{padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.85rem;transition:all .2s;border:1px solid transparent}
.tab:hover{background:var(--surface2)}
.tab.active{background:var(--accent);color:#fff}
.tab-content{display:none;padding:20px}
.tab-content.active{display:block}
.btn{padding:10px 20px;border:none;border-radius:8px;font-size:.9rem;cursor:pointer;font-family:inherit;transition:all .2s}
.btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{background:#4f46e5}
.btn-danger{background:var(--red);color:#fff}.btn-danger:hover{background:#dc2626}
footer{text-align:center;padding:28px 20px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);margin-top:40px}
@media(max-width:768px){.stats-grid{grid-template-columns:1fr 1fr}header{padding:0 16px;flex-wrap:wrap;height:auto;padding:12px 16px}.header-right{width:100%;justify-content:space-between;margin-top:8px}.tabs{overflow-x:auto}}
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
    <form method="post" action="/logout" style="display:inline">
      <button type="submit" class="logout-btn">خروج</button>
    </form>
  </div>
</header>
<main>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-title">کل درخواست‌ها</div><div class="stat-value c-total">${stats.total_jobs}</div><div class="stat-sub">از ابتدا تا کنون</div></div>
    <div class="stat-card"><div class="stat-title">در انتظار</div><div class="stat-value c-pending">${stats.pending}</div><div class="stat-sub">نیاز به پردازش</div></div>
    <div class="stat-card"><div class="stat-title">در حال پردازش</div><div class="stat-value c-proc">${stats.processing}</div><div class="stat-sub">در جریان</div></div>
    <div class="stat-card"><div class="stat-title">تکمیل‌شده</div><div class="stat-value c-done">${stats.completed}</div><div class="stat-sub">با موفقیت</div></div>
    <div class="stat-card"><div class="stat-title">ناموفق</div><div class="stat-value c-fail">${stats.failed}</div><div class="stat-sub">نیاز به بررسی</div></div>
    <div class="stat-card"><div class="stat-title">کاربران ثبت‌شده</div><div class="stat-value c-user">${stats.total_users}</div><div class="stat-sub">در ربات</div></div>
  </div>
  <div class="card">
    <div class="tabs">
      <div class="tab active" onclick="showTab('jobs')">📋 درخواست‌ها</div>
      <div class="tab" onclick="showTab('users')">👥 کاربران</div>
      <div class="tab" onclick="showTab('settings')">⚙️ تنظیمات</div>
    </div>
    <div id="tab-jobs" class="tab-content active">
      <div class="card-header">
        <h3>آخرین درخواست‌ها</h3>
        <button class="refresh-btn" onclick="loadJobs()">🔄 بارگذاری</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>نوع</th><th>کاربر</th><th>وضعیت</th><th>تاریخ ثبت</th><th>عملیات</th></tr></thead>
          <tbody id="jobs-table">
            ${jobsHtml || '<tr><td colspan="6" class="empty">📭 هیچ درخواستی ثبت نشده است.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div id="tab-users" class="tab-content">
      <div class="card-header"><h3>کاربران ثبت‌شده</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>آیدی تلگرام</th><th>نام کاربری</th><th>نقش</th><th>وضعیت</th><th>تاریخ ثبت</th></tr></thead>
          <tbody>
            ${usersHtml || '<tr><td colspan="5" class="empty">👥 هنوز کاربری ثبت نشده است.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div id="tab-settings" class="tab-content">
      <h3 style="margin-bottom:20px">تنظیمات سیستم</h3>
      <div class="form-group">
        <label>کلید API عامل محلی (AGENT_API_KEY)</label>
        <input type="text" value="${process.env.AGENT_API_KEY ? '***' : 'cafe-almas-secret-2024'}" readonly>
      </div>
      <div class="form-group">
        <label>نسخه سیستم</label>
        <input type="text" value="1.0.0" readonly>
      </div>
      <div class="form-group">
        <label>وضعیت امنیت</label>
        <div style="display:flex;gap:8px;margin-top:8px">
          <span class="badge badge-completed">Session Auth</span>
          <span class="badge badge-completed">CSRF</span>
          <span class="badge badge-completed">Rate Limit</span>
        </div>
      </div>
    </div>
  </div>
</main>
<footer>
  کافه اینترنت الماس — پنل مدیریت — نسخه ۱.۰<br>
  آخرین به‌روزرسانی: ${new Date().toLocaleString('fa-IR')}
</footer>
<script>
function showTab(tab){currentTab=tab;document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));const idx=['jobs','users','settings'].indexOf(tab);if(idx>=0)document.querySelectorAll('.tab')[idx]?.classList.add('active');document.getElementById('tab-'+tab)?.classList.add('active');if(tab==='jobs')loadJobs();if(tab==='users')loadUsers()}
async function loadJobs(){const t=document.getElementById('jobs-table');if(!t)return;t.innerHTML='<tr><td colspan="6" class="empty"><div class="spinner" style="width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto"></div></td></tr>';const r=await fetch('/api.php?action=jobs');const d=await r.json();if(d.jobs&&d.jobs.length){const tl={SANA:'سانا',GICA:'گیکا',MYGOV:'my.gov.ir',TAX:'my.tax.gov.ir',INSURANCE:'بیمه',MOJAVEZ:'مجوز کسب',AMLAK:'املاک',KHODNEWIS:'خنویس',SAMAN:'وام سامان'};t.innerHTML=d.jobs.map(j=>{const dt=new Date(j.created_at*1000).toLocaleString('fa-IR');let a='';if(j.status==='PENDING')a='<form method="post" action="/api.php?action=cancel" style="display:inline" onsubmit="return confirm(\'لغو؟\')"><input type="hidden" name="csrf" value="mock"><input type="hidden" name="action" value="cancel"><input type="hidden" name="job_id" value="'+j.id+'"><button type="submit" class="btn btn-danger" style="padding:4px 12px;font-size:.75rem">لغو</button></form>';if(j.status==='FAILED')a='<form method="post" action="/api.php?action=retry" style="display:inline" onsubmit="return confirm(\'تلاش مجدد؟\')"><input type="hidden" name="csrf" value="mock"><input type="hidden" name="action" value="retry"><input type="hidden" name="job_id" value="'+j.id+'"><button type="submit" class="btn btn-primary" style="padding:4px 12px;font-size:.75rem">تلاش مجدد</button></form>';return'<tr><td>#'+j.id+'</td><td><span class="task-badge">'+(tl[j.task_type]||j.task_type)+'</span></td><td>'+(j.username||j.user_id||'ناشناس')+'</td><td><span class="badge badge-'+(j.status||'pending').toLowerCase()+'">'+(j.status||'')+'</span></td><td>'+dt+'</td><td>'+a+'</td></tr>'}).join('')}else t.innerHTML='<tr><td colspan="6" class="empty">📭 هیچ درخواستی ثبت نشده است.</td></tr>'}
async function loadUsers(){const t=document.querySelector('#tab-users tbody');if(!t)return;const r=await fetch('/api.php?action=users');const d=await r.json();if(d.users&&d.users.length){t.innerHTML=d.users.map(u=>{const dt=new Date(u.created_at*1000).toLocaleString('fa-IR');return'<tr><td>'+u.telegram_id+'</td><td>'+(u.username||'ناشناس')+'</td><td><span class="badge" style="background:rgba(99,102,241,.15);color:#a5b4fc">'+(u.role||'user')+'</span></td><td>'+(u.state||'START')+'</td><td>'+dt+'</td></tr>'}).join('')}else t.innerHTML='<tr><td colspan="5" class="empty">👥 هنوز کاربری ثبت نشده است.</td></tr>'}
setInterval(()=>{loadStats();if(currentTab==='jobs')loadJobs();if(currentTab==='users')loadUsers()},30000);
</script>
</body>
</html>`);
  return;
}

// Serve static assets
if (pathname.startsWith('/assets/')) {
  const filePath = path.join(__dirname, pathname);
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  serveFile(res, filePath, contentType);
  return;
}

// 404 for everything else
res.writeHead(404);
res.end('Not found');
});

// Simple rate limiter
const rateLimitMap = new Map();
function rateLimit(key) {
  const now = Date.now();
  const windowMs = 60000;
  const max = 120;
  
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { ts: now, count: 1 });
    return true;
  }
  
  const record = rateLimitMap.get(key);
  if (now - record.ts > windowMs) {
    rateLimitMap.set(key, { ts: now, count: 1 });
    return true;
  }
  
  if (record.count >= max) {
    return false;
  }
  
  record.count++;
  return true;
}

server.listen(PORT, () => {
  console.log(`
  ☕ کافه هوشمند — سرور محلی
  ─────────────────────────
  Dashboard: http://localhost:${PORT}
  Login key: ${process.env.DASHBOARD_API_KEY || process.env.AGENT_API_KEY || 'cafe-almas-secret-2024'}
  ─────────────────────────
  `);
});
