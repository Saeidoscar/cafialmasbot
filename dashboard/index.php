<?php
// dashboard/index.php — Main dashboard interface with service tree

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/config.php';

$pdo = getDb();
$csrf = csrfToken();
$theme = $_COOKIE['dashboard_theme'] ?? 'dark';

// Handle logout
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'logout') {
    if (!verifyCsrf($_POST['csrf'] ?? '')) {
        die('CSRF token mismatch');
    }
    session_destroy();
    header('Location: /dashboard/login.php');
    exit;
}

// Handle theme change
if (isset($_POST['theme'])) {
    setcookie('dashboard_theme', $_POST['theme'], time() + 365 * 24 * 60 * 60, '/');
    header('Location: ' . $_SERVER['REQUEST_URI']);
    exit;
}

// Get statistics
$stats = [
    'total_jobs' => 0, 'pending' => 0, 'processing' => 0,
    'completed' => 0, 'failed' => 0, 'total_users' => 0,
];

try {
    $stats['total_jobs'] = (int)$pdo->query('SELECT COUNT(*) FROM scraping_jobs')->fetchColumn();
    $stats['pending'] = (int)$pdo->query("SELECT COUNT(*) FROM scraping_jobs WHERE status='PENDING'")->fetchColumn();
    $stats['processing'] = (int)$pdo->query("SELECT COUNT(*) FROM scraping_jobs WHERE status='PROCESSING'")->fetchColumn();
    $stats['completed'] = (int)$pdo->query("SELECT COUNT(*) FROM scraping_jobs WHERE status='COMPLETED'")->fetchColumn();
    $stats['failed'] = (int)$pdo->query("SELECT COUNT(*) FROM scraping_jobs WHERE status='FAILED'")->fetchColumn();
    $stats['total_users'] = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
} catch (Exception $e) {}

// Get recent jobs
$recentJobs = [];
try {
    $stmt = $pdo->query('SELECT j.*, u.username FROM scraping_jobs j LEFT JOIN users u ON u.telegram_id = j.user_id ORDER BY j.created_at DESC LIMIT 20');
    $recentJobs = $stmt->fetchAll();
} catch (Exception $e) {}

// Get recent users
$recentUsers = [];
try {
    $stmt = $pdo->query('SELECT * FROM users ORDER BY created_at DESC LIMIT 10');
    $recentUsers = $stmt->fetchAll();
} catch (Exception $e) {}

// Service definitions
$services = [
    'MYGOV' => ['name' => 'my.gov.ir', 'icon' => '🔐', 'desc' => 'ورود به پورتال دولت الکترونیک', 'fields' => ['شماره موبایل', 'کد ملی', 'تاریخ تولد', 'محل تولد']],
    'TAX' => ['name' => 'my.tax.gov.ir', 'icon' => '💰', 'desc' => 'امور مالیاتی', 'fields' => ['کد ملی', 'تاریخ تولد', 'توکن my.gov.ir', 'شناسه مالیاتی']],
    'INSURANCE' => ['name' => 'eservice.tamin.ir', 'icon' => '🏥', 'desc' => 'بیمه تامین اجتماعی و تکمیلی', 'fields' => ['کد ملی', 'تاریخ تولد', 'شماره بیمه', 'نوع بیمه']],
    'MOJAVEZ' => ['name' => 'mojavez.ir', 'icon' => '📄', 'desc' => 'مجوز کسب و کار', 'fields' => ['کد ملی', 'تاریخ تولد', 'نوع کسب', 'آدرس کسب']],
    'AMLAK' => ['name' => 'amlak.mrud.ir', 'icon' => '🏠', 'desc' => 'استعلام املاک و کد پستی', 'fields' => ['کد ملی', 'تاریخ تولد', 'آدرس', 'کد پستی']],
    'KHODNEWIS' => ['name' => 'khodnevis.mrud.ir', 'icon' => '✍️', 'desc' => 'قرارداد خنویس', 'fields' => ['کد ملی', 'تاریخ تولد', 'نوع قرارداد']],
    'SAMAN' => ['name' => 'saman.mrud.ir', 'icon' => '🏦', 'desc' => 'وام سامان', 'fields' => ['کد ملی', 'تاریخ تولد', 'مبلغ وام', 'نوع وام']],
    'SANA' => ['name' => 'sana.ir', 'icon' => '📋', 'desc' => 'ثبت درخواست سانا', 'fields' => ['کد ملی', 'تاریخ تولد', 'شماره موبایل', 'سریال شناسنامه']],
    'GICA' => ['name' => 'gica.ir', 'icon' => '📋', 'desc' => 'ثبت درخواست گیکا', 'fields' => ['کد ملی', 'تاریخ تولد', 'شماره موبایل', 'کد رهگیری']],
];

