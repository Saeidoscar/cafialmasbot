<?php
// dashboard/api.php — API endpoints for AJAX requests

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$pdo = getDb();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

// CSRF check for POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $csrf = $_POST['csrf'] ?? '';
    if (!verifyCsrf($csrf)) {
        jsonResponse(['error' => 'توکن امنیتی نامعتبر'], 403);
    }
}

// Rate limiting
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (!checkRateLimit($ip, 120, 60)) {
    jsonResponse(['error' => 'تعداد درخواست‌ها بیش از حد مجاز'], 429);
}

switch ($action) {
    case 'stats':
        getStats($pdo);
        break;
    case 'jobs':
        getJobs($pdo);
        break;
    case 'users':
        getUsers($pdo);
        break;
    case 'cancel':
        cancelJob($pdo);
        break;
    case 'retry':
        retryJob($pdo);
        break;
    case 'delete':
        deleteJob($pdo);
        break;
    case 'create_job':
        createJob($pdo);
        break;
    default:
        jsonResponse(['error' => 'عملیات نامعتبر'], 400);
}

function getStats($pdo) {
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
    } catch (Exception $e) {
        // Tables might not exist
    }
    
    jsonResponse($stats);
}

function getJobs($pdo) {
    $status = $_GET['status'] ?? '';
    $limit = min(intval($_GET['limit'] ?? 20), 100);
    
    try {
        $sql = 'SELECT j.*, u.username FROM scraping_jobs j LEFT JOIN users u ON u.telegram_id = j.user_id';
        $params = [];
        
        if ($status && in_array($status, ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])) {
            $sql .= ' WHERE j.status = ?';
            $params[] = $status;
        }
        
        $sql .= ' ORDER BY j.created_at DESC LIMIT ?';
        $params[] = $limit;
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $jobs = $stmt->fetchAll();
        
        // Decode payload
        foreach ($jobs as &$job) {
            $job['payload'] = json_decode($job['payload'] ?? '{}', true) ?: [];
        }
        
        jsonResponse(['jobs' => $jobs]);
    } catch (Exception $e) {
        jsonResponse(['error' => 'خطا در دریافت درخواست‌ها'], 500);
    }
}

function getUsers($pdo) {
    try {
        $stmt = $pdo->query('SELECT * FROM users ORDER BY created_at DESC LIMIT 50');
        $users = $stmt->fetchAll();
        jsonResponse(['users' => $users]);
    } catch (Exception $e) {
        jsonResponse(['error' => 'خطا در دریافت کاربران'], 500);
    }
}

function cancelJob($pdo) {
    $jobId = intval($_POST['job_id'] ?? 0);
    
    if (!$jobId) {
        jsonResponse(['error' => 'شناسه درخواست نامعتبر'], 400);
    }
    
    try {
        $stmt = $pdo->prepare('UPDATE scraping_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = ?');
        $result = $stmt->execute(['FAILED', 'لغو شده توسط مدیر.', time(), $jobId, 'PENDING']);
        
        if ($result && $stmt->rowCount() > 0) {
            jsonResponse(['ok' => true, 'message' => 'درخواست لغو شد.']);
        } else {
            jsonResponse(['error' => 'درخواست یافت نشد یا قابل لغو نیست.'], 404);
        }
    } catch (Exception $e) {
        jsonResponse(['error' => 'خطا در لغو درخواست'], 500);
    }
}

function retryJob($pdo) {
    $jobId = intval($_POST['job_id'] ?? 0);
    
    if (!$jobId) {
        jsonResponse(['error' => 'شناسه درخواست نامعتبر'], 400);
    }
    
    try {
        $stmt = $pdo->prepare('UPDATE scraping_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = ?');
        $result = $stmt->execute(['PENDING', null, time(), $jobId, 'FAILED']);
        
        if ($result && $stmt->rowCount() > 0) {
            jsonResponse(['ok' => true, 'message' => 'درخواست مجدداً در صف قرار گرفت.']);
        } else {
            jsonResponse(['error' => 'درخواست یافت نشد.'], 404);
        }
    } catch (Exception $e) {
        jsonResponse(['error' => 'خطا در تلاش مجدد'], 500);
    }
}

function deleteJob($pdo) {
    $jobId = intval($_POST['job_id'] ?? 0);
    
    if (!$jobId) {
        jsonResponse(['error' => 'شناسه درخواست نامعتبر'], 400);
    }
    
    try {
        $stmt = $pdo->prepare('DELETE FROM scraping_jobs WHERE id = ?');
        $result = $stmt->execute([$jobId]);
        
        if ($result && $stmt->rowCount() > 0) {
            jsonResponse(['ok' => true, 'message' => 'درخواست حذف شد.']);
        } else {
            jsonResponse(['error' => 'درخواست یافت نشد.'], 404);
        }
    } catch (Exception $e) {
        jsonResponse(['error' => 'خطا در حذف درخواست'], 500);
    }
}

function createJob($pdo) {
    $service = strtoupper($_POST['service'] ?? '');
    $allowedServices = ['SANA', 'GICA', 'MYGOV', 'TAX', 'INSURANCE', 'MOJAVEZ', 'AMLAK', 'KHODNEWIS', 'SAMAN'];
    
    if (!in_array($service, $allowedServices)) {
        jsonResponse(['error' => 'نوع سرویس نامعتبر'], 400);
    }
    
    $fields = [];
    foreach ($_POST as $key => $value) {
        if (strpos($key, 'field_') === 0) {
            $fields[] = sanitize($value, 500);
        }
    }
    
    if (empty($fields)) {
        jsonResponse(['error' => 'هیچ فیلدی وارد نشده'], 400);
    }
    
    try {
        $stmt = $pdo->prepare('INSERT INTO scraping_jobs (user_id, task_type, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
        $result = $stmt->execute([
            'admin', // Default user for dashboard-created jobs
            $service,
            json_encode(['fields' => $fields]),
            'PENDING',
            time(),
            time()
        ]);
        
        if ($result) {
            jsonResponse(['ok' => true, 'message' => 'درخواست با موفقیت ثبت شد.', 'job_id' => $pdo->lastInsertId()]);
        } else {
            jsonResponse(['error' => 'خطا در ثبت درخواست'], 500);
        }
    } catch (Exception $e) {
        jsonResponse(['error' => 'خطا در ثبت درخواست: ' . $e->getMessage()], 500);
    }
}
