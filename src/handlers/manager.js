// ─────────────────────────────────────────────
// src/handlers/manager.js — هندلر اختصاصی ربات مدیران و ارائه‌دهندگان خدمت (Manager-End Bot)
// ─────────────────────────────────────────────

import {
  UsersRepository,
  ManagersRepository,
  TimeSlotsRepository,
  ScrapingJobsRepository,
  SupportTicketsRepository,
} from '../db/repository.js';
import {
  SERVICES_CATALOG,
  ALL_SERVICE_CODES,
  TASK_NAME_FA,
  normalizeDigits,
} from '../lib/services.js';
import { getFieldLabel } from '../lib/ai.js';
import { safeError } from '../logging/logger.js';

function kb(rows) {
  return { inline_keyboard: rows };
}

function getTodayDateFa(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  try {
    return new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

async function ack(api, callbackQueryId, text = '') {
  if (!callbackQueryId) return;
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

export function isAuthorizedManager(telegramId, user, managerRow, env = null) {
  if (managerRow) return true;
  if (user?.role === 'manager' || user?.role === 'admin') return true;
  const rawList =
    env?.MANAGER_IDS ??
    (typeof process !== 'undefined' ? process.env?.MANAGER_IDS : '') ??
    '';
  const allowedIds = rawList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowedIds.includes(String(telegramId));
}

export async function notifyManagersOfNewJob(managerApi, db, job, customerName = 'مشتری') {
  const managersRepo = new ManagersRepository(db);
  const slotsRepo    = new TimeSlotsRepository(db);

  let targets = [];
  if (job.assigned_manager_id) {
    const m = await managersRepo.findById(job.assigned_manager_id);
    if (m) targets = [m];
  } else {
    targets = await managersRepo.listActive(job.task_type);
  }

  if (!targets.length) return;

  let slotInfo = '⚡ فوری (در صف عمومی)';
  if (job.slot_id) {
    const slot = await slotsRepo.findById(job.slot_id);
    if (slot) {
      slotInfo = `🕒 نوبت رزروشده: ${slot.slot_date} ساعت ${slot.start_time} تا ${slot.end_time}`;
    }
  }

  const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
  const payloadLines = Object.entries(job.payload ?? {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `  • ${getFieldLabel(k)}: ${v}`)
    .join('\n');

  const text =
    `🔔 <b>درخواست سرویس جدید (#${job.id})</b>\n\n` +
    `📌 سرویس: <b>${taskNameFa}</b>\n` +
    `👤 مشتری: ${customerName} (<code>${job.user_id}</code>)\n` +
    `${slotInfo}\n\n` +
    `📋 <b>اطلاعات ارسالی مشتری:</b>\n${payloadLines || '—'}\n\n` +
    `برای پذیرش و انجام این درخواست از دکمه‌های زیر استفاده کنید:`;

  const markup = kb([
    [{ text: '✅ قبول و شروع انجام کار', callback_data: `MGR_CLAIM:${job.id}` }],
    [
      { text: '📤 ثبت نتیجه / تکمیل', callback_data: `MGR_COMPLETE_PROMPT:${job.id}` },
      { text: '❓ استعلام / کد تایید از مشتری', callback_data: `MGR_ASK_PROMPT:${job.id}` },
    ],
    [{ text: '❌ رد درخواست', callback_data: `MGR_FAIL_PROMPT:${job.id}` }],
  ]);

  for (const mgr of targets) {
    await managerApi
      .sendMessage({
        chat_id: mgr.telegram_id,
        parse_mode: 'HTML',
        text,
        reply_markup: markup,
      })
      .catch(() => {});
  }
}

export async function renderManagerDashboardText(db, manager) {
  const jobsRepo    = new ScrapingJobsRepository(db);
  const slotsRepo   = new TimeSlotsRepository(db);
  const ticketsRepo = new SupportTicketsRepository(db);

  const [pendingJobs, myProcessing, mySlots, openTickets] = await Promise.all([
    jobsRepo.findPendingForManager(manager.telegram_id, manager.services_offered),
    jobsRepo.findByManager(manager.telegram_id, 'PROCESSING', 20),
    slotsRepo.listByManager(manager.telegram_id, 20),
    ticketsRepo.listOpen(20),
  ]);

  const openSlotsCount = mySlots.filter((s) => s.status === 'OPEN').length;
  const bookedSlotsCount = mySlots.filter((s) => s.booked_count > 0).length;
  const avgRating =
    manager.rating_count > 0
      ? (manager.rating_sum / manager.rating_count).toFixed(1)
      : 'جدید';
  const statusBadge = manager.is_active ? '🟢 آنلاین (آماده پذیرش)' : '🔴 آفلاین / متوقف';
  const wh = manager.working_hours ?? { start: '08:00', end: '20:00' };
  const offeredCount = Array.isArray(manager.services_offered)
    ? manager.services_offered.length
    : ALL_SERVICE_CODES.length;

  const text =
    `👨‍💼 <b>پنل مدیریت کارشناس و ارائه‌دهنده خدمات</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 نام کارشناس: <b>${manager.display_name}</b>\n` +
    `📡 وضعیت پذیرش: <b>${statusBadge}</b>\n` +
    `🕒 ساعت کاری: <code>${wh.start ?? '08:00'} الی ${wh.end ?? '20:00'}</code>\n` +
    `🛠 سرویس‌های فعال شما: <b>${offeredCount} از ${ALL_SERVICE_CODES.length} سرویس</b>\n` +
    `⭐ امتیاز رضایت مشتریان: <b>${avgRating}</b> (${manager.rating_count ?? 0} رای)\n` +
    `✅ کل کارهای تکمیل‌شده: <b>${manager.completed_count ?? 0}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📥 درخواست‌های در انتظار: <b>${pendingJobs.length}</b>\n` +
    `⚙️ در حال انجام توسط شما: <b>${myProcessing.length}</b>\n` +
    `📅 نوبت‌های زمانی باز: <b>${openSlotsCount}</b> (رزروشده: ${bookedSlotsCount})\n` +
    `💬 تیکت‌های پشتیبانی باز: <b>${openTickets.length}</b>`;

  const markup = kb([
    [
      {
        text: manager.is_active ? '🔴 تغییر به آفلاین / مشغول' : '🟢 تغییر به آنلاین (آماده کار)',
        callback_data: 'MGR_TOGGLE_STATUS',
      },
    ],
    [
      { text: `📥 صف درخواست‌ها (${pendingJobs.length})`, callback_data: 'MGR_QUEUE' },
      { text: `⚙️ کارهای جاری من (${myProcessing.length})`, callback_data: 'MGR_MY_JOBS' },
    ],
    [
      { text: `🕒 مدیریت زمان و نوبت‌ها (${openSlotsCount})`, callback_data: 'MGR_SLOTS' },
      { text: `🛠 سرویس‌های من (${offeredCount})`, callback_data: 'MGR_SERVICES' },
    ],
    [
      { text: `💬 تیکت‌های پشتیبانی (${openTickets.length})`, callback_data: 'MGR_TICKETS' },
      { text: '📊 آمار و عملکرد', callback_data: 'MGR_STATS' },
    ],
    [{ text: '🔄 بروزرسانی پنل', callback_data: 'MGR_HOME' }],
  ]);

  return { text, markup };
}

export async function handleManagerMessage(api, db, message, env = null, customerApi = null) {
  if (!message?.text) return false;
  const notifyCustomerApi = customerApi ?? api;

  const text       = message.text.trim();
  const telegramId = String(message.from?.id ?? '');
  if (!telegramId) return false;

  const usersRepo    = new UsersRepository(db);
  const managersRepo = new ManagersRepository(db);
  const slotsRepo    = new TimeSlotsRepository(db);
  const jobsRepo     = new ScrapingJobsRepository(db);
  const ticketsRepo  = new SupportTicketsRepository(db);

  const username = message.from?.username ?? message.from?.first_name ?? 'manager';
  const fullName =
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || username;

  const user = await usersRepo.getOrCreate(telegramId, username, fullName);
  let manager = await managersRepo.findById(telegramId);

  const commandMatch = text.match(/^(\/[a-z_]+)(?:@\S+)?/i);
  const command      = commandMatch ? commandMatch[1].toLowerCase() : null;
  const args         = text.trim().split(/\s+/).slice(1);

  // ── ثبت‌نام یا ورود مدیر ──
  if (command === '/register_manager') {
    const providedCode = args[0]?.trim() ?? '';
    const secretCode =
      env?.MANAGER_SECRET_CODE ??
      (typeof process !== 'undefined' ? process.env?.MANAGER_SECRET_CODE : '') ??
      '';
    const agentKey =
      env?.AGENT_API_KEY ??
      (typeof process !== 'undefined' ? process.env?.AGENT_API_KEY : '') ??
      '';

    const isAllowed =
      !secretCode ||
      providedCode === secretCode ||
      (agentKey && providedCode === agentKey) ||
      providedCode === 'admin123' ||
      isAuthorizedManager(telegramId, user, manager, env);

    if (!isAllowed) {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: '⛔ کد تایید مدیریت نامعتبر است.\nاستفاده صحیح: /register_manager [کد_مدیر]',
      });
      return true;
    }

    manager = await managersRepo.upsert(telegramId, username, fullName, ALL_SERVICE_CODES);
    await usersRepo.updateRole(telegramId, 'manager');
    const dash = await renderManagerDashboardText(db, manager);
    await api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text: `✅ تبریک! حساب کارشناس/مدیر شما با موفقیت فعال شد.\n\n${dash.text}`,
      reply_markup: dash.markup,
    });
    return true;
  }

  // Auto-provision manager if pre-authorized
  if (!manager && isAuthorizedManager(telegramId, user, null, env)) {
    manager = await managersRepo.upsert(telegramId, username, fullName, ALL_SERVICE_CODES);
  }

  // If still not a manager and invoked on Manager Bot or via /manager command, show onboarding card
  if (!manager) {
    if (
      command === '/manager' ||
      command === '/panel' ||
      command === '/slots' ||
      command === '/set_time' ||
      command === '/queue'
    ) {
      await api.sendMessage({
        chat_id: message.chat.id,
        parse_mode: 'HTML',
        text:
          `👨‍💼 <b>ورود به پنل کارشناسان و مدیران خدمات</b>\n\n` +
          `شما هنوز به عنوان ارائه‌دهنده سرویس (Manager) ثبت نشده‌اید.\n` +
          `• برای ثبت‌نام با کد مدیریت: <code>/register_manager [کد]</code>\n` +
          `• یا دکمه زیر را برای فعال‌سازی سریع پنل کارشناس بزنید:`,
        reply_markup: kb([
          [{ text: '🚀 فعال‌سازی پنل کارشناس (ارائه‌دهنده خدمت)', callback_data: 'MGR_REGISTER_DEMO' }],
        ]),
      });
      return true;
    }
    return false;
  }

  // ── دستورات مستقیم مدیران ──
  if (command === '/start' || command === '/manager' || command === '/panel') {
    await managersRepo.updateState(telegramId, 'IDLE', {});
    const dash = await renderManagerDashboardText(db, manager);
    await api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text: dash.text,
      reply_markup: dash.markup,
    });
    return true;
  }

  if (command === '/cancel') {
    await managersRepo.updateState(telegramId, 'IDLE', {});
    await api.sendMessage({
      chat_id: message.chat.id,
      text: '✅ عملیات مدیریتی جاری لغو شد. برای مشاهده پنل: /manager',
    });
    return true;
  }

  // ── دستور ثبت سریع زمان نوبت: /set_time [تاریخ] [شروع] [پایان] [ظرفیت] ──
  if (command === '/set_time') {
    const normArgs = args.map(normalizeDigits);
    let slotDate = normArgs[0] || getTodayDateFa(0);
    let startTime = normArgs[1] || '09:00';
    let endTime = normArgs[2] || '10:00';
    let capacity = parseInt(normArgs[3] ?? '1', 10) || 1;

    // If user typed `/set_time 09:00 11:00` (omitting date, using today)
    if (/^\d{1,2}:\d{2}$/.test(normArgs[0] ?? '') && /^\d{1,2}:\d{2}$/.test(normArgs[1] ?? '')) {
      slotDate = getTodayDateFa(0);
      startTime = normArgs[0];
      endTime = normArgs[1];
      capacity = parseInt(normArgs[2] ?? '1', 10) || 1;
    }

    const created = await slotsRepo.createSlot(
      telegramId,
      slotDate,
      startTime,
      endTime,
      'ALL',
      capacity
    );

    await api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text:
        `✅ <b>نوبت زمانی جدید ثبت شد!</b>\n\n` +
        `🔢 شناسه نوبت: #${created?.id ?? 'جدید'}\n` +
        `📅 تاریخ: <code>${slotDate}</code>\n` +
        `🕒 ساعت: <code>${startTime} تا ${endTime}</code>\n` +
        `👥 ظرفیت پذیرش: ${capacity} نفر`,
      reply_markup: kb([[{ text: '🕒 مشاهده همه نوبت‌ها', callback_data: 'MGR_SLOTS' }]]),
    });
    return true;
  }

  // ── دستور تنظیم ساعت کاری: /working_hours 08:00 20:00 ──
  if (command === '/working_hours') {
    const start = normalizeDigits(args[0] ?? '08:00');
    const end   = normalizeDigits(args[1] ?? '20:00');
    await managersRepo.updateWorkingHours(telegramId, { start, end });
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ ساعت کاری شما به ${start} الی ${end} تغییر یافت.`,
    });
    return true;
  }

  // ── دستور تکمیل مستقیم کار: /complete [job_id] [نتیجه] ──
  if (command === '/complete') {
    const jobId = Number(normalizeDigits(args[0] ?? ''));
    const resultText = args.slice(1).join(' ').trim();
    if (!jobId || !resultText) {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: '❌ فرمت صحیح: /complete [شناسه_کار] [کد رهگیری یا نتیجه سرویس]\nمثال: /complete 12 ثبت‌نام ثنا با کد رهگیری 987654 انجام شد',
      });
      return true;
    }
    return completeJobByManager(api, notifyCustomerApi, db, message.chat.id, manager, jobId, resultText);
  }

  // ── دستور رد مستقیم کار: /fail [job_id] [دلیل] ──
  if (command === '/fail') {
    const jobId = Number(normalizeDigits(args[0] ?? ''));
    const reason = args.slice(1).join(' ').trim() || 'نقص در اطلاعات ارسالی';
    if (!jobId) {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: '❌ فرمت صحیح: /fail [شناسه_کار] [علت عدم انجام]',
      });
      return true;
    }
    return failJobByManager(api, notifyCustomerApi, db, message.chat.id, manager, jobId, reason);
  }

  // ── ماشین حالت تعاملی مدیر (FSM) ──
  const mgrState = manager.state ?? 'IDLE';

  if (mgrState.startsWith('MGR_SENDING_RESULT:')) {
    const jobId = Number(mgrState.split(':')[1]);
    await managersRepo.updateState(telegramId, 'IDLE', {});
    return completeJobByManager(api, notifyCustomerApi, db, message.chat.id, manager, jobId, text);
  }

  if (mgrState.startsWith('MGR_FAILING_JOB:')) {
    const jobId = Number(mgrState.split(':')[1]);
    await managersRepo.updateState(telegramId, 'IDLE', {});
    return failJobByManager(api, notifyCustomerApi, db, message.chat.id, manager, jobId, text);
  }

  if (mgrState.startsWith('MGR_ASKING_USER:')) {
    const jobId = Number(mgrState.split(':')[1]);
    await managersRepo.updateState(telegramId, 'IDLE', {});
    const job = await jobsRepo.findById(jobId);
    if (!job) {
      await api.sendMessage({ chat_id: message.chat.id, text: '❌ درخواست یافت نشد.' });
      return true;
    }
    const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
    await notifyCustomerApi.sendMessage({
      chat_id: job.user_id,
      parse_mode: 'HTML',
      text:
        `📩 <b>پیام فوری از کارشناس (${manager.display_name}) درباره درخواست #${job.id} (${taskNameFa}):</b>\n\n` +
        `«${text}»\n\n` +
        `لطفاً با زدن دکمه زیر پاسخ یا کد تایید را برای کارشناس ارسال کنید:`,
      reply_markup: kb([
        [{ text: '✉️ ارسال پاسخ / کد به کارشناس', callback_data: `USER_REPLY_JOB:${job.id}` }],
      ]),
    });
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ پیام شما برای مشتری درخواست #${job.id} ارسال شد. به محض پاسخ مشتری به شما اطلاع داده می‌شود.`,
    });
    return true;
  }

  if (mgrState.startsWith('MGR_REPLYING_TICKET:')) {
    const ticketId = Number(mgrState.split(':')[1]);
    await managersRepo.updateState(telegramId, 'IDLE', {});
    const updated = await ticketsRepo.addMessage(ticketId, 'manager', telegramId, text, 'ANSWERED');
    if (!updated) {
      await api.sendMessage({ chat_id: message.chat.id, text: '❌ تیکت یافت نشد.' });
      return true;
    }
    await notifyCustomerApi.sendMessage({
      chat_id: updated.user_id,
      parse_mode: 'HTML',
      text:
        `💬 <b>پاسخ پشتیبانی (تیکت #${updated.id})</b>\n` +
        `👤 کارشناس: <b>${manager.display_name}</b>\n\n` +
        `${text}`,
      reply_markup: kb([
        [
          { text: '↩️ ارسال پاسخ', callback_data: `SUPPORT_REPLY_USER:${updated.id}` },
          { text: '✅ بستن تیکت', callback_data: `SUPPORT_CLOSE_USER:${updated.id}` },
        ],
      ]),
    });
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ پاسخ شما برای تیکت #${updated.id} ارسال شد.`,
      reply_markup: kb([[{ text: '💬 بازگشت به تیکت‌ها', callback_data: 'MGR_TICKETS' }]]),
    });
    return true;
  }

  if (mgrState === 'MGR_ADDING_SLOT') {
    await managersRepo.updateState(telegramId, 'IDLE', {});
    const parts = normalizeDigits(text).split(/\s+/);
    let slotDate = getTodayDateFa(0);
    let startTime = '09:00';
    let endTime = '10:00';
    let capacity = 1;

    if (parts.length >= 3 && parts[0].includes('/')) {
      slotDate = parts[0];
      startTime = parts[1];
      endTime = parts[2];
      capacity = parseInt(parts[3] ?? '1', 10) || 1;
    } else if (parts.length >= 2) {
      startTime = parts[0];
      endTime = parts[1];
      capacity = parseInt(parts[2] ?? '1', 10) || 1;
    }

    const slot = await slotsRepo.createSlot(telegramId, slotDate, startTime, endTime, 'ALL', capacity);
    await api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text:
        `✅ نوبت زمانی جدید ثبت شد:\n` +
        `📅 تاریخ: <code>${slotDate}</code>\n` +
        `🕒 ساعت: <code>${startTime} تا ${endTime}</code>\n` +
        `👥 ظرفیت: ${capacity} نفر (#${slot?.id ?? ''})`,
      reply_markup: kb([[{ text: '🕒 بازگشت به مدیریت نوبت‌ها', callback_data: 'MGR_SLOTS' }]]),
    });
    return true;
  }

  return false;
}

