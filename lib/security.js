// ─────────────────────────────────────────────
// lib/security.js — ابزارهای اعتبارسنجی و امنیتی مشترک
// ─────────────────────────────────────────────

export function isValidJobId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0;
}

export function sanitizeText(text, maxLength = 4096) {
  return String(text ?? '').trim().slice(0, maxLength);
}

export function isValidTelegramId(id) {
  return /^\d+$/.test(String(id)) && String(id).length > 0;
}

export function sanitizeForAI(text) {
  return String(text ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .slice(0, 2000);
}

export function validateStatus(status, allowed) {
  return allowed.includes(status);
}

export function validateLimit(raw, max = 100) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return Math.min(50, max);
  return Math.min(n, max);
}