$taskLabels = [
    'SANA' => 'سانا', 'GICA' => 'گیکا', 'MYGOV' => 'my.gov.ir',
    'TAX' => 'my.tax.gov.ir', 'INSURANCE' => 'بیمه', 'MOJAVEZ' => 'مجوز کسب',
    'AMLAK' => 'املاک', 'KHODNEWIS' => 'خنویس', 'SAMAN' => 'وام سامان',
];

$statusLabels = [
    'PENDING' => 'در انتظار', 'PROCESSING' => 'در حال پردازش',
    'COMPLETED' => 'تکمیل‌شده', 'FAILED' => 'ناموفق',
];

$activeService = $_GET['service'] ?? null;
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl" data-theme="<?= htmlspecialchars($theme) ?>">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>داشبورد مدیریتی — <?= APP_NAME ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-icon">☕</div>
    <span>کافه اینترنت الماس</span>
  </div>
  <div class="header-right">
    <button class="mobile-menu-btn" onclick="toggleSidebar()">☰</button>
    <div class="live-dot"></div>
    <span class="live-text">زنده</span>
    <form method="post" style="display:inline">
      <input type="hidden" name="theme" value="<?= $theme === 'dark' ? 'light' : 'dark' ?>">
      <button type="submit" class="theme-toggle"><?= $theme === 'dark' ? '☀️ روشن' : '🌙 تاریک' ?></button>
    </form>
    <button class="refresh-btn" onclick="location.reload()">🔄 به‌روزرسانی</button>
    <form method="post" action="/logout" style="display:inline">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>">
      <input type="hidden" name="action" value="logout">
      <button type="submit" class="logout-btn">خروج</button>
    </form>
  </div>
</header>

<!-- Sidebar -->
<nav class="sidebar" id="sidebar">
  <div class="sidebar-header">سرویس‌های دولتی</div>
  <ul class="service-tree">
    <li><a href="?service=MYGOV" class="<?= $activeService === 'MYGOV' ? 'active' : '' ?>"><span class="icon">🔐</span> my.gov.ir <span class="badge">ورود</span></a></li>
    <li><a href="?service=TAX" class="<?= $activeService === 'TAX' ? 'active' : '' ?>"><span class="icon">💰</span> my.tax.gov.ir <span class="badge">مالیاتی</span></a></li>
    <li><a href="?service=INSURANCE" class="<?= $activeService === 'INSURANCE' ? 'active' : '' ?>"><span class="icon">🏥</span> بیمه تامین <span class="badge">تکمیلی</span></a></li>
    <li><a href="?service=MOJAVEZ" class="<?= $activeService === 'MOJAVEZ' ? 'active' : '' ?>"><span class="icon">📄</span> mojavez.ir <span class="badge">مجوز کسب</span></a></li>
    <li><a href="?service=AMLAK" class="<?= $activeService === 'AMLAK' ? 'active' : '' ?>"><span class="icon">🏠</span> amlak.mrud.ir <span class="badge">املاک</span></a></li>
    <li><a href="?service=KHODNEWIS" class="<?= $activeService === 'KHODNEWIS' ? 'active' : '' ?>"><span class="icon">✍️</span> khodnevis.mrud.ir <span class="badge">قرارداد</span></a></li>
    <li><a href="?service=SAMAN" class="<?= $activeService === 'SAMAN' ? 'active' : '' ?>"><span class="icon">🏦</span> saman.mrud.ir <span class="badge">وام</span></a></li>
    <li><a href="?service=SANA" class="<?= $activeService === 'SANA' ? 'active' : '' ?>"><span class="icon">📋</span> sana.ir <span class="badge">ثبت</span></a></li>
    <li><a href="?service=GICA" class="<?= $activeService === 'GICA' ? 'active' : '' ?>"><span class="icon">📋</span> gica.ir <span class="badge">ثبت</span></a></li>
  </ul>
</nav>