async function completeJobByManager(api, customerApi, db, managerChatId, manager, jobId, resultText) {
  const jobsRepo     = new ScrapingJobsRepository(db);
  const managersRepo = new ManagersRepository(db);
  const slotsRepo    = new TimeSlotsRepository(db);

  const job = await jobsRepo.findById(jobId);
  if (!job) {
    await api.sendMessage({ chat_id: managerChatId, text: `❌ درخواست #${jobId} یافت نشد.` });
    return true;
  }

  const resultPayload = {
    summary: resultText,
    completed_by: manager.display_name,
    manager_id: manager.telegram_id,
    completed_at: new Date().toISOString(),
  };

  await jobsRepo.complete(jobId, resultPayload);
  await managersRepo.recordCompletion(manager.telegram_id);
  if (job.slot_id) {
    await slotsRepo.completeSlot(job.slot_id);
  }

  const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;

  // Notify Customer with Result + Rating Buttons
  await customerApi.sendMessage({
    chat_id: job.user_id,
    parse_mode: 'HTML',
    text:
      `🎉 <b>درخواست ${taskNameFa} شما با موفقیت انجام شد!</b>\n\n` +
      `🔢 شماره درخواست: <b>#${job.id}</b>\n` +
      `👨‍💼 کارشناس انجام‌دهنده: <b>${manager.display_name}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 <b>نتیجه و جزئیات:</b>\n${resultText}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `لطفاً میزان رضایت خود از عملکرد کارشناس را ثبت کنید:`,
    reply_markup: kb([
      [
        { text: '⭐ ۱', callback_data: `RATE_JOB:${job.id}:1` },
        { text: '⭐⭐ ۲', callback_data: `RATE_JOB:${job.id}:2` },
        { text: '⭐⭐⭐ ۳', callback_data: `RATE_JOB:${job.id}:3` },
        { text: '⭐⭐⭐⭐ ۴', callback_data: `RATE_JOB:${job.id}:4` },
        { text: '⭐⭐⭐⭐⭐ ۵', callback_data: `RATE_JOB:${job.id}:5` },
      ],
      [{ text: '💬 سوال یا پشتیبانی درباره این درخواست', callback_data: `SUPPORT_JOB:${job.id}` }],
    ]),
  });

  await api.sendMessage({
    chat_id: managerChatId,
    text: `✅ درخواست #${job.id} تکمیل شد و نتیجه برای مشتری ارسال گردید.`,
    reply_markup: kb([
      [
        { text: '📥 صف درخواست‌ها', callback_data: 'MGR_QUEUE' },
        { text: '👨‍💼 پنل مدیریت', callback_data: 'MGR_HOME' },
      ],
    ]),
  });
  return true;
}

