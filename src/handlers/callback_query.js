// ─────────────────────────────────────────────
// src/handlers/callback_query.js — هندلر دکمه‌های شیشه‌ای ربات خدمات و مدیریت
// ─────────────────────────────────────────────

import { dbGet, dbRun, fromJSON } from '../lib/db.js';
import {
  SERVICES_CATALOG,
  SERVICE_CATEGORIES,
  ALL_SERVICE_CODES,
  TASK_NAME_FA,
  getServicesByCategory,
  formatPriceToman,
} from '../lib/services.js';
import { getFieldLabel } from '../lib/ai.js';
import {
  UsersRepository,
  ManagersRepository,
  TimeSlotsRepository,
  ScrapingJobsRepository,
  SupportTicketsRepository,
} from '../db/repository.js';
import { buildCustomerMainMenuKeyboard, startServiceFlow } from './message.js';
import { handleManagerCallbackQuery } from './manager.js';
import { safeError } from '../logging/logger.js';

function isValidJobId(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0;
}

function kb(rows) {
  return { inline_keyboard: rows };
}

async function ack(api, callbackQueryId, text = '') {
  try {
    await api.answerCallbackQuery({ callback_query_id: callbackQueryId, text });
  } catch {}
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

  const job = await dbGet(
    db,
    `SELECT * FROM scraping_jobs WHERE user_id = ? AND task_type = ?
     ORDER BY created_at DESC LIMIT 1`,
    [telegramId, taskType]
  );

  if (!job) {
    return editOrReply(api, cq, `ℹ️ هیچ درخواست ${taskNameFa} فعالی برای شما ثبت نشده است.`);
  }

  return renderJobDetailCard(api, db, cq, job);
}

