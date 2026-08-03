<?php
// dashboard/auth.php — Authentication logic

require_once __DIR__ . '/config.php';

// Check if already authenticated via session
if (!empty($_SESSION['authenticated'])) {
    return;
}

// API authentication via header
$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($apiKey && $apiKey === getenv('AGENT_API_KEY')) {
    // API requests don't need session
    return;
}

// For web requests, require authentication
$authPath = $_SERVER['REQUEST_URI'] ?? '/';

// Allow login page and assets without auth
if (strpos($authPath, '/login') !== false || 
    strpos($authPath, '/assets/') !== false ||
    $authPath === '/') {
    return;
}

// Check for API key in query (for initial dashboard access)
if (isset($_GET['key']) && $_GET['key'] === getenv('AGENT_API_KEY')) {
    $_SESSION['authenticated'] = true;
    $_SESSION['login_time'] = time();
    // Redirect to remove key from URL
    header('Location: /dashboard/');
    exit;
}

// If not authenticated and not login page, redirect to login
if (!isset($_SESSION['authenticated'])) {
    if (strpos($authPath, '/api/') === 0) {
        jsonResponse(['error' => 'احراز هویت ناموفق'], 401);
    }
    // Serve login page
    include __DIR__ . '/login.php';
    exit;
}