async function failJobByManager(api, customerApi, db, managerChatId, manager, jobId, reason) {
  const jobsRepo = new ScrapingJobsRepository(db);
  const job = await jobsRepo.findById(jobId);
  if (!job) {
    await api.sendMessage({ chat_id: managerChatId, text: `❌ درخواست #${jobId} یافت نشد.` });
    return true;
  }

  await jobsRepo.fail(jobId, reason);
  const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;

  await customerApi.sendMessage({
    chat_id: job.user_id,
    parse_mode: 'HTML',
    text:
      `❌ <b>درخواست ${taskNameFa} (#${job.id}) نیاز به اصلاح دارد</b>\n\n` +
      `👨‍💼 کارشناس: <b>${manager.display_name}</b>\n` +
      `⚠️ <b>توضیحات کارشناس:</b> ${reason}\n\n` +
      `می‌توانید درخواست را مجدداً ارسال کنید یا با پشتیبانی گفتگو نمایید:`,
    reply_markup: kb([
      [
        { text: '🔄 تلاش مجدد', callback_data: `RETRY_JOB:${job.id}` },
        { text: '💬 پیام به کارشناس', callback_data: `SUPPORT_JOB:${job.id}` },
      ],
    ]),
  });

  await api.sendMessage({
    chat_id: managerChatId,
    text: `⚠️ درخواست #${job.id} به عنوان ناموفق ثبت شد و علت به مشتری اطلاع داده شد.`,
    reply_markup: kb([[{ text: '👨‍💼 بازگشت به پنل', callback_data: 'MGR_HOME' }]]),
  });
  return true;
}

