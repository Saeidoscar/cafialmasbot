// ─────────────────────────────────────────────
// lib/telegram.js — wrapper برای Telegram Bot API
// ─────────────────────────────────────────────

/**
 * ارسال درخواست به Telegram Bot API
 */
async function callTelegram(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`[Telegram] ${method} خطا:`, data.description);
  }
  return data.result ?? null;
}

export function createTelegramAPI(token) {
  return {
    sendMessage:         (p) => callTelegram(token, 'sendMessage',         p),
    editMessageText:     (p) => callTelegram(token, 'editMessageText',     p),
    answerCallbackQuery: (p) => callTelegram(token, 'answerCallbackQuery', p),
    getChatMember:       (p) => callTelegram(token, 'getChatMember',       p),
    getChat:             (p) => callTelegram(token, 'getChat',             p),
    setWebhook:          (p) => callTelegram(token, 'setWebhook',          p),
  };
}