<main>

  <?php if ($activeService && isset($services[$activeService])): 
    $svc = $services[$activeService];
  ?>
    <!-- Service Workflow Form -->
    <div class="card fade-in">
      <div class="card-header">
        <h3><?= $svc['icon'] ?> فرم ثبت درخواست — <?= $svc['name'] ?></h3>
        <a href="?" style="color:var(--accent);font-size:.85rem">بازگشت به داشبورد</a>
      </div>
      <div class="info-box">
        <div class="icon">ℹ️</div>
        <div class="text"><?= $svc['desc'] ?>. این فرم توسط هوش مصنوعی پر می‌شود. اپراتور پس از پر شدن فرم، CAPTCHA را حل کرده و فرم را ارسال می‌کند.</div>
      </div>
      <form method="post" action="api.php" class="form-card">
        <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>">
        <input type="hidden" name="action" value="create_job">
        <input type="hidden" name="service" value="<?= htmlspecialchars($activeService) ?>">
        <div class="form-row">
          <?php foreach ($svc['fields'] as $i => $field): ?>
            <div class="form-group">
              <label><?= htmlspecialchars($field) ?></label>
              <input type="text" name="field_<?= $i ?>" placeholder="<?= htmlspecialchars($field) ?>" required>
            </div>
          <?php endforeach; ?>
        </div>
        <button type="submit" class="btn btn-primary">📤 ثبت درخواست</button>
      </form>
      <div class="workflow">
        <div class="workflow-step"><div class="step-num">۱</div><div class="step-content"><div class="step-title">کاربر دستور را ارسال می‌کند</div><div class="step-desc">مثلاً /<?= strtolower($activeService) ?> — هوش مصنوعی FSM را شروع می‌کند</div></div></div>
        <div class="workflow-step"><div class="step-num">۲</div><div class="step-content"><div class="step-title">جمع‌آوری اطلاعات با AI</div><div class="step-desc">گپ دوطرفه تا تکمیل تمام فیلدهای الزامی</div></div></div>
        <div class="workflow-step"><div class="step-num">۳</div><div class="step-content"><div class="step-title">ایجاد کار در صف</div><div class="step-desc">ثبت درخواست با وضعیت PENDING در پایگاه داده</div></div></div>
        <div class="workflow-step"><div class="step-num">۴</div><div class="step-content"><div class="step-title">عامل محلی کار را دریافت می‌کند</div><div class="step-desc">Poll → Claim → باز کردن پورتال در Chromium</div></div></div>
        <div class="workflow-step"><div class="step-num">۵</div><div class="step-content"><div class="step-title">اپراتور CAPTCHA را حل می‌کند</div><div class="step-desc">مرورگر headed برای ورود دستی اپراتور</div></div></div>
        <div class="workflow-step"><div class="step-num">۶</div><div class="step-content"><div class="step-title">گزارش نتیجه به کاربر</div><div class="step-desc">ارسال پیام موفقیت/ناموفقی در تلگرام</div></div></div>
      </div>
    </div>

  <?php else: ?>

    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">کل درخواست‌ها</div>
        <div class="stat-value c-total"><?= number_format($stats['total_jobs']) ?></div>
        <div class="stat-sub">از ابتدا تا کنون</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">در انتظار</div>
        <div class="stat-value c-pending"><?= number_format($stats['pending']) ?></div>
        <div class="stat-sub">نیاز به پردازش</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">در حال پردازش</div>
        <div class="stat-value c-proc"><?= number_format($stats['processing']) ?></div>
        <div class="stat-sub">در جریان</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">تکمیل‌شده</div>
        <div class="stat-value c-done"><?= number_format($stats['completed']) ?></div>
        <div class="stat-sub">با موفقیت</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">ناموفق</div>
        <div class="stat-value c-fail"><?= number_format($stats['failed']) ?></div>
        <div class="stat-sub">نیاز به بررسی</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">کاربران ثبت‌شده</div>
        <div class="stat-value c-user"><?= number_format($stats['total_users']) ?></div>
        <div class="stat-sub">در ربات</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="card">
      <div class="tabs">
        <div class="tab active" onclick="showTab('jobs')">📋 درخواست‌ها</div>
        <div class="tab" onclick="showTab('users')">👥 کاربران</div>
        <div class="tab" onclick="showTab('services')">🌐 سرویس‌ها</div>
      </div>

      <!-- Jobs Tab -->
      <div id="tab-jobs" class="tab-content active">
        <div class="card-header">
          <h3>آخرین درخواست‌ها</h3>
          <button class="refresh-btn" onclick="loadJobs()">🔄 بارگذاری</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>نوع</th>
                <th>کاربر</th>
                <th>وضعیت</th>
                <th>تاریخ ثبت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody id="jobs-table">
              <?php if (empty($recentJobs)): ?>
                <tr><td colspan="6" class="empty">هیچ درخواستی ثبت نشده است.</td></tr>
              <?php else: ?>
                <?php foreach ($recentJobs as $job): ?>
                  <?php $status = $job['status'] ?? 'PENDING'; $taskType = $job['task_type'] ?? ''; $date = date('Y/m/d H:i', $job['created_at'] ?? time()); ?>
                  <tr>
                    <td>#<?= htmlspecialchars($job['id']) ?></td>
                    <td><span class="task-badge"><?= htmlspecialchars($taskLabels[$taskType] ?? $taskType) ?></span></td>
                    <td><?= htmlspecialchars($job['username'] ?? $job['user_id'] ?? 'ناشناس') ?></td>
                    <td><span class="badge badge-<?= strtolower($status) ?>"><?= htmlspecialchars($statusLabels[$status] ?? $status) ?></span></td>
                    <td><?= $date ?></td>
                    <td>
                      <?php if ($status === 'PENDING'): ?>
                        <form method="post" action="api.php" style="display:inline" onsubmit="return confirm('لغو این درخواست؟')">
                          <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>">
                          <input type="hidden" name="action" value="cancel">
                          <input type="hidden" name="job_id" value="<?= (int)$job['id'] ?>">
                          <button type="submit" class="btn btn-danger btn-sm">لغو</button>
                        </form>
                      <?php endif; ?>
                      <?php if ($status === 'FAILED'): ?>
                        <form method="post" action="api.php" style="display:inline" onsubmit="return confirm('تلاش مجدد؟')">
                          <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>">
                          <input type="hidden" name="action" value="retry">
                          <input type="hidden" name="job_id" value="<?= (int)$job['id'] ?>">
                          <button type="submit" class="btn btn-primary btn-sm">تلاش مجدد</button>
                        </form>
                      <?php endif; ?>
                    </td>
                  </tr>
                <?php endforeach; ?>
              <?php endif; ?>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Users Tab -->
      <div id="tab-users" class="tab-content">
        <div class="card-header">
          <h3>کاربران ثبت‌شده</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>آیدی تلگرام</th>
                <th>نام کاربری</th>
                <th>نقش</th>
                <th>وضعیت</th>
                <th>تاریخ ثبت</th>
              </tr>
            </thead>
            <tbody>
              <?php if (empty($recentUsers)): ?>
                <tr><td colspan="5" class="empty">هنوز کاربری ثبت نشده است.</td></tr>
              <?php else: ?>
                <?php foreach ($recentUsers as $user): ?>
                  <tr>
                    <td><?= htmlspecialchars($user['telegram_id']) ?></td>
                    <td><?= htmlspecialchars($user['username'] ?? 'ناشناس') ?></td>
                    <td><span class="badge" style="background:rgba(99,102,241,.15);color:#a5b4fc"><?= htmlspecialchars($user['role'] ?? 'user') ?></span></td>
                    <td><?= htmlspecialchars($user['state'] ?? 'START') ?></td>
                    <td><?= date('Y/m/d H:i', $user['created_at'] ?? time()) ?></td>
                  </tr>
                <?php endforeach; ?>
              <?php endif; ?>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Services Tab -->
      <div id="tab-services" class="tab-content">
        <h3 style="margin-bottom:20px">🌐 سرویس‌های دولتی یکپارچه‌شده</h3>
        <div class="form-row">
          <?php foreach ($services as $key => $svc): ?>
            <div class="form-card">
              <h3><?= $svc['icon'] ?> <?= $svc['name'] ?></h3>
              <p style="color:var(--muted);font-size:.85rem;margin-bottom:12px"><?= $svc['desc'] ?></p>
              <div style="font-size:.8rem;color:var(--muted);margin-bottom:12px">
                <strong>فیلدهای مورد نیاز:</strong><br>
                <?= implode('، ', $svc['fields']) ?>
              </div>
              <a href="?service=<?= $key ?>" class="btn btn-primary" style="display:block;text-align:center">ثبت درخواست جدید</a>
            </div>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

  <?php endif; ?>

</main>

<footer>
  کافه اینترنت الماس — پنل مدیریت — نسخه <?= DASHBOARD_VERSION ?><br>
  آخرین به‌روزرسانی: <?= date('Y/m/d H:i') ?>
</footer>

<script src="assets/js/app.js"></script>
<script>
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open')}
</script>
</body>
</html>