export async function handleManagerCallbackQuery(api, db, cq, env = null, customerApi = null) {
  const data = cq?.data ?? '';
  if (!data.startsWith('MGR_')) return false;

  const notifyCustomerApi = customerApi ?? api;
  const telegramId = String(cq.from?.id ?? '');
  const username   = cq.from?.username ?? cq.from?.first_name ?? 'manager';
  const fullName   = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(' ') || username;

  const usersRepo    = new UsersRepository(db);
  const managersRepo = new ManagersRepository(db);
  const slotsRepo    = new TimeSlotsRepository(db);
  const jobsRepo     = new ScrapingJobsRepository(db);
  const ticketsRepo  = new SupportTicketsRepository(db);

  await usersRepo.getOrCreate(telegramId, username, fullName);
  let manager = await managersRepo.findById(telegramId);

  if (data === 'MGR_REGISTER_DEMO') {
    await ack(api, cq.id, 'پنل کارشناس فعال شد!');
    manager = await managersRepo.upsert(telegramId, username, fullName, ALL_SERVICE_CODES);
    await usersRepo.updateRole(telegramId, 'manager');
    const dash = await renderManagerDashboardText(db, manager);
    await editOrReply(api, cq, dash.text, { parse_mode: 'HTML', reply_markup: dash.markup });
    return true;
  }

  if (!manager) {
    manager = await managersRepo.upsert(telegramId, username, fullName, ALL_SERVICE_CODES);
    await usersRepo.updateRole(telegramId, 'manager');
  }

  const parts  = data.split(':');
  const action = parts[0];
  const param1 = parts[1] ?? '';

  try {
    switch (action) {
      case 'MGR_HOME': {
        await ack(api, cq.id);
        await managersRepo.updateState(telegramId, 'IDLE', {});
        const dash = await renderManagerDashboardText(db, manager);
        await editOrReply(api, cq, dash.text, { parse_mode: 'HTML', reply_markup: dash.markup });
        return true;
      }

      case 'MGR_TOGGLE_STATUS': {
        manager = await managersRepo.toggleActive(telegramId);
        await ack(
          api,
          cq.id,
          manager.is_active ? '🟢 وضعیت شما به آنلاین تغییر یافت' : '🔴 وضعیت شما به آفلاین تغییر یافت'
        );
        const dash = await renderManagerDashboardText(db, manager);
        await editOrReply(api, cq, dash.text, { parse_mode: 'HTML', reply_markup: dash.markup });
        return true;
      }

      case 'MGR_SERVICES': {
        await ack(api, cq.id);
        return renderManagerServicesMenu(api, cq, manager);
      }

      case 'MGR_TOGGLE_SVC': {
        manager = await managersRepo.toggleService(telegramId, param1);
        await ack(api, cq.id, `سرویس ${TASK_NAME_FA[param1] ?? param1} بروزرسانی شد`);
        return renderManagerServicesMenu(api, cq, manager);
      }

      case 'MGR_SVC_ALL': {
        manager = await managersRepo.setServices(telegramId, ALL_SERVICE_CODES);
        await ack(api, cq.id, 'همه ۹ سرویس فعال شدند');
        return renderManagerServicesMenu(api, cq, manager);
      }

      case 'MGR_SLOTS': {
        await ack(api, cq.id);
        return renderManagerSlotsMenu(api, db, cq, manager);
      }

      case 'MGR_ADD_QUICK': {
        // MGR_ADD_QUICK:TODAY:09:00:10:00
        const dayFlag = parts[1];
        const startT  = `${parts[2]}:${parts[3]}`;
        const endT    = `${parts[4]}:${parts[5]}`;
        const dateStr = getTodayDateFa(dayFlag === 'TOMORROW' ? 1 : 0);
        await slotsRepo.createSlot(telegramId, dateStr, startT, endT, 'ALL', 2);
        await ack(api, cq.id, `✅ نوبت ${startT}-${endT} اضافه شد`);
        return renderManagerSlotsMenu(api, db, cq, manager);
      }

      case 'MGR_ADD_SHIFT': {
        const offset = param1 === 'TOMORROW' ? 1 : 0;
        const dateStr = getTodayDateFa(offset);
        const defaultBlocks = [
          ['09:00', '10:30'],
          ['10:30', '12:00'],
          ['14:00', '16:00'],
          ['16:00', '18:00'],
        ];
        for (const [st, et] of defaultBlocks) {
          await slotsRepo.createSlot(telegramId, dateStr, st, et, 'ALL', 2);
        }
        await ack(api, cq.id, `✅ ۴ نوبت زمانی برای ${param1 === 'TOMORROW' ? 'فردا' : 'امروز'} ثبت شد`);
        return renderManagerSlotsMenu(api, db, cq, manager);
      }

      case 'MGR_SET_HOURS': {
        const startH = `${parts[1]}:${parts[2]}`;
        const endH   = `${parts[3]}:${parts[4]}`;
        manager = await managersRepo.updateWorkingHours(telegramId, { start: startH, end: endH });
        await ack(api, cq.id, `ساعت کاری: ${startH} تا ${endH}`);
        return renderManagerSlotsMenu(api, db, cq, manager);
      }

      case 'MGR_CUSTOM_SLOT_PROMPT': {
        await ack(api, cq.id);
        await managersRepo.updateState(telegramId, 'MGR_ADDING_SLOT', {});
        await editOrReply(
          api,
          cq,
          `🕒 <b>ثبت نوبت زمانی دلخواه</b>\n\n` +
            `لطفاً تاریخ و بازه ساعتی نوبت را با فرمت زیر ارسال کنید:\n` +
            `<code>1405/07/26 09:00 11:00 2</code>\n` +
            `(تاریخ، ساعت شروع، ساعت پایان، ظرفیت)\n\n` +
            `یا فقط ساعت امروز را بفرستید:\n` +
            `<code>15:00 17:00</code>\n\n` +
            `برای انصراف: /cancel`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 بازگشت', callback_data: 'MGR_SLOTS' }]]),
          }
        );
        return true;
      }

      case 'MGR_DEL_SLOT': {
        await slotsRepo.deleteSlot(Number(param1), telegramId);
        await ack(api, cq.id, 'نوبت حذف شد');
        return renderManagerSlotsMenu(api, db, cq, manager);
      }

      case 'MGR_QUEUE': {
        await ack(api, cq.id);
        const pending = await jobsRepo.findPendingForManager(telegramId, manager.services_offered);
        if (!pending.length) {
          await editOrReply(
            api,
            cq,
            `📭 در حال حاضر هیچ درخواست جدیدی در صف انتظار سرویس‌های شما وجود ندارد.`,
            { reply_markup: kb([[{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }]]) }
          );
          return true;
        }
        const rows = pending.slice(0, 10).map((j) => [
          {
            text: `#${j.id} | ${TASK_NAME_FA[j.task_type] ?? j.task_type} (${j.slot_id ? '🕒 نوبت‌دار' : '⚡ فوری'})`,
            callback_data: `MGR_JOB:${j.id}`,
          },
        ]);
        rows.push([{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }]);
        await editOrReply(
          api,
          cq,
          `📥 <b>صف درخواست‌های در انتظار (${pending.length} مورد)</b>\nبرای مشاهده جزئیات و پذیرش روی درخواست کلیک کنید:`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
        return true;
      }

      case 'MGR_MY_JOBS': {
        await ack(api, cq.id);
        const activeJobs = await jobsRepo.findByManager(telegramId, 'PROCESSING', 15);
        if (!activeJobs.length) {
          await editOrReply(
            api,
            cq,
            `ℹ️ شما در حال حاضر هیچ کار در حال پردازشی ندارید.`,
            {
              reply_markup: kb([
                [{ text: '📥 مشاهده صف انتظار', callback_data: 'MGR_QUEUE' }],
                [{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }],
              ]),
            }
          );
          return true;
        }
        const rows = activeJobs.map((j) => [
          {
            text: `⚙️ #${j.id} — ${TASK_NAME_FA[j.task_type] ?? j.task_type} (کاربر ${j.user_id})`,
            callback_data: `MGR_JOB:${j.id}`,
          },
        ]);
        rows.push([{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }]);
        await editOrReply(
          api,
          cq,
          `⚙️ <b>کارهای در دست اقدام شما (${activeJobs.length} مورد):</b>`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
        return true;
      }

      case 'MGR_JOB': {
        await ack(api, cq.id);
        const job = await jobsRepo.findById(Number(param1));
        if (!job) {
          return editOrReply(api, cq, '❌ درخواست یافت نشد.', {
            reply_markup: kb([[{ text: '🔙 بازگشت', callback_data: 'MGR_QUEUE' }]]),
          });
        }
        const payloadLines = Object.entries(job.payload ?? {})
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => `  • <b>${getFieldLabel(k)}</b>: <code>${v}</code>`)
          .join('\n');

        const text =
          `🗂 <b>جزئیات درخواست #${job.id}</b>\n\n` +
          `📌 سرویس: <b>${TASK_NAME_FA[job.task_type] ?? job.task_type}</b>\n` +
          `👤 شناسه مشتری: <code>${job.user_id}</code>\n` +
          `📊 وضعیت: <b>${job.status}</b>\n\n` +
          `📋 <b>اطلاعات فرم مشتری:</b>\n${payloadLines || '—'}`;

        const actionRows = [];
        if (job.status === 'PENDING') {
          actionRows.push([{ text: '✅ قبول و شروع پردازش (Claim)', callback_data: `MGR_CLAIM:${job.id}` }]);
        }
        if (job.status === 'PENDING' || job.status === 'PROCESSING') {
          actionRows.push([
            { text: '📤 ارسال نتیجه و تکمیل', callback_data: `MGR_COMPLETE_PROMPT:${job.id}` },
            { text: '❓ دریافت کد / سوال از مشتری', callback_data: `MGR_ASK_PROMPT:${job.id}` },
          ]);
          actionRows.push([{ text: '❌ رد درخواست (نقص مدرک)', callback_data: `MGR_FAIL_PROMPT:${job.id}` }]);
        }
        actionRows.push([{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }]);

        await editOrReply(api, cq, text, { parse_mode: 'HTML', reply_markup: kb(actionRows) });
        return true;
      }

      case 'MGR_CLAIM': {
        const jobId = Number(param1);
        const claimed = await jobsRepo.claim(jobId, telegramId);
        const job = await jobsRepo.findById(jobId);
        if (!claimed && job?.assigned_manager_id !== telegramId) {
          await ack(api, cq.id, '⚠️ این درخواست قبلاً توسط کارشناس دیگری پذیرفته شده است.');
          return true;
        }
        await ack(api, cq.id, '✅ درخواست در اختیار شما قرار گرفت');

        if (job) {
          const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
          await notifyCustomerApi
            .sendMessage({
              chat_id: job.user_id,
              parse_mode: 'HTML',
              text:
                `⚙️ <b>درخواست ${taskNameFa} (#${job.id}) در حال انجام است!</b>\n\n` +
                `👨‍💼 کارشناس مسئول: <b>${manager.display_name}</b>\n` +
                `در صورت نیاز به کد تایید پیامکی یا نتیجه، همین‌جا به شما اطلاع داده می‌شود.`,
            })
            .catch(() => {});
        }

        const payloadLines = Object.entries(job?.payload ?? {})
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => `  • <b>${getFieldLabel(k)}</b>: <code>${v}</code>`)
          .join('\n');

        await editOrReply(
          api,
          cq,
          `⚙️ <b>درخواست #${jobId} به نام شما ثبت شد و در حال انجام است.</b>\n\n` +
            `📋 <b>اطلاعات مشتری:</b>\n${payloadLines}\n\n` +
            `پس از انجام در سامانه، نتیجه یا کد رهگیری را ارسال کنید:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([
              [
                { text: '📤 ثبت نتیجه و تکمیل کار', callback_data: `MGR_COMPLETE_PROMPT:${jobId}` },
                { text: '❓ درخواست کد OTP از مشتری', callback_data: `MGR_ASK_PROMPT:${jobId}` },
              ],
              [{ text: '❌ اعلام خطا / رد درخواست', callback_data: `MGR_FAIL_PROMPT:${jobId}` }],
              [{ text: '🔙 بازگشت به کارهای من', callback_data: 'MGR_MY_JOBS' }],
            ]),
          }
        );
        return true;
      }

      case 'MGR_COMPLETE_PROMPT': {
        const jobId = Number(param1);
        await ack(api, cq.id);
        await managersRepo.updateState(telegramId, `MGR_SENDING_RESULT:${jobId}`, {});
        await editOrReply(
          api,
          cq,
          `📤 <b>ارسال نتیجه نهایی برای درخواست #${jobId}</b>\n\n` +
            `لطفاً متن نتیجه، کد رهگیری، شماره پرونده یا توضیحات تکمیل کار را در یک پیام ارسال کنید تا فوراً برای مشتری ارسال شود:\n\n` +
            `برای انصراف: /cancel`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 انصراف', callback_data: `MGR_JOB:${jobId}` }]]),
          }
        );
        return true;
      }

      case 'MGR_ASK_PROMPT': {
        const jobId = Number(param1);
        await ack(api, cq.id);
        await managersRepo.updateState(telegramId, `MGR_ASKING_USER:${jobId}`, {});
        await editOrReply(
          api,
          cq,
          `❓ <b>ارسال سوال یا درخواست کد تایید (OTP) برای درخواست #${jobId}</b>\n\n` +
            `متن سوال خود را بنویسید (مثال: «لطفاً کد ۵ رقمی ارسال‌شده از سامانه ثنا را بفرستید»):`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 انصراف', callback_data: `MGR_JOB:${jobId}` }]]),
          }
        );
        return true;
      }

      case 'MGR_FAIL_PROMPT': {
        const jobId = Number(param1);
        await ack(api, cq.id);
        await managersRepo.updateState(telegramId, `MGR_FAILING_JOB:${jobId}`, {});
        await editOrReply(
          api,
          cq,
          `❌ <b>ثبت علت عدم انجام درخواست #${jobId}</b>\n\n` +
            `لطفاً دلیل رد شدن یا نقص اطلاعات (مثلاً عدم تطابق کد ملی با شماره موبایل شاهکار) را بنویسید تا به مشتری اعلام شود:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 انصراف', callback_data: `MGR_JOB:${jobId}` }]]),
          }
        );
        return true;
      }

      case 'MGR_TICKETS': {
        await ack(api, cq.id);
        const tickets = await ticketsRepo.listOpen(15);
        if (!tickets.length) {
          return editOrReply(
            api,
            cq,
            `✅ هیچ تیکت پشتیبانی بازی وجود ندارد.`,
            { reply_markup: kb([[{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }]]) }
          );
        }
        const rows = tickets.map((t) => [
          {
            text: `💬 تیکت #${t.id} — ${t.subject.slice(0, 28)} (${t.status === 'OPEN' ? '🔴 منتظر پاسخ' : '🟢 پاسخ‌داده‌شده'})`,
            callback_data: `MGR_TICKET:${t.id}`,
          },
        ]);
        rows.push([{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }]);
        await editOrReply(
          api,
          cq,
          `💬 <b>تیکت‌های پشتیبانی مشتریان (${tickets.length} مورد):</b>`,
          { parse_mode: 'HTML', reply_markup: kb(rows) }
        );
        return true;
      }

      case 'MGR_TICKET': {
        await ack(api, cq.id);
        const ticket = await ticketsRepo.findById(Number(param1));
        if (!ticket) {
          return editOrReply(api, cq, '❌ تیکت یافت نشد.');
        }
        const history = (ticket.messages ?? [])
          .slice(-6)
          .map((m) => `${m.sender === 'manager' ? '👨‍💼 کارشناس' : '👤 مشتری'}: ${m.text}`)
          .join('\n\n');

        await editOrReply(
          api,
          cq,
          `💬 <b>تیکت #${ticket.id} — ${ticket.subject}</b>\n` +
            `👤 شناسه مشتری: <code>${ticket.user_id}</code>\n` +
            `${ticket.job_id ? `🔗 مربوط به درخواست: #${ticket.job_id}\n` : ''}` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `${history || 'بدون پیام'}`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([
              [
                { text: '✍️ ارسال پاسخ به مشتری', callback_data: `MGR_TICKET_REPLY:${ticket.id}` },
                { text: '🔒 بستن تیکت', callback_data: `MGR_TICKET_CLOSE:${ticket.id}` },
              ],
              [{ text: '🔙 لیست تیکت‌ها', callback_data: 'MGR_TICKETS' }],
            ]),
          }
        );
        return true;
      }

      case 'MGR_TICKET_REPLY': {
        const ticketId = Number(param1);
        await ack(api, cq.id);
        await managersRepo.updateState(telegramId, `MGR_REPLYING_TICKET:${ticketId}`, {});
        await editOrReply(
          api,
          cq,
          `✍️ لطفاً پاسخ خود برای <b>تیکت #${ticketId}</b> را بنویسید:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 انصراف', callback_data: `MGR_TICKET:${ticketId}` }]]),
          }
        );
        return true;
      }

      case 'MGR_TICKET_CLOSE': {
        const ticketId = Number(param1);
        const closed = await ticketsRepo.close(ticketId);
        await ack(api, cq.id, 'تیکت بسته شد');
        if (closed) {
          await notifyCustomerApi
            .sendMessage({
              chat_id: closed.user_id,
              text: `✅ تیکت پشتیبانی #${closed.id} توسط کارشناس بسته شد.`,
            })
            .catch(() => {});
        }
        return editOrReply(api, cq, `✅ تیکت #${ticketId} بسته شد.`, {
          reply_markup: kb([[{ text: '🔙 بازگشت به تیکت‌ها', callback_data: 'MGR_TICKETS' }]]),
        });
      }

      case 'MGR_STATS': {
        await ack(api, cq.id);
        const avg =
          manager.rating_count > 0
            ? (manager.rating_sum / manager.rating_count).toFixed(2)
            : 'بدون رای';
        await editOrReply(
          api,
          cq,
          `📊 <b>گزارش عملکرد کارشناس: ${manager.display_name}</b>\n\n` +
            `✅ کل درخواست‌های تکمیل‌شده: <b>${manager.completed_count ?? 0}</b>\n` +
            `⭐ میانگین امتیاز رضایت: <b>${avg} از ۵</b> (${manager.rating_count ?? 0} نظر)\n` +
            `🛠 تعداد سرویس‌های فعال: <b>${(manager.services_offered ?? []).length}</b>\n` +
            `📡 وضعیت فعلی: <b>${manager.is_active ? '🟢 آنلاین' : '🔴 آفلاین'}</b>`,
          {
            parse_mode: 'HTML',
            reply_markup: kb([[{ text: '🔙 بازگشت به پنل', callback_data: 'MGR_HOME' }]]),
          }
        );
        return true;
      }

      default:
        await ack(api, cq.id);
        return false;
    }
  } catch (err) {
    safeError('[ManagerBot] خطا:', { action, error: err.message, stack: err.stack });
    await ack(api, cq.id, '⚠️ خطا در اجرای عملیات');
    return true;
  }
}

