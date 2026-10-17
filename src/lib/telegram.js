// ─────────────────────────────────────────────
// src/lib/telegram.js — کلاینت Telegram Bot API (پشتیبانی از دو ربات: مشتری و مدیر)
// ─────────────────────────────────────────────

/**
 * ارسال درخواست به Telegram Bot API
 */
async function callTelegram(token, method, body) {
  if (!token || token.startsWith('test-') || token === 'mock') {
    return { ok: true, mocked: true, method, body };
  }
  try {
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
  } catch (err) {
    console.error(`[Telegram] ${method} خطای شبکه:`, err.message);
    return null;
  }
}

export function createTelegramAPI(token) {
  return {
    token,
    sendMessage:         (p) => callTelegram(token, 'sendMessage',         p),
    editMessageText:     (p) => callTelegram(token, 'editMessageText',     p),
    answerCallbackQuery: (p) => callTelegram(token, 'answerCallbackQuery', p),
    getChatMember:       (p) => callTelegram(token, 'getChatMember',       p),
    getChat:             (p) => callTelegram(token, 'getChat',             p),
    setWebhook:          (p) => callTelegram(token, 'setWebhook',          p),
    sendChatAction:      (p) => callTelegram(token, 'sendChatAction',      p),
    forwardMessage:      (p) => callTelegram(token, 'forwardMessage',      p),
  };
}
