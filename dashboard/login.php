<?php
// dashboard/login.php — Login page

$error = '';
$csrf = csrfToken();

// Handle login POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verifyCsrf($_POST['csrf'] ?? '')) {
        $error = 'توکن امنیتی نامعتبر است.';
    } else {
        $key = $_POST['key'] ?? '';
        if ($key && $key === getenv('AGENT_API_KEY')) {
            $_SESSION['authenticated'] = true;
            $_SESSION['login_time'] = time();
            header('Location: /dashboard/');
            exit;
        } else {
            $error = 'کلید دسترسی نامعتبر است.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ورود — <?= APP_NAME ?></title>
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
.error{color:#ef4444;font-size:.85rem;margin-bottom:12px}
.hint{color:#64748b;font-size:.75rem;margin-top:16px}
</style>
</head>
<body>
<div class="card">
  <h2>🔐 ورود به داشبورد</h2>
  <p><?= APP_NAME ?></p>
  <?php if ($error): ?>
    <div class="error"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>
  <form method="post">
    <input name="csrf" type="hidden" value="<?= htmlspecialchars($csrf) ?>">
    <input name="key" type="password" placeholder="کلید دسترسی را وارد کنید" autofocus required>
    <button type="submit">ورود</button>
  </form>
  <div class="hint">در صورت نیاز، کلید را از مدیر سیستم دریافت کنید.</div>
</div>
</body>
</html>
