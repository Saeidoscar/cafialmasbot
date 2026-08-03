// dashboard/assets/js/app.js — Dashboard interactivity

let currentTab = 'jobs';

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadJobs();
  loadUsers();
  
  setInterval(() => {
    loadStats();
    if (currentTab === 'jobs') loadJobs();
    if (currentTab === 'users') loadUsers();
  }, 30000);
});

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const idx = ['jobs', 'users', 'services'].indexOf(tab);
  if (idx >= 0) {
    document.querySelectorAll('.tab')[idx]?.classList.add('active');
    document.getElementById('tab-' + tab)?.classList.add('active');
  }
  if (tab === 'jobs') loadJobs();
  if (tab === 'users') loadUsers();
}

async function loadStats() {
  try {
    const res = await fetch('/api.php?action=stats');
    const data = await res.json();
    if (data.error) return;
    updateStat('stat-total', data.total_jobs);
    updateStat('stat-pending', data.pending);
    updateStat('stat-processing', data.processing);
    updateStat('stat-completed', data.completed);
    updateStat('stat-failed', data.failed);
    updateStat('stat-users', data.total_users);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function updateStat(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const old = parseInt(el.textContent.replace(/,/g, '')) || 0;
  if (old !== value) {
    el.textContent = value.toLocaleString('fa-IR');
    el.style.transform = 'scale(1.1)';
    setTimeout(() => el.style.transform = 'scale(1)', 200);
  }
}

async function loadJobs() {
  const tbody = document.getElementById('jobs-table');
  if (!tbody) return;
  try {
    tbody.innerHTML = '<tr><td colspan="6" class="empty"><div class="spinner"></div></td></tr>';
    const res = await fetch('/api.php?action=jobs&limit=20');
    const data = await res.json();
    if (data.error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">${data.error}</td></tr>`;
      return;
    }
    const jobs = data.jobs || [];
    if (jobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">📭 هیچ درخواستی ثبت نشده است.</td></tr>';
      return;
    }
    const statusLabels = { PENDING: 'در انتظار', PROCESSING: 'در حال پردازش', COMPLETED: 'تکمیل‌شده', FAILED: 'ناموفق' };
    const taskLabels = { SANA: 'سانا', GICA: 'گیکا', MYGOV: 'my.gov.ir', TAX: 'my.tax.gov.ir', INSURANCE: 'بیمه', MOJAVEZ: 'مجوز کسب', AMLAK: 'املاک', KHODNEWIS: 'خنویس', SAMAN: 'وام سامان' };
    tbody.innerHTML = jobs.map(job => {
      const date = new Date((job.created_at || 0) * 1000).toLocaleString('fa-IR');
      const statusClass = job.status?.toLowerCase() || 'pending';
      let actions = '';
      if (job.status === 'PENDING') {
        actions = `<form method="post" action="api.php" style="display:inline" onsubmit="return confirm('لغو این درخواست؟')">
          <input type="hidden" name="csrf" value="${getCsrf()}">
          <input type="hidden" name="action" value="cancel">
          <input type="hidden" name="job_id" value="${job.id}">
          <button type="submit" class="btn btn-danger btn-sm">لغو</button>
        </form>`;
      }
      if (job.status === 'FAILED') {
        actions = `<form method="post" action="api.php" style="display:inline" onsubmit="return confirm('تلاش مجدد؟')">
          <input type="hidden" name="csrf" value="${getCsrf()}">
          <input type="hidden" name="action" value="retry">
          <input type="hidden" name="job_id" value="${job.id}">
          <button type="submit" class="btn btn-primary btn-sm">تلاش مجدد</button>
        </form>`;
      }
      return `<tr class="fade-in">
        <td>#${job.id}</td>
        <td><span class="task-badge">${taskLabels[job.task_type] || job.task_type}</span></td>
        <td>${job.username || job.user_id || 'ناشناس'}</td>
        <td><span class="badge badge-${statusClass}">${statusLabels[job.status] || job.status}</span></td>
        <td>${date}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">خطا در بارگذاری داده‌ها</td></tr>`;
  }
}

async function loadUsers() {
  const tbody = document.querySelector('#tab-users tbody');
  if (!tbody) return;
  try {
    const res = await fetch('/api.php?action=users');
    const data = await res.json();
    if (data.error) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">${data.error}</td></tr>`;
      return;
    }
    const users = data.users || [];
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">👥 هنوز کاربری ثبت نشده است.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(user => {
      const date = new Date((user.created_at || 0) * 1000).toLocaleString('fa-IR');
      return `<tr class="fade-in">
        <td>${user.telegram_id}</td>
        <td>${user.username || 'ناشناس'}</td>
        <td><span class="badge" style="background:rgba(99,102,241,.15);color:#a5b4fc">${user.role || 'user'}</span></td>
        <td>${user.state || 'START'}</td>
        <td>${date}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">خطا در بارگذاری داده‌ها</td></tr>`;
  }
}

function getCsrf() {
  const meta = document.querySelector('meta[name="csrf"]');
  if (meta) return meta.content;
  const input = document.querySelector('input[name="csrf"]');
  return input ? input.value : '';
}