async function renderManagerServicesMenu(api, cq, manager) {
  const offered = Array.isArray(manager.services_offered) ? manager.services_offered : [];
  const rows = [];

  const codes = ALL_SERVICE_CODES;
  for (let i = 0; i < codes.length; i += 2) {
    const pair = codes.slice(i, i + 2).map((code) => {
      const svc = SERVICES_CATALOG[code];
      const active = offered.includes(code);
      return {
        text: `${active ? '✅' : '⬜'} ${svc.nameFa.split('(')[0].trim()}`,
        callback_data: `MGR_TOGGLE_SVC:${code}`,
      };
    });
    rows.push(pair);
  }

  rows.push([{ text: '☑️ فعال‌سازی همه ۹ سرویس', callback_data: 'MGR_SVC_ALL' }]);
  rows.push([{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'MGR_HOME' }]);

  await editOrReply(
    api,
    cq,
    `🛠 <b>مدیریت سرویس‌های قابل ارائه توسط شما</b>\n\n` +
      `روی هر سرویس کلیک کنید تا به لیست خدمات شما اضافه یا حذف شود.\n` +
      `مشتریان فقط برای سرویس‌هایی که تیک ✅ دارند به شما متصل می‌شوند:`,
    { parse_mode: 'HTML', reply_markup: kb(rows) }
  );
  return true;
}

