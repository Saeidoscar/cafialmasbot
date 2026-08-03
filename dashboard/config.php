<?php
// dashboard/config.php — Configuration and database connection

define('DASHBOARD_VERSION', '1.0.0');
define('APP_NAME', 'کافه هوشمند');

// Security: session cookie settings
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Strict');
ini_set('session.use_only_cookies', 1);

// Start session
session_name('cafe_dashboard_session');
session_start();

// Timezone
date_default_timezone_set('Asia/Tehran');

// Database path — adjust if needed
$dbPath = dirname(__DIR__) . '/data/cafe.db';

// If DB doesn't exist there, try parent directory (for Render deployment)
if (!file_exists($dbPath)) {
    $dbPath = dirname(__DIR__) . '/cafe.db';
}

/**
 * Get database connection (SQLite)
 */
function getDb() {
    static $pdo = null;
    if ($pdo === null) {
        global $dbPath;
        if (!file_exists($dbPath)) {
            die('Database not found at: ' . htmlspecialchars($dbPath));
        }
        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
    }
    return $pdo;
}

/**
 * CSRF token management
 */
function csrfToken() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verifyCsrf($token) {
    return hash_equals($_SESSION['csrf_token'] ?? '', $token);
}

/**
 * Security headers
 */
function securityHeaders() {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('X-XSS-Protection: 1; mode=block');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
}

/**
 * JSON response helper
 */
function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Require authentication
 */
function requireAuth() {
    if (empty($_SESSION['authenticated'])) {
        http_response_code(401);
        echo json_encode(['error' => 'احراز هویت ناموفق'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

/**
 * Rate limiting (simple in-memory)
 */
function checkRateLimit($key, $max = 60, $window = 60) {
    static $limits = [];
    $now = time();
    
    if (!isset($limits[$key])) {
        $limits[$key] = ['ts' => $now, 'count' => 1];
        return true;
    }
    
    if ($now - $limits[$key]['ts'] > $window) {
        $limits[$key] = ['ts' => $now, 'count' => 1];
        return true;
    }
    
    if ($limits[$key]['count'] >= $max) {
        return false;
    }
    
    $limits[$key]['count']++;
    return true;
}

/**
 * Sanitize text input
 */
function sanitize($text, $maxLength = 1000) {
    return substr(trim($text ?? ''), 0, $maxLength);
}

/**
 * Validate job ID
 */
function isValidJobId($id) {
    $n = intval($id);
    return $n > 0 && $n == $id;
}

// Apply security headers to all responses
securityHeaders();