async function renderJobDetailCard(api, db, cq, rawJob) {
  const job = {
    ...rawJob,
    payload: fromJSON(rawJob.payload, {}),
    result_data: fromJSON(rawJob.result_data, {}),
  };
  const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
  const statusEmoji = { PENDING: '⏳', PROCESSING: '⚙️', COMPLETED: '✅', FAILED: '❌' }[job.status] ?? '❓';
  const statusFa    = {
    PENDING:    'در صف انتظار',
    PROCESSING: 'در حال انجام توسط کارشناس',
    COMPLETED:  'با موفقیت تکمیل شد',
    FAILED:     'ناموفق / نیاز به اصلاح',
  }[job.status] ?? job.status;

  let managerInfo = '';
  if (job.assigned_manager_id) {
    const managersRepo = new ManagersRepository(db);
    const mgr = await managersRepo.findById(job.assigned_manager_id);
    if (mgr) managerInfo = `\n👨‍💼 کارشناس مسئول: <b>${mgr.display_name}</b>`;
  }

  let slotInfo = '';
  if (job.slot_id) {
    const slotsRepo = new TimeSlotsRepository(db);
    const slot = await slotsRepo.findById(job.slot_id);
    if (slot) slotInfo = `\n🕒 نوبت رزروشده: <code>${slot.slot_date} (${slot.start_time}-${slot.end_time})</code>`;
  }

  let resultSection = '';
  if (job.status === 'COMPLETED' && job.result_data?.summary) {
    resultSection = `\n\n🎉 <b>نتیجه و کد رهگیری:</b>\n<code>${job.result_data.summary}</code>`;
  }

  let errorSection = '';
  if (job.status === 'FAILED' && job.error_message) {
    errorSection = `\n\n⚠️ <b>جزئیات خطا:</b> ${job.error_message}`;
  }

  const ts = job.updated_at ? new Date(job.updated_at * 1000).toLocaleString('fa-IR') : '—';

  const text =
    `${statusEmoji} <b>وضعیت درخواست ${taskNameFa}</b>\n\n` +
    `🔢 شناسه: <b>#${job.id}</b>\n` +
    `📌 وضعیت: <b>${statusFa}</b>` +
    `${managerInfo}${slotInfo}\n` +
    `🕐 آخرین به‌روزرسانی: ${ts}` +
    `${resultSection}${errorSection}`;

  const keyboard = [];
  if (job.status === 'FAILED') {
    keyboard.push([{ text: '🔄 تلاش مجدد', callback_data: `RETRY_JOB:${job.id}` }]);
  }
  if (job.status === 'PENDING') {
    keyboard.push([{ text: '❌ لغو درخواست', callback_data: `CONFIRM_CANCEL:${job.id}` }]);
  }
  if (job.status === 'COMPLETED' && !job.rating) {
    keyboard.push([
      { text: '⭐ ۱', callback_data: `RATE_JOB:${job.id}:1` },
      { text: '⭐⭐ ۲', callback_data: `RATE_JOB:${job.id}:2` },
      { text: '⭐⭐⭐ ۳', callback_data: `RATE_JOB:${job.id}:3` },
      { text: '⭐⭐⭐⭐ ۴', callback_data: `RATE_JOB:${job.id}:4` },
      { text: '⭐⭐⭐⭐⭐ ۵', callback_data: `RATE_JOB:${job.id}:5` },
    ]);
  }
  keyboard.push([
    { text: '💬 پشتیبانی این درخواست', callback_data: `SUPPORT_JOB:${job.id}` },
    { text: '📋 همه درخواست‌ها', callback_data: 'MENU_MY_JOBS' },
  ]);
  keyboard.push([{ text: '🏠 منوی اصلی', callback_data: 'MENU_HOME' }]);

  await editOrReply(api, cq, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleConfirmCancel(api, db, cq, jobId) {
  await ack(api, cq.id);

  if (!isValidJobId(jobId)) {
    return editOrReply(api, cq, '❌ شناسه درخواست نامعتبر است.');
  }

  const telegramId = String(cq.from.id);
  const job = await dbGet(
    db,
    'SELECT * FROM scraping_jobs WHERE id = ? AND user_id = ?',
    [jobId, telegramId]
  );

  if (!job) return editOrReply(api, cq, '❌ درخواست یافت نشد یا متعلق به شما نیست.');
  if (job.status !== 'PENDING') {
    return editOrReply(api, cq, `⚠️ درخواست #${jobId} قابل لغو نیست (وضعیت: ${job.status})`);
  }

  await dbRun(
    db,
    `UPDATE scraping_jobs SET status='FAILED', error_message='لغو شده توسط کاربر.',
     updated_at=unixepoch() WHERE id=?`,
    [jobId]
  );
  await editOrReply(api, cq, `✅ درخواست #${jobId} با موفقیت لغو شد.`, {
    reply_markup: kb([[{ text: '🏠 منوی اصلی', callback_data: 'MENU_HOME' }]]),
  });
}

async function handleRetryJob(api, db, cq, jobId) {
  await ack(api, cq.id);

  if (!isValidJobId(jobId)) {
    return editOrReply(api, cq, '❌ شناسه درخواست نامعتبر است.');
  }

  const telegramId = String(cq.from.id);
  const job = await dbGet(
    db,
    'SELECT * FROM scraping_jobs WHERE id = ? AND user_id = ?',
    [jobId, telegramId]
  );

  if (!job) return editOrReply(api, cq, '❌ درخواست یافت نشد یا متعلق به شما نیست.');
  if (job.status !== 'FAILED') {
    return editOrReply(api, cq, `⚠️ تنها درخواست‌های ناموفق قابل تلاش مجدد هستند.`);
  }

  await dbRun(
    db,
    `UPDATE scraping_jobs SET status='PENDING', error_message=NULL,
     updated_at=unixepoch() WHERE id=?`,
    [jobId]
  );
  await editOrReply(
    api,
    cq,
    `🔄 درخواست #${jobId} مجدداً در صف پردازش قرار گرفت.\nکارشناس کافه به‌زودی آن را بررسی خواهد کرد.`,
    { reply_markup: kb([[{ text: '📋 مشاهده وضعیت', callback_data: `JOB_VIEW:${jobId}` }]]) }
  );
}

export async function handleCallbackQuery(api, db, cq, env = null, managerApi = null) {
  const data = cq?.data;
  if (!data) return ack(api, cq.id, 'خطای ناشناخته.');

  // Delegate Manager Bot callbacks (`MGR_*`)
  if (data.startsWith('MGR_')) {
    return handleManagerCallbackQuery(managerApi ?? api, db, cq, env, api);
  }

  const parts  = data.split(':');
  const action = parts[0];
  const param1 = parts[1] ?? '';
  const param2 = parts[2] ?? '';

  const telegramId = String(cq.from?.id ?? '');
  const username   = cq.from?.username ?? cq.from?.first_name ?? 'user';
  const usersRepo  = new UsersRepository(db);
  const slotsRepo  = new TimeSlotsRepository(db);
  const jobsRepo   = new ScrapingJobsRepository(db);
  const managersRepo = new ManagersRepository(db);
  const ticketsRepo  = new SupportTicketsRepository(db);

  try {
    switch (action) {
      case 'STATUS_CHECK':
        return handleStatusCheck(api, db, cq, param1);

      case 'CONFIRM_CANCEL':
        return handleConfirmCancel(api, db, cq, param1);

      case 'RETRY_JOB':
        return handleRetryJob(api, db, cq, param1);

      case 'FLOW_CANCEL': {
        await ack(api, cq.id, 'عملیات لغو شد');
        await usersRepo.updateState(telegramId, 'START', {});
        return editOrReply(api, cq, '✅ عملیات جاری لغو شد.', {
          reply_markup: buildCustomerMainMenuKeyboard(),
        });
      }

      case 'MENU_HOME': {
        await ack(api, cq.id);
        await usersRepo.updateState(telegramId, 'START', {});
        return editOrReply(
          api,
          cq,
          `🏠 <b>منوی اصلی سامانه خدمات کافه الماس</b>\nلطفاً بخش مورد نظر خود را انتخاب کنید:`,
          { parse_mode: 'HTML', reply_markup: buildCustomerMainMenuKeyboard() }
        );
      }

      case 'MENU_SERVICES': {
        await ack(api, cq.id);
        const catRows = Object.values(SERVICE_CATEGORIES).map((cat) => [
          { text: cat.title, callback_data: `MENU_CAT:${cat.code}` },
        ]);
        catRows.push([{ text: '📋 نمایش همه ۹ سرویس یکجا', callback_data: 'MENU_ALL_SERVICES' }]);
        catRows.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'MENU_HOME' }]);
        return editOrReply(
          api,
          cq,
          `🛎 <b>کاتالوگ خدمات کافه هوشمند الماس</b>\nلطفاً دسته‌بندی مورد نظر را انتخاب کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(catRows) }
        );
      }

      case 'MENU_ALL_SERVICES': {
        await ack(api, cq.id);
        const rows = [];
        for (let i = 0; i < ALL_SERVICE_CODES.length; i += 2) {
          const pair = ALL_SERVICE_CODES.slice(i, i + 2).map((code) => {
            const s = SERVICES_CATALOG[code];
            return { text: `${s.icon} ${s.nameFa.split('(')[0].trim()}`, callback_data: `SVC_INFO:${code}` };
          });
          rows.push(pair);
        }
        rows.push([{ text: '🔙 بازگشت به دسته‌بندی‌ها', callback_data: 'MENU_SERVICES' }]);
        return editOrReply(
          api,
          cq,
          `📋 <b>فهرست کامل ۹ سرویس فعال کافه الماس</b>\nروی سرویس مورد نظر کلیک کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
      }

      case 'MENU_CAT': {
        await ack(api, cq.id);
        const cat = SERVICE_CATEGORIES[param1];
        const list = getServicesByCategory(param1);
        const rows = list.map((s) => [
          {
            text: `${s.icon} ${s.nameFa} — ${formatPriceToman(s.priceToman)}`,
            callback_data: `SVC_INFO:${s.code}`,
          },
        ]);
        rows.push([{ text: '🔙 بازگشت به دسته‌بندی‌ها', callback_data: 'MENU_SERVICES' }]);
        return editOrReply(
          api,
          cq,
          `${cat?.title ?? 'خدمات'}\n${cat?.desc ?? ''}\n\nسرویس مورد نظر را انتخاب کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
      }

      case 'SVC_INFO': {
        await ack(api, cq.id);
        const svc = SERVICES_CATALOG[param1];
        if (!svc) return;
        const fieldsList = svc.requiredFields.map((f) => `  • ${getFieldLabel(f)}`).join('\n');
        const openSlots = await slotsRepo.listOpenSlots(svc.code, 5);
        const activeMgrs = await managersRepo.listActive(svc.code);

        const text =
          `${svc.icon} <b>${svc.nameFa}</b>\n` +
          `🌐 درگاه: <code>${svc.portalUrl}</code>\n` +
          `📝 توضیحات: ${svc.description}\n\n` +
          `💰 تعرفه خدمات: <b>${formatPriceToman(svc.priceToman)}</b>\n` +
          `⏱ زمان انجام: حدود <b>${svc.estimatedMinutes} دقیقه</b>\n` +
          `👨‍💼 کارشناسان آنلاین این سرویس: <b>${activeMgrs.length} نفر</b>\n` +
          `🕒 نوبت‌های زمانی آزاد: <b>${openSlots.length} نوبت</b>\n\n` +
          `📋 <b>مدارک و اطلاعات مورد نیاز:</b>\n${fieldsList}`;

        return editOrReply(api, cq, text, {
          parse_mode: 'HTML',
          reply_markup: kb([
            [{ text: '⚡ شروع فوری و ثبت در صف آنلاین', callback_data: `SVC_START_NOW:${svc.code}` }],
            [{ text: `🕒 انتخاب کارشناس و ساعت نوبت (${openSlots.length})`, callback_data: `SVC_PICK_SLOT:${svc.code}` }],
            [{ text: '🔙 بازگشت به کاتالوگ خدمات', callback_data: 'MENU_SERVICES' }],
          ]),
        });
      }

      case 'SVC_START_NOW': {
        await ack(api, cq.id, `شروع سرویس ${TASK_NAME_FA[param1] ?? param1}`);
        const user = await usersRepo.getOrCreate(telegramId, username);
        return startServiceFlow(
          api,
          db,
          cq.message.chat.id,
          telegramId,
          user,
          param1,
          null,
          null,
          env,
          managerApi
        );
      }

      case 'SVC_PICK_SLOT': {
        await ack(api, cq.id);
        const taskType = param1;
        const openSlots = await slotsRepo.listOpenSlots(taskType, 10);
        if (!openSlots.length) {
          return editOrReply(
            api,
            cq,
            `ℹ️ در حال حاضر نوبت زمان‌بندی‌شده خاصی برای <b>${TASK_NAME_FA[taskType] ?? taskType}</b> ثبت نشده است.\n` +
              `می‌توانید درخواست خود را به صورت <b>⚡ فوری</b> ثبت کنید تا اولین کارشناس آنلاین آن را انجام دهد:`,
            {
              parse_mode: 'HTML',
              reply_markup: kb([
                [{ text: '⚡ ثبت فوری درخواست', callback_data: `SVC_START_NOW:${taskType}` }],
                [{ text: '🔙 بازگشت', callback_data: `SVC_INFO:${taskType}` }],
              ]),
            }
          );
        }

        const rows = openSlots.map((s) => [
          {
            text: `📅 ${s.slot_date} | 🕒 ${s.start_time}-${s.end_time} | 👤 ${s.manager_name || 'کارشناس'}`,
            callback_data: `BOOK_SLOT:${s.id}:${taskType}`,
          },
        ]);
        rows.push([{ text: '⚡ ثبت فوری بدون نوبت', callback_data: `SVC_START_NOW:${taskType}` }]);
        rows.push([{ text: '🔙 بازگشت', callback_data: `SVC_INFO:${taskType}` }]);

        return editOrReply(
          api,
          cq,
          `🕒 <b>انتخاب نوبت زمانی برای ${TASK_NAME_FA[taskType] ?? taskType}</b>\n` +
            `یکی از نوبت‌های آزاد کارشناسان را انتخاب کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
      }

      case 'MENU_SLOTS': {
        await ack(api, cq.id);
        const openSlots = await slotsRepo.listOpenSlots('ALL', 10);
        if (!openSlots.length) {
          return editOrReply(
            api,
            cq,
            `🕒 در حال حاضر نوبت زمان‌بندی‌شده‌ای توسط کارشناسان ثبت نشده است، اما صف فوری آنلاین فعال است.`,
            {
              reply_markup: kb([
                [{ text: '🛎 انتخاب سرویس (صف فوری)', callback_data: 'MENU_SERVICES' }],
                [{ text: '🔙 منوی اصلی', callback_data: 'MENU_HOME' }],
              ]),
            }
          );
        }
        const rows = openSlots.map((s) => [
          {
            text: `📅 ${s.slot_date} | 🕒 ${s.start_time}-${s.end_time} | 👤 ${s.manager_name || 'کارشناس'}`,
            callback_data: `SLOT_CHOOSE_SVC:${s.id}`,
          },
        ]);
        rows.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'MENU_HOME' }]);
        return editOrReply(
          api,
          cq,
          `🕒 <b>نوبت‌های زمانی آزاد کارشناسان</b>\nنوبت دلخواه خود را انتخاب کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
      }

      case 'SLOT_CHOOSE_SVC': {
        await ack(api, cq.id);
        const slotId = param1;
        const slot = await slotsRepo.findById(Number(slotId));
        if (!slot) return editOrReply(api, cq, '❌ این نوبت دیگر در دسترس نیست.');

        const rows = [];
        for (let i = 0; i < ALL_SERVICE_CODES.length; i += 2) {
          const pair = ALL_SERVICE_CODES.slice(i, i + 2).map((code) => ({
            text: `${SERVICES_CATALOG[code].icon} ${SERVICES_CATALOG[code].nameFa.split('(')[0].trim()}`,
            callback_data: `BOOK_SLOT:${slotId}:${code}`,
          }));
          rows.push(pair);
        }
        rows.push([{ text: '🔙 بازگشت به نوبت‌ها', callback_data: 'MENU_SLOTS' }]);

        return editOrReply(
          api,
          cq,
          `🕒 <b>نوبت انتخابی: ${slot.slot_date} ساعت ${slot.start_time} تا ${slot.end_time}</b>\n` +
            `👨‍💼 کارشناس: <b>${slot.manager_name || 'کارشناس کافه'}</b>\n\n` +
            `حالا سرویس مورد نظر خود برای این نوبت را انتخاب کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
      }

      case 'BOOK_SLOT': {
        const slotId = Number(param1);
        const taskType = param2;
        const slot = await slotsRepo.findById(slotId);
        if (!slot || slot.status !== 'OPEN' || slot.booked_count >= slot.capacity) {
          await ack(api, cq.id, '⚠️ ظرفیت این نوبت تکمیل شده است.');
          return;
        }
        await ack(api, cq.id, '✅ نوبت انتخاب شد! لطفاً اطلاعات فرم را تکمیل کنید.');
        const user = await usersRepo.getOrCreate(telegramId, username);
        return startServiceFlow(
          api,
          db,
          cq.message.chat.id,
          telegramId,
          user,
          taskType,
          slot.id,
          slot.manager_id,
          env,
          managerApi
        );
      }

      case 'MENU_MY_JOBS': {
        await ack(api, cq.id);
        const jobs = await jobsRepo.findByUser(telegramId, 10);
        if (!jobs.length) {
          return editOrReply(
            api,
            cq,
            `ℹ️ شما هنوز هیچ درخواستی ثبت نکرده‌اید.`,
            {
              reply_markup: kb([
                [{ text: '🛎 ثبت اولین درخواست', callback_data: 'MENU_SERVICES' }],
                [{ text: '🔙 منوی اصلی', callback_data: 'MENU_HOME' }],
              ]),
            }
          );
        }
        const statusEmoji = { PENDING: '⏳', PROCESSING: '⚙️', COMPLETED: '✅', FAILED: '❌' };
        const rows = jobs.map((j) => [
          {
            text: `${statusEmoji[j.status] ?? '📌'} #${j.id} — ${TASK_NAME_FA[j.task_type] ?? j.task_type}`,
            callback_data: `JOB_VIEW:${j.id}`,
          },
        ]);
        rows.push([{ text: '🔙 منوی اصلی', callback_data: 'MENU_HOME' }]);
        return editOrReply(
          api,
          cq,
          `📋 <b>درخواست‌ها و نتایج شما (${jobs.length} مورد اخیر):</b>\nروی هر درخواست کلیک کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
      }

      case 'JOB_VIEW': {
        await ack(api, cq.id);
        const job = await dbGet(
          db,
          'SELECT * FROM scraping_jobs WHERE id = ? AND user_id = ?',
          [Number(param1), telegramId]
        );
        if (!job) return editOrReply(api, cq, '❌ درخواست یافت نشد.');
        return renderJobDetailCard(api, db, cq, job);
      }

      case 'RATE_JOB': {
        const jobId = Number(param1);
        const stars = Math.min(5, Math.max(1, Number(param2)));
        const job = await jobsRepo.findById(jobId);
        if (!job || String(job.user_id) !== telegramId) {
          return ack(api, cq.id, 'درخواست یافت نشد.');
        }
        await jobsRepo.rateJob(jobId, stars);
        if (job.assigned_manager_id) {
          await managersRepo.recordRating(job.assigned_manager_id, stars);
        }
        await ack(api, cq.id, `🌟 امتیاز ${stars} ستاره شما ثبت شد. سپاسگزاریم!`);
        return editOrReply(
          api,
          cq,
          `🌟 <b>سپاس از همراهی شما!</b>\nامتیاز <b>${'⭐'.repeat(stars)} (${stars}/5)</b> برای درخواست #${jobId} ثبت گردید.`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([
              [
                { text: '📋 درخواست‌های من', callback_data: 'MENU_MY_JOBS' },
                { text: '🏠 منوی اصلی', callback_data: 'MENU_HOME' },
              ],
            ]),
          }
        );
      }

      case 'MENU_MY_DOCS': {
        await ack(api, cq.id);
        const user = await usersRepo.getOrCreate(telegramId, username);
        const docs = user.documents ?? {};
        const keys = Object.keys(docs);
        const body = keys.length
          ? keys.map((k) => `  • <b>${getFieldLabel(k)} (${k})</b>: <code>${docs[k]}</code>`).join('\n')
          : '<i>هنوز مدرکی ذخیره نکرده‌اید.</i>\n\nمثال ذخیره مدرک:\n<code>/add_doc national_id 0012345678</code>\n<code>/add_doc mobile_number 09123456789</code>';
        return editOrReply(
          api,
          cq,
          `📂 <b>صندوق مدارک ذخیره‌شده شما</b>\nمدارک ذخیره‌شده به صورت خودکار در فرم سرویس‌ها پر می‌شوند:\n\n${body}`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'MENU_HOME' }]]),
          }
        );
      }

      case 'MENU_SUPPORT': {
        await ack(api, cq.id);
        await usersRepo.updateState(telegramId, 'SUPPORT_CREATING', {});
        return editOrReply(
          api,
          cq,
          `💬 <b>پشتیبانی آنلاین و ارتباط با کارشناس</b>\n\n` +
            `لطفاً پیام، سوال یا شماره درخواست خود را بنویسید و ارسال کنید تا کارشناسان پاسخ دهند:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 انصراف و بازگشت', callback_data: 'MENU_HOME' }]]),
          }
        );
      }

      case 'SUPPORT_JOB': {
        const jobId = Number(param1);
        await ack(api, cq.id);
        await usersRepo.updateState(telegramId, `SUPPORT_CREATING_JOB:${jobId}`, {});
        return editOrReply(
          api,
          cq,
          `💬 <b>ارسال پیام پشتیبانی برای درخواست #${jobId}</b>\n\n` +
            `لطفاً پیام، کد رهگیری یا سوال خود را برای کارشناس مسئول این درخواست بنویسید:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 بازگشت به درخواست', callback_data: `JOB_VIEW:${jobId}` }]]),
          }
        );
      }

      case 'SUPPORT_REPLY_USER': {
        const ticketId = Number(param1);
        await ack(api, cq.id);
        await usersRepo.updateState(telegramId, `SUPPORT_REPLYING:${ticketId}`, {});
        return editOrReply(
          api,
          cq,
          `✍️ لطفاً پاسخ خود برای <b>تیکت #${ticketId}</b> را بنویسید و ارسال کنید:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 انصراف', callback_data: 'MENU_HOME' }]]),
          }
        );
      }

      case 'SUPPORT_CLOSE_USER': {
        const ticketId = Number(param1);
        await ticketsRepo.close(ticketId);
        await ack(api, cq.id, 'تیکت بسته شد');
        return editOrReply(api, cq, `✅ تیکت پشتیبانی #${ticketId} بسته شد.`, {
          reply_markup: kb([[{ text: '🏠 منوی اصلی', callback_data: 'MENU_HOME' }]]),
        });
      }

      case 'USER_REPLY_JOB': {
        const jobId = Number(param1);
        await ack(api, cq.id);
        await usersRepo.updateState(telegramId, `USER_REPLYING_JOB:${jobId}`, {});
        return editOrReply(
          api,
          cq,
          `✉️ لطفاً کد تایید یا پاسخ خود برای <b>درخواست #${jobId}</b> را ارسال کنید:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 انصراف', callback_data: 'MENU_HOME' }]]),
          }
        );
      }

      default:
        return ack(api, cq.id, 'عملیات ناشناخته است.');
    }
  } catch (err) {
    safeError('[CallbackQuery] خطا:', { action, error: err.message, stack: err.stack });
    await ack(api, cq.id, '⚠️ خطای سیستمی');
  }
}
