// ─────────────────────────────────────────────
// handlers/callback_query.js — مسیریاب اکشن‌های کیبورد درون‌خطی
//
// SDK جدید tgcloud:
//   • پارامتر اول: شیء CallbackQuery (نه ctx)
//   • api از 'sdk' — کلاینت Bot API
//   • db  از 'sdk' — query builder
// ─────────────────────────────────────────────

import { api, db }                    from 'sdk';
import { eq, and, desc }              from 'sdk/db';
import { users, scrapingJobs }        from 'schema';

// ═══════════════════════════════════════════════
// ابزارها
// ═══════════════════════════════════════════════

function isValidJobId(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0;
}

async function ack(callbackQuery, text = '') {
  try {
    await api.answerCallbackQuery({ callback_query_id: callbackQuery.id, text });
  } catch { /* منقضی شده — غیربحرانی */ }
}

async function editOrReply(callbackQuery, text, extra = {}) {
  const chatId = callbackQuery.message?.chat?.id;
  const msgId  = callbackQuery.message?.message_id;
  try {
    await api.editMessageText({ chat_id: chatId, message_id: msgId, text, ...extra });
  } catch {
    await api.sendMessage({ chat_id: chatId, text, ...extra }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════
// هندلرهای اکشن
// ═══════════════════════════════════════════════

async function handleStatusCheck(callbackQuery, taskType) {
  await ack(callbackQuery);

  const telegramId = String(callbackQuery.from.id);
  const taskNameFa = taskType === 'SANA' ? 'سانا' : 'گیکا';

  const job = await db.select().from(scrapingJobs)
    .where(and(
      eq(scrapingJobs.userId,   telegramId),
      eq(scrapingJobs.taskType, taskType)
    ))
    .orderBy(desc(scrapingJobs.createdAt))
    .get();

  if (!job) {
    return editOrReply(
      callbackQuery,
      `ℹ️ هیچ درخواست ${taskNameFa} فعالی برای شما ثبت نشده است.`
    );
  }

  const statusEmoji = { PENDING: '⏳', PROCESSING: '⚙️', COMPLETED: '✅', FAILED: '❌' }[job.status] ?? '❓';
  const statusFa    = {
    PENDING:    'در صف انتظار',
    PROCESSING: 'در حال پردازش',
    COMPLETED:  'با موفقیت تکمیل شد',
    FAILED:     'ناموفق',
  }[job.status] ?? job.status;

  let text =
    `${statusEmoji} وضعیت درخواست ${taskNameFa}\n\n` +
    `🔢 شناسه: #${job.id}\n` +
    `📌 وضعیت: ${statusFa}\n` +
    `🕐 آخرین به‌روزرسانی: ${job.updatedAt ?? job.createdAt}`;

  if (job.status === 'FAILED' && job.errorMessage) {
    text += `\n\n⚠️ جزئیات خطا: ${job.errorMessage}`;
  }

  const keyboard = [];
  if (job.status === 'FAILED') {
    keyboard.push([{ text: '🔄 تلاش مجدد', callback_data: `RETRY_JOB:${job.id}` }]);
  }
  if (job.status === 'PENDING') {
    keyboard.push([{ text: '❌ لغو درخواست', callback_data: `CONFIRM_CANCEL:${job.id}` }]);
  }

  await editOrReply(
    callbackQuery, text,
    keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}
  );
}

async function handleConfirmCancel(callbackQuery, jobId) {
  await ack(callbackQuery);

  if (!isValidJobId(jobId)) {
    return editOrReply(callbackQuery, '❌ شناسه درخواست نامعتبر است.');
  }

  const telegramId = String(callbackQuery.from.id);
  const job = await db.select().from(scrapingJobs)
    .where(and(eq(scrapingJobs.id, Number(jobId)), eq(scrapingJobs.userId, telegramId)))
    .get();

  if (!job) {
    return editOrReply(callbackQuery, '❌ درخواست یافت نشد یا متعلق به شما نیست.');
  }

  if (job.status !== 'PENDING') {
    const statusFa = {
      PROCESSING: 'در حال پردازش',
      COMPLETED:  'تکمیل‌شده',
      FAILED:     'ناموفق',
    }[job.status] ?? job.status;
    return editOrReply(
      callbackQuery,
      `⚠️ درخواست #${jobId} در حال حاضر «${statusFa}» است و امکان لغو آن وجود ندارد.`
    );
  }

  await db.update(scrapingJobs)
    .set({ status: 'FAILED', errorMessage: 'لغو شده توسط کاربر.', updatedAt: new Date() })
    .where(eq(scrapingJobs.id, Number(jobId)))
    .run();

  await editOrReply(callbackQuery, `✅ درخواست #${jobId} با موفقیت لغو شد.`);
}

async function handleRetryJob(callbackQuery, jobId) {
  await ack(callbackQuery);

  if (!isValidJobId(jobId)) {
    return editOrReply(callbackQuery, '❌ شناسه درخواست نامعتبر است.');
  }

  const telegramId = String(callbackQuery.from.id);
  const job = await db.select().from(scrapingJobs)
    .where(and(eq(scrapingJobs.id, Number(jobId)), eq(scrapingJobs.userId, telegramId)))
    .get();

  if (!job) {
    return editOrReply(callbackQuery, '❌ درخواست یافت نشد یا متعلق به شما نیست.');
  }

  if (job.status !== 'FAILED') {
    return editOrReply(
      callbackQuery,
      `⚠️ تنها درخواست‌های ناموفق قابل تلاش مجدد هستند.\nوضعیت فعلی: ${job.status}`
    );
  }

  await db.update(scrapingJobs)
    .set({ status: 'PENDING', errorMessage: null, updatedAt: new Date() })
    .where(eq(scrapingJobs.id, Number(jobId)))
    .run();

  await editOrReply(
    callbackQuery,
    `🔄 درخواست #${jobId} مجدداً در صف پردازش قرار گرفت.\n` +
    `کارمند کافه به‌زودی آن را پردازش خواهد کرد.`
  );
}

// ═══════════════════════════════════════════════
// صادرات اصلی — نقطه ورودی tgcloud
// ═══════════════════════════════════════════════

export default async function (callbackQuery) {
  const data = callbackQuery?.data;
  if (!data) return ack(callbackQuery, 'خطای ناشناخته.');

  const colonIdx = data.indexOf(':');
  const action   = colonIdx >= 0 ? data.slice(0, colonIdx) : data;
  const param    = colonIdx >= 0 ? data.slice(colonIdx + 1) : '';

  try {
    switch (action) {
      case 'STATUS_CHECK':    return handleStatusCheck(callbackQuery, param);
      case 'CONFIRM_CANCEL':  return handleConfirmCancel(callbackQuery, param);
      case 'RETRY_JOB':       return handleRetryJob(callbackQuery, param);
      default:
        console.warn('[CallbackQuery] اکشن ناشناخته:', action);
        return ack(callbackQuery, 'عملیات ناشناخته است.');
    }
  } catch (err) {
    console.error('[CallbackQuery] خطا:', action, err);
    await ack(callbackQuery, '⚠️ خطای سیستمی');
    await api.sendMessage({
      chat_id: callbackQuery.message?.chat?.id,
      text:    '⚠️ خطایی رخ داد. لطفاً دوباره تلاش کنید.',
    }).catch(() => {});
  }
}