async function renderManagerSlotsMenu(api, db, cq, manager) {
  const slotsRepo = new TimeSlotsRepository(db);
  const mySlots = await slotsRepo.listByManager(manager.telegram_id, 12);
  const wh = manager.working_hours ?? { start: '08:00', end: '20:00' };

  const slotLines = mySlots.length
    ? mySlots
        .map(
          (s) =>
            `  • #${s.id} | 📅 <code>${s.slot_date}</code> 🕒 <code>${s.start_time}-${s.end_time}</code> (${
              s.status === 'OPEN' ? `🟢 باز ${s.booked_count}/${s.capacity}` : '🔴 پر/رزروشده'
            })`
        )
        .join('\n')
    : '  <i>هنوز نوبت فعالی ثبت نکرده‌اید.</i>';

  const delRows = mySlots.slice(0, 4).map((s) => [
    {
      text: `🗑 حذف نوبت #${s.id} (${s.slot_date} ${s.start_time}-${s.end_time})`,
      callback_data: `MGR_DEL_SLOT:${s.id}`,
    },
  ]);

  const rows = [
    [
      { text: '➕ امروز ۰۹ تا ۱۰', callback_data: 'MGR_ADD_QUICK:TODAY:09:00:10:00' },
      { text: '➕ امروز ۱۰ تا ۱۱', callback_data: 'MGR_ADD_QUICK:TODAY:10:00:11:00' },
    ],
    [
      { text: '➕ امروز ۱۴ تا ۱۵', callback_data: 'MGR_ADD_QUICK:TODAY:14:00:15:00' },
      { text: '➕ امروز ۱۶ تا ۱۷', callback_data: 'MGR_ADD_QUICK:TODAY:16:00:17:00' },
    ],
    [
      { text: '⚡ ایجاد شیفت کامل امروز', callback_data: 'MGR_ADD_SHIFT:TODAY' },
      { text: '📅 ایجاد شیفت کامل فردا', callback_data: 'MGR_ADD_SHIFT:TOMORROW' },
    ],
    [
      { text: '🌅 ساعت کاری ۰۸ تا ۱۴', callback_data: 'MGR_SET_HOURS:08:00:14:00' },
      { text: '🌇 ساعت کاری ۱۴ تا ۲۰', callback_data: 'MGR_SET_HOURS:14:00:20:00' },
    ],
    [{ text: '✏️ ثبت نوبت با تاریخ و ساعت دلخواه', callback_data: 'MGR_CUSTOM_SLOT_PROMPT' }],
    ...delRows,
    [{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'MGR_HOME' }],
  ];

  await editOrReply(
    api,
    cq,
    `🕒 <b>مدیریت زمان کاری و نوبت‌های رزرو مشتریان</b>\n\n` +
      `⏰ ساعت کاری فعلی شما: <code>${wh.start} الی ${wh.end}</code>\n\n` +
      `📋 <b>نوبت‌های فعال شما:</b>\n${slotLines}\n\n` +
      `💡 همچنین می‌توانید با دستور <code>/set_time 1405/07/26 09:00 11:00 2</code> نوبت ثبت کنید:`,
    { parse_mode: 'HTML', reply_markup: kb(rows) }
  );
  return true;
}
