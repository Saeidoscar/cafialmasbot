// ─────────────────────────────────────────────
// handlers/callback_query.js — هندلر دکمه‌های inline
// ─────────────────────────────────────────────

import { dbGet, dbRun } from '../lib/db.js';
import { safeError } from '../logging/logger.js';

function isValidJobId(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0;
}

const TASK_NAME_FA = {
  SANA: 'سانا',
  GICA: 'گیکا',
  MYGOV: 'my.gov.ir',
  TAX: 'my.tax.gov.ir',
  INSURANCE: 'eservice.tamin.ir',
  MOJAVEZ: 'mojavez.ir',
  AMLAK: 'amlak.mrud.ir',
  KHODNEWIS: 'khodnevis.mrud.ir',
  SAMAN: 'saman.mrud.ir',
};

async function ack(api, callbackQueryId, text = '') {
  try { await api.answerCallbackQuery({ callback_query_id: callbackQueryId, text }); } catch {}
}

async function editOrReply(api, cq, text, extra = {}) {
  const chatId = cq.message?.chat?.id;
  const msgId  = cq.message?.message_id;
  try {
    await api.editMessageText({ chat_id: chatId, message_id: msgId, text, ...extra });
  } catch {
    await api.sendMessage({ chat_id: chatId, text, ...extra }).catch(() => {});
  }
}

async function handleStatusCheck(api, db, cq, taskType) {
  await ack(api, cq.id);
  const telegramId = String(cq.from.id);
  const taskNameFa = TASK_NAME_FA[taskType] ?? taskType;

  const job = dbGet(db,
    `SELECT * FROM scraping_jobs WHERE user_id = ? AND task_type = ?
     ORDER BY created_at DESC LIMIT 1`,
    [telegramId, taskType]);

  if (!job) {
    return editOrReply(api, cq, `ℹ️ هیچ درخواست ${taskNameFa} فعالی برای شما ثبت نشده است.`);
  }

  const statusEmoji = { PENDING: '⏳', PROCESSING: '⚙️', COMPLETED: '✅', FAILED: '❌' }[job.status] ?? '❓';
  const statusFa    = {
    PENDING: 'در صف انتظار', PROCESSING: 'در حال پردازش',
    COMPLETED: 'با موفقیت تکمیل شد', FAILED: 'ناموفق',
  }[job.status] ?? job.status;

  let text =
    `${statusEmoji} وضعیت درخواست ${taskNameFa}\n\n` +
    `🔢 شناسه: #${job.id}\n` +
    `📌 وضعیت: ${statusFa}\n` +
    `🕐 آخرین به‌روزرسانی: ${new Date(job.updated_at * 1000).toLocaleString('fa-IR')}`;

  if (job.status === 'FAILED' && job.error_message) {
    text += `\n\n⚠️ جزئیات خطا: ${job.error_message}`;
  }

  const keyboard = [];
  if (job.status === 'FAILED')  keyboard.push([{ text: '🔄 تلاش مجدد',  callback_data: `RETRY_JOB:${job.id}` }]);
  if (job.status === 'PENDING') keyboard.push([{ text: '❌ لغو درخواست', callback_data: `CONFIRM_CANCEL:${job.id}` }]);

  await editOrReply(api, cq, text,
    keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {});
}

async function handleConfirmCancel(api, db, cq, jobId) {
  await ack(api, cq.id);

  if (!isValidJobId(jobId)) {
    return editOrReply(api, cq, '❌ شناسه درخواست نامعتبر است.');
  }

  const telegramId = String(cq.from.id);
  const job = dbGet(db,
    'SELECT * FROM scraping_jobs WHERE id = ? AND user_id = ?', [jobId, telegramId]);

  if (!job) return editOrReply(api, cq, '❌ درخواست یافت نشد یا متعلق به شما نیست.');
  if (job.status !== 'PENDING') {
    return editOrReply(api, cq, `⚠️ درخواست #${jobId} قابل لغو نیست (وضعیت: ${job.status})`);
  }

  dbRun(db,
    `UPDATE scraping_jobs SET status='FAILED', error_message='لغو شده توسط کاربر.',
     updated_at=unixepoch() WHERE id=?`, [jobId]);
  await editOrReply(api, cq, `✅ درخواست #${jobId} با موفقیت لغو شد.`);
}

async function handleRetryJob(api, db, cq, jobId) {
  await ack(api, cq.id);

  if (!isValidJobId(jobId)) {
    return editOrReply(api, cq, '❌ شناسه درخواست نامعتبر است.');
  }

  const telegramId = String(cq.from.id);
  const job = dbGet(db,
    'SELECT * FROM scraping_jobs WHERE id = ? AND user_id = ?', [jobId, telegramId]);

  if (!job) return editOrReply(api, cq, '❌ درخواست یافت نشد یا متعلق به شما نیست.');
  if (job.status !== 'FAILED') {
    return editOrReply(api, cq, `⚠️ تنها درخواست‌های ناموفق قابل تلاش مجدد هستند.`);
  }

  dbRun(db,
    `UPDATE scraping_jobs SET status='PENDING', error_message=NULL,
     updated_at=unixepoch() WHERE id=?`, [jobId]);
  await editOrReply(api, cq,
    `🔄 درخواست #${jobId} مجدداً در صف پردازش قرار گرفت.\nکارمند کافه به‌زودی آن را پردازش خواهد کرد.`);
}

export async function handleCallbackQuery(api, db, cq) {
  const data = cq?.data;
  if (!data) return ack(api, cq.id, 'خطای ناشناخته.');

  const colonIdx = data.indexOf(':');
  const action   = colonIdx >= 0 ? data.slice(0, colonIdx) : data;
  const param    = colonIdx >= 0 ? data.slice(colonIdx + 1) : '';

  try {
    switch (action) {
      case 'STATUS_CHECK':   return handleStatusCheck(api, db, cq, param);
      case 'CONFIRM_CANCEL': return handleConfirmCancel(api, db, cq, param);
      case 'RETRY_JOB':      return handleRetryJob(api, db, cq, param);
      default:
        return ack(api, cq.id, 'عملیات ناشناخته است.');
    }
  } catch (err) {
    safeError('[CallbackQuery] خطا:', { action, error: err.message, stack: err.stack });
    await ack(api, cq.id, '⚠️ خطای سیستمی');
  }
}
