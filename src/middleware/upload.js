export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

export function validateUploadedFile(file) {
  if (!file) {
    return { ok: false, error: 'فایل ارسال نشده است.' };
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return { ok: false, error: 'حجم فایل نباید بیشتر از ۵ مگابایت باشد.' };
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.type)) {
    return { ok: false, error: 'نوع فایل مجاز نیست.' };
  }
  return { ok: true };
}
