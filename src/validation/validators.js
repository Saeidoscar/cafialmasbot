export function isValidTelegramId(id) {
  return /^\d+$/.test(String(id)) && String(id).length > 0;
}

export function sanitizeText(text, maxLength = 4096) {
  return String(text ?? '').trim().slice(0, maxLength);
}

export function isValidJobId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0;
}

export { isValidJobId as validateJobId };

export function validateStatus(status, allowed) {
  return allowed.includes(status);
}

export function validateLimit(raw, max = 100) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return Math.min(50, max);
  return Math.min(n, max);
}

export function validateNationalId(value) {
  return /^\d{10}$/.test(String(value));
}

export function validateMobile(value) {
  return /^09\d{9}$/.test(String(value));
}

export function validateBirthDate(value) {
  return /^\d{4}\/\d{2}\/\d{2}$/.test(String(value));
}

export function validateSerialNumber(value) {
  return /^[A-Za-z\u0600-\u06FF]\d+$/.test(String(value));
}

export function validateTrackingCode(value) {
  return /^[A-Za-z0-9]{6,20}$/.test(String(value));
}
