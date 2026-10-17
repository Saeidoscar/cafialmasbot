// ─────────────────────────────────────────────
// src/handlers/message.js — هندلر پیام‌های ربات خدمات مشتریان (Service-End Bot)
// ─────────────────────────────────────────────

import { dbGet, dbAll, dbRun, toJSON, fromJSON } from '../lib/db.js';
import { processConversationWithAI, getRequiredFields, getFieldLabel } from '../lib/ai.js';
import {
  SERVICES_CATALOG,
  SERVICE_CATEGORIES,
  TASK_NAME_FA,
  formatPriceToman,
} from '../lib/services.js';
import {
  UsersRepository,
  ManagersRepository,
  TimeSlotsRepository,
  ScrapingJobsRepository,
  SupportTicketsRepository,
} from '../db/repository.js';
import { handleManagerMessage, notifyManagersOfNewJob } from './manager.js';
import { safeError } from '../logging/logger.js';
import { sanitizeText } from '../validation/validators.js';

function kb(rows) {
  return { inline_keyboard: rows };
}

function parseArgs(text) {
  return text.trim().split(/\s+/).slice(1);
}

export function buildCustomerMainMenuKeyboard() {
  return kb([
    [
      { text: '🛎 کاتالوگ ۹ سرویس و ثبت درخواست', callback_data: 'MENU_SERVICES' },
    ],
    [
      { text: '🕒 رزرو نوبت زمانی با کارشناس', callback_data: 'MENU_SLOTS' },
      { text: '📋 پیگیری و نتایج من', callback_data: 'MENU_MY_JOBS' },
    ],
    [
      { text: '📂 مدارک ذخیره‌شده من', callback_data: 'MENU_MY_DOCS' },
      { text: '💬 پشتیبانی و تیکت', callback_data: 'MENU_SUPPORT' },
    ],
    [
      { text: '👨‍💼 پنل کارشناسان / مدیران (Manager Bot)', callback_data: 'MGR_HOME' },
    ],
  ]);
}

async function getOrCreateUser(db, telegramId, username, fullName = null) {
  const usersRepo = new UsersRepository(db);
  return usersRepo.getOrCreate(telegramId, username, fullName);
}

async function updateUserState(db, telegramId, newState, tempData = null) {
  const usersRepo = new UsersRepository(db);
  return usersRepo.updateState(telegramId, newState, tempData);
}

// ═══════════════════════════════════════
// دستورات ربات مشتری (Service-End Bot)
// ═══════════════════════════════════════

async function cmdStart(api, message) {
  const name = message.from?.first_name ?? 'کاربر';
  await api.sendMessage({
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text:
      `سلام <b>${name}</b> عزیز! 👋\n` +
      `به سامانه هوشمند خدمات اینترنتی و دولتی <b>کافه الماس</b> خوش آمدید.\n\n` +
      `✨ در این ربات می‌توانید:\n` +
      `1️⃣ سرویس مورد نظر خود را از میان <b>۹ خدمت دولتی و قضایی</b> انتخاب کنید\n` +
      `2️⃣ به صورت <b>فوری</b> یا با <b>انتخاب نوبت زمانی کارشناس (Manager)</b> درخواست ثبت کنید\n` +
      `3️⃣ <b>نتیجه، کد رهگیری و رسید</b> را مستقیم در تلگرام دریافت نمایید\n` +
      `4️⃣ با کارشناسان پشتیبانی به صورت دوطرفه گفتگو کنید\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 <b>دستورات سریع سرویس‌ها:</b>\n` +
      `⚖️ /sana — سامانه ثنا / سانا\n` +
      `🔏 /gica — گواهی امضای الکترونیکی گیکا\n` +
      `🔐 /mygov — پنجره ملی دولت هوشمند\n` +
      `💰 /tax — امور مالیاتی و اظهارنامه\n` +
      `🏥 /insurance — بیمه تامین اجتماعی و تکمیلی\n` +
      `📄 /mojavez — درگاه ملی مجوزهای کشور\n` +
      `🏠 /amlak — سامانه ملی املاک و اسکان\n` +
      `✍️ /khodnevis — قرارداد خودنویس املاک\n` +
      `🏦 /saman — تسهیلات و مسکن سامان\n\n` +
      `🕒 /slots — مشاهده نوبت‌های خالی کارشناسان\n` +
      `📋 /my_jobs — پیگیری درخواست‌ها و مشاهده نتایج\n` +
      `💬 /support — ارسال تیکت پشتیبانی\n` +
      `👨‍💼 /manager — ورود به پنل مدیران / کارشناسان\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `از منوی شیشه‌ای زیر یا دستورات بالا استفاده کنید:`,
    reply_markup: buildCustomerMainMenuKeyboard(),
  });
}

async function cmdHelp(api, message) {
  await api.sendMessage({
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text:
      `📖 <b>راهنمای کامل سامانه دوگانه کافه هوشمند الماس</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>بخش مشتریان (Service-End Bot):</b>\n` +
      `• /services — مشاهده دسته‌بندی ۹ سرویس و تعرفه‌ها\n` +
      `• /slots — رزرو نوبت زمانی نزد کارشناس دلخواه\n` +
      `• /my_jobs — مشاهده وضعیت درخواست‌ها و دریافت نتایج\n` +
      `• /support — ارتباط مستقیم با کارشناس و ثبت تیکت\n` +
      `• /add_doc [نام] [مقدار] — ذخیره مدرک در صندوق شخصی (مثال: <code>/add_doc national_id 0012345678</code>)\n` +
      `• /my_docs — مشاهده مدارک ذخیره‌شده\n` +
      `• /link_chat [chat_id] — اتصال گروه یا کانال\n` +
      `• /cancel — لغو عملیات جاری\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👨‍💼 <b>بخش کارشناسان و مدیران (Manager-End Bot):</b>\n` +
      `• /manager — باز کردن پنل کارشناس / ارائه‌دهنده خدمت\n` +
      `• /register_manager [کد] — ثبت‌نام به عنوان کارشناس\n` +
      `• /set_time [تاریخ] [شروع] [پایان] — تعریف نوبت زمانی جدید\n` +
      `• /working_hours [شروع] [پایان] — تنظیم ساعت کاری\n` +
      `• /complete [id] [نتیجه] — ارسال نتیجه نهایی برای مشتری\n` +
      `• /fail [id] [دلیل] — رد درخواست همراه با توضیحات\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
    reply_markup: buildCustomerMainMenuKeyboard(),
  });
}

async function cmdServices(api, message) {
  const catRows = Object.values(SERVICE_CATEGORIES).map((cat) => [
    { text: cat.title, callback_data: `MENU_CAT:${cat.code}` },
  ]);
  catRows.push([{ text: '📋 نمایش همه ۹ سرویس یکجا', callback_data: 'MENU_ALL_SERVICES' }]);
  catRows.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'MENU_HOME' }]);

  await api.sendMessage({
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text:
      `🛎 <b>کاتالوگ خدمات کافه هوشمند الماس</b>\n\n` +
      `لطفاً دسته‌بندی مورد نظر خود را انتخاب کنید تا لیست سرویس‌ها، مدارک لازم و نوبت‌های کارشناسان نمایش داده شود:`,
    reply_markup: kb(catRows),
  });
}

async function cmdSlots(api, db, message) {
  const slotsRepo = new TimeSlotsRepository(db);
  const openSlots = await slotsRepo.listOpenSlots('ALL', 10);

  if (!openSlots.length) {
    return api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text:
        `🕒 <b>نوبت‌های زمانی کارشناسان</b>\n\n` +
        `در حال حاضر نوبت زمان‌بندی‌شده خاصی ثبت نشده است، اما می‌توانید درخواست خود را به صورت <b>⚡ فوری در صف آنلاین</b> ثبت کنید تا اولین کارشناس آزاد آن را انجام دهد!`,
      reply_markup: kb([
        [{ text: '🛎 انتخاب سرویس و ثبت فوری', callback_data: 'MENU_SERVICES' }],
        [{ text: '🔙 منوی اصلی', callback_data: 'MENU_HOME' }],
      ]),
    });
  }

  const rows = openSlots.map((s) => [
    {
      text: `📅 ${s.slot_date} | 🕒 ${s.start_time}-${s.end_time} | 👤 ${s.manager_name || 'کارشناس'}`,
      callback_data: `SLOT_CHOOSE_SVC:${s.id}`,
    },
  ]);
  rows.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'MENU_HOME' }]);

  await api.sendMessage({
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text:
      `🕒 <b>نوبت‌های زمانی آزاد کارشناسان (${openSlots.length} نوبت فعال)</b>\n\n` +
      `نوبت و کارشناس مورد نظر خود را انتخاب کنید:`,
    reply_markup: kb(rows),
  });
}

async function cmdMyJobs(api, db, message) {
  const jobsRepo = new ScrapingJobsRepository(db);
  const telegramId = String(message.from.id);
  const jobs = await jobsRepo.findByUser(telegramId, 10);

  if (!jobs.length) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: 'ℹ️ شما هنوز هیچ درخواستی ثبت نکرده‌اید.\nاز دستور /services برای ثبت اولین درخواست استفاده کنید.',
      reply_markup: kb([[{ text: '🛎 مشاهده سرویس‌ها', callback_data: 'MENU_SERVICES' }]]),
    });
  }

  const statusEmoji = { PENDING: '⏳', PROCESSING: '⚙️', COMPLETED: '✅', FAILED: '❌' };
  const rows = jobs.map((j) => [
    {
      text: `${statusEmoji[j.status] ?? '📌'} #${j.id} — ${TASK_NAME_FA[j.task_type] ?? j.task_type}`,
      callback_data: `JOB_VIEW:${j.id}`,
    },
  ]);
  rows.push([{ text: '🔙 منوی اصلی', callback_data: 'MENU_HOME' }]);

  await api.sendMessage({
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text:
      `📋 <b>درخواست‌ها و نتایج شما (${jobs.length} مورد اخیر)</b>\n` +
      `برای مشاهده وضعیت، کارشناس مسئول و نتیجه نهایی، روی درخواست کلیک کنید:`,
    reply_markup: kb(rows),
  });
}

async function cmdSupport(api, db, message) {
  const telegramId = String(message.from.id);
  const args = parseArgs(message.text);
  const initialText = args.join(' ').trim();

  if (initialText) {
    const ticketsRepo = new SupportTicketsRepository(db);
    const managersRepo = new ManagersRepository(db);
    const ticket = await ticketsRepo.create(telegramId, 'پشتیبانی عمومی', initialText);
    const activeManagers = await managersRepo.listActive();

    for (const mgr of activeManagers) {
      await api
        .sendMessage({
          chat_id: mgr.telegram_id,
          parse_mode: 'HTML',
          text:
            `💬 <b>تیکت پشتیبانی جدید (#${ticket.id})</b>\n` +
            `👤 مشتری: <code>${telegramId}</code>\n\n` +
            `📝 پیام: ${initialText}`,
          reply_markup: kb([
            [{ text: '✍️ پاسخ به تیکت', callback_data: `MGR_TICKET_REPLY:${ticket.id}` }],
          ]),
        })
        .catch(() => {});
    }

    return api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ تیکت پشتیبانی #${ticket.id} ثبت و برای کارشناسان ارسال شد. پاسخ از همین ربات برای شما ارسال خواهد شد.`,
    });
  }

  await updateUserState(db, telegramId, 'SUPPORT_CREATING', {});
  await api.sendMessage({
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text:
      `💬 <b>پشتیبانی و ارتباط با کارشناسان</b>\n\n` +
      `لطفاً سوال، مشکل یا پیام خود را در یک پیام بنویسید و ارسال کنید تا تیکت شما ثبت شود:\n\n` +
      `برای انصراف: /cancel`,
  });
}

async function cmdCancel(api, db, message, user) {
  if (user.state === 'START') {
    return api.sendMessage({ chat_id: message.chat.id, text: '⚠️ هیچ عملیات فعالی در جریان نیست.' });
  }
  await updateUserState(db, String(message.from.id), 'START', {});
  await api.sendMessage({
    chat_id: message.chat.id,
    text: '✅ عملیات با موفقیت لغو شد.\nبرای شروع دوباره از دستور سرویس مورد نظر یا /services استفاده کنید.',
  });
}

async function cmdAddDoc(api, db, message, user) {
  const args  = parseArgs(message.text);
  const name  = sanitizeText(args[0], 64);
  const value = sanitizeText(args.slice(1).join(' '), 512);

  if (!name || !value) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '❌ فرمت اشتباه.\nاستفاده صحیح: /add_doc [نام] [مقدار]\nمثال: /add_doc national_id 0012345678',
    });
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '❌ نام مدرک فقط باید شامل حروف انگلیسی، اعداد و _ باشد.',
    });
  }

  const docs = { ...(user.documents ?? {}) };
  docs[name] = value;
  await dbRun(
    db,
    'UPDATE users SET documents = ? WHERE telegram_id = ?',
    [toJSON(docs), String(message.from.id)]
  );

  await api.sendMessage({ chat_id: message.chat.id, text: `✅ مدرک «${name}» با موفقیت ذخیره شد.` });
}

async function cmdMyDocs(api, message, user) {
  const docs = user.documents ?? {};
  const keys = Object.keys(docs);
  if (keys.length === 0) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: 'ℹ️ هنوز هیچ مدرکی ذخیره نشده است.\n\nاستفاده از: /add_doc [نام] [مقدار]',
    });
  }
  const lines = keys.map((k) => `  • <b>${getFieldLabel(k)} (${k})</b>: <code>${docs[k]}</code>`);
  await api.sendMessage({
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text: `📂 مدارک ذخیره‌شده شما:\n\n${lines.join('\n')}`,
  });
}

async function cmdLinkChat(api, db, message) {
  const args   = parseArgs(message.text);
  const chatId = args[0];
  if (!chatId) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '❌ فرمت اشتباه.\nاستفاده صحیح: /link_chat [chat_id]\nمثال: /link_chat -1001234567890',
    });
  }

  let member;
  try {
    member = await api.getChatMember({ chat_id: chatId, user_id: message.from.id });
  } catch {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '❌ دریافت اطلاعات چت ناموفق بود. مطمئن شوید ربات عضو گروه است.',
    });
  }

  if (member?.status !== 'creator' && member?.status !== 'administrator') {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '❌ شما مدیر یا سازنده این چت نیستید.',
    });
  }

  let chatTitle = 'نامشخص';
  try {
    const info = await api.getChat({ chat_id: chatId });
    chatTitle = info?.title ?? 'نامشخص';
  } catch {}

  const userId   = String(message.from.id);
  const existing = await dbGet(
    db,
    'SELECT id FROM linked_chats WHERE user_id = ? AND chat_id = ?',
    [userId, chatId]
  );

  if (existing) {
    await dbRun(
      db,
      'UPDATE linked_chats SET chat_title = ?, verified = 1 WHERE user_id = ? AND chat_id = ?',
      [chatTitle, userId, chatId]
    );
  } else {
    await dbRun(
      db,
      'INSERT INTO linked_chats (user_id, chat_id, chat_title, verified) VALUES (?, ?, ?, 1)',
      [userId, chatId, chatTitle]
    );
  }

  await api.sendMessage({ chat_id: message.chat.id, text: `✅ گروه «${chatTitle}» با موفقیت متصل شد!` });
}

export async function startServiceFlow(
  api,
  db,
  chatId,
  telegramId,
  user,
  taskType,
  slotId = null,
  managerId = null,
  env = null,
  managerApi = null
) {
  const savedDocs      = user.documents ?? {};
  const requiredFields = getRequiredFields(taskType);
  const preFilled      = {};

  if (slotId) preFilled._slot_id = Number(slotId);
  if (managerId) preFilled._manager_id = String(managerId);

  for (const f of requiredFields) {
    if (savedDocs[f]) preFilled[f] = savedDocs[f];
  }

  await updateUserState(db, telegramId, `AI_COLLECTING_${taskType}`, preFilled);

  const summary = requiredFields
    .map((f) => `  • ${getFieldLabel(f)}: ${preFilled[f] ? `✅ ${preFilled[f]}` : '❓ نیاز به تکمیل'}`)
    .join('\n');

  const svc = SERVICES_CATALOG[taskType];
  const taskNameFa = TASK_NAME_FA[taskType] ?? taskType;
  const filledKeys = requiredFields.filter((f) => Boolean(preFilled[f]));
  const prompt =
    filledKeys.length > 0
      ? 'اطلاعات اولیه از مدارک شما بارگذاری شد. لطفاً موارد ناقص را تکمیل کنید:'
      : `لطفاً اطلاعات لازم برای سرویس ${taskNameFa} را وارد کنید:`;

  const slotBanner = slotId
    ? `\n🕒 <b>نوبت زمانی شماره #${slotId} برای شما انتخاب شده است.</b>\n`
    : '';

  const extraButtons = [];
  if (!slotId) {
    extraButtons.push([
      { text: '🕒 انتخاب نوبت زمانی و کارشناس (اختیاری)', callback_data: `SVC_PICK_SLOT:${taskType}` },
    ]);
  }
  extraButtons.push([{ text: '❌ انصراف', callback_data: 'FLOW_CANCEL' }]);

  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      `${svc?.icon ?? '📋'} <b>شروع فرآیند ثبت درخواست ${taskNameFa}</b>\n` +
      `💰 تعرفه خدمات: ${formatPriceToman(svc?.priceToman)} | ⏱ زمان تقریبی: ${svc?.estimatedMinutes ?? 15} دقیقه` +
      `${slotBanner}\n` +
      `${prompt}\n\n${summary}\n\nبرای لغو: /cancel`,
    reply_markup: kb(extraButtons),
  });

  const updatedUser = { ...user, temp_data: preFilled, state: `AI_COLLECTING_${taskType}` };
  await handleAIConversation(api, db, { chat: { id: chatId }, from: { id: telegramId } }, updatedUser, taskType, 'شروع', env, managerApi);
}

// ═══════════════════════════════════════
// ماشین حالت هوش مصنوعی و ثبت نهایی درخواست
// ═══════════════════════════════════════

export async function handleAIConversation(api, db, message, user, taskType, userMessage, env = null, managerApi = null) {
  const telegramId  = String(message.from.id);
  const sessionData = user.temp_data ?? {};

  let aiResult;
  try {
    aiResult = await processConversationWithAI(userMessage, sessionData, taskType, env);
  } catch (err) {
    safeError('[AI] خطا:', { error: err.message, stack: err.stack });
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '⚠️ خطا در پردازش اطلاعات.\nلطفاً دوباره تلاش کنید یا /cancel را بزنید.',
    });
  }

  const { status, data, next_question } = aiResult;
  const mergedData = { ...sessionData, ...data };

  if (status === 'COMPLETE') {
    const slotId = mergedData._slot_id ? Number(mergedData._slot_id) : null;
    let assignedManagerId = mergedData._manager_id ? String(mergedData._manager_id) : null;

    const cleanPayload = {};
    for (const [k, v] of Object.entries(mergedData)) {
      if (!k.startsWith('_')) cleanPayload[k] = v;
    }

    const jobsRepo  = new ScrapingJobsRepository(db);
    const slotsRepo = new TimeSlotsRepository(db);

    if (slotId && !assignedManagerId) {
      const slot = await slotsRepo.findById(slotId);
      if (slot?.manager_id) assignedManagerId = String(slot.manager_id);
    }

    const createdJob = await jobsRepo.create(
      telegramId,
      taskType,
      cleanPayload,
      assignedManagerId,
      slotId
    );

    if (slotId && createdJob?.id) {
      await slotsRepo.reserveSlot(slotId, telegramId, createdJob.id);
    }

    await updateUserState(db, telegramId, 'START', {});

    const taskNameFa = TASK_NAME_FA[taskType] ?? taskType;
    const jobNum = createdJob?.id ? `#${createdJob.id}` : '';

    await api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text:
        `✅ <b>اطلاعات کامل شد! درخواست ${taskNameFa} (${jobNum}) در صف پردازش قرار گرفت.</b>\n\n` +
        `${slotId ? `🕒 نوبت رزروشده: #${slotId}\n` : ''}` +
        `👨‍💼 کارشناس کافه به‌زودی فرآیند ثبت را انجام داده و نتیجه و کد رهگیری را همین‌جا برای شما ارسال می‌کند.\n` +
        `🕐 لطفاً صبور باشید.`,
      reply_markup: kb([
        [{ text: '📋 بررسی وضعیت درخواست', callback_data: `STATUS_CHECK:${taskType}` }],
        [
          { text: '💬 پیام به کارشناس / پشتیبانی', callback_data: createdJob?.id ? `SUPPORT_JOB:${createdJob.id}` : 'MENU_SUPPORT' },
          { text: '🏠 منوی اصلی', callback_data: 'MENU_HOME' },
        ],
      ]),
    });

    // Notify Manager(s) on Manager-End Bot
    if (createdJob) {
      await notifyManagersOfNewJob(
        managerApi ?? api,
        db,
        createdJob,
        message.from?.username ? `@${message.from.username}` : message.from?.first_name ?? 'مشتری'
      ).catch(() => {});
    }
  } else {
    await updateUserState(db, telegramId, `AI_COLLECTING_${taskType}`, mergedData);
    await api.sendMessage({
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text: next_question || 'لطفاً اطلاعات بعدی را وارد کنید.',
    });
  }
}

// ═══════════════════════════════════════
// صادرات اصلی
// ═══════════════════════════════════════

export async function handleMessage(api, db, message, env = null, managerApi = null) {
  if (!message?.text) return;

  const text       = message.text.trim();
  const telegramId = String(message.from?.id ?? '');
  if (!telegramId) return;

  const fullName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
  const user = await getOrCreateUser(
    db,
    telegramId,
    message.from?.username ?? message.from?.first_name,
    fullName
  );

  const commandMatch = text.match(/^(\/[a-z_]+)(?:@\S+)?/i);
  const command      = commandMatch ? commandMatch[1].toLowerCase() : null;

  // Check if this is a manager command or active manager FSM state
  const managersRepo = new ManagersRepository(db);
  const managerRow   = await managersRepo.findById(telegramId);
  const isMgrCommand = [
    '/manager',
    '/panel',
    '/register_manager',
    '/set_time',
    '/working_hours',
    '/complete',
    '/fail',
  ].includes(command);

  if (isMgrCommand || (managerRow && managerRow.state && managerRow.state !== 'IDLE' && !command)) {
    const handled = await handleManagerMessage(managerApi ?? api, db, message, env, api);
    if (handled) return;
  }

  switch (command) {
    case '/start':     return cmdStart(api, message);
    case '/help':      return cmdHelp(api, message);
    case '/services':  return cmdServices(api, message);
    case '/slots':     return cmdSlots(api, db, message);
    case '/my_jobs':
    case '/status':    return cmdMyJobs(api, db, message);
    case '/support':   return cmdSupport(api, db, message);
    case '/cancel':    return cmdCancel(api, db, message, user);
    case '/sana':      return startServiceFlow(api, db, message.chat.id, telegramId, user, 'SANA', null, null, env, managerApi);
    case '/gica':      return startServiceFlow(api, db, message.chat.id, telegramId, user, 'GICA', null, null, env, managerApi);
    case '/mygov':     return startServiceFlow(api, db, message.chat.id, telegramId, user, 'MYGOV', null, null, env, managerApi);
    case '/tax':       return startServiceFlow(api, db, message.chat.id, telegramId, user, 'TAX', null, null, env, managerApi);
    case '/insurance': return startServiceFlow(api, db, message.chat.id, telegramId, user, 'INSURANCE', null, null, env, managerApi);
    case '/mojavez':   return startServiceFlow(api, db, message.chat.id, telegramId, user, 'MOJAVEZ', null, null, env, managerApi);
    case '/amlak':     return startServiceFlow(api, db, message.chat.id, telegramId, user, 'AMLAK', null, null, env, managerApi);
    case '/khodnevis': return startServiceFlow(api, db, message.chat.id, telegramId, user, 'KHODNEWIS', null, null, env, managerApi);
    case '/saman':     return startServiceFlow(api, db, message.chat.id, telegramId, user, 'SAMAN', null, null, env, managerApi);
    case '/add_doc':   return cmdAddDoc(api, db, message, user);
    case '/my_docs':   return cmdMyDocs(api, message, user);
    case '/link_chat': return cmdLinkChat(api, db, message);
    default: break;
  }

  const userState = user.state ?? 'START';

  // 1. AI / Deterministic Slot-Filling State
  if (userState.startsWith('AI_COLLECTING_')) {
    const taskType = userState.replace('AI_COLLECTING_', '');
    return handleAIConversation(api, db, message, user, taskType, text, env, managerApi);
  }

  // 2. Customer Support Ticket Creation State
  if (userState === 'SUPPORT_CREATING' || userState.startsWith('SUPPORT_CREATING_JOB:')) {
    const jobId = userState.startsWith('SUPPORT_CREATING_JOB:')
      ? Number(userState.split(':')[1])
      : null;
    await updateUserState(db, telegramId, 'START', {});
    const ticketsRepo = new SupportTicketsRepository(db);
    const jobsRepo    = new ScrapingJobsRepository(db);
    let assignedMgr   = null;
    let subject       = 'پشتیبانی خدمات';

    if (jobId) {
      const job = await jobsRepo.findById(jobId);
      assignedMgr = job?.assigned_manager_id ?? null;
      subject = `پیگیری درخواست #${jobId} (${TASK_NAME_FA[job?.task_type] ?? ''})`;
    }

    const ticket = await ticketsRepo.create(telegramId, subject, text, jobId, assignedMgr);
    const notifyApi = managerApi ?? api;
    const targets = assignedMgr
      ? [{ telegram_id: assignedMgr }]
      : await managersRepo.listActive();

    for (const mgr of targets) {
      await notifyApi
        .sendMessage({
          chat_id: mgr.telegram_id,
          parse_mode: 'HTML',
          text:
            `💬 <b>تیکت پشتیبانی جدید (#${ticket.id})</b>\n` +
            `📌 موضوع: ${subject}\n` +
            `👤 مشتری: <code>${telegramId}</code>\n\n` +
            `📝 پیام مشتری:\n${text}`,
          reply_markup: kb([
            [{ text: '✍️ پاسخ به مشتری', callback_data: `MGR_TICKET_REPLY:${ticket.id}` }],
          ]),
        })
        .catch(() => {});
    }

    return api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ تیکت پشتیبانی #${ticket.id} ثبت شد و برای کارشناس ارسال گردید.\nبه محض پاسخگویی کارشناس، پیام را در همین چت دریافت خواهید کرد.`,
      reply_markup: kb([[{ text: '🏠 بازگشت به منوی اصلی', callback_data: 'MENU_HOME' }]]),
    });
  }

  // 3. Customer Replying to an Open Support Ticket
  if (userState.startsWith('SUPPORT_REPLYING:')) {
    const ticketId = Number(userState.split(':')[1]);
    await updateUserState(db, telegramId, 'START', {});
    const ticketsRepo = new SupportTicketsRepository(db);
    const updated = await ticketsRepo.addMessage(ticketId, 'user', telegramId, text, 'OPEN');
    if (updated?.manager_id) {
      await (managerApi ?? api)
        .sendMessage({
          chat_id: updated.manager_id,
          parse_mode: 'HTML',
          text:
            `💬 <b>پاسخ جدید مشتری در تیکت #${updated.id}:</b>\n\n${text}`,
          reply_markup: kb([
            [{ text: '✍️ پاسخ به مشتری', callback_data: `MGR_TICKET_REPLY:${updated.id}` }],
          ]),
        })
        .catch(() => {});
    }
    return api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ پیام شما به تیکت #${ticketId} اضافه شد و برای کارشناس ارسال گردید.`,
    });
  }

  // 4. Customer Replying OTP / Info to Manager on Active Job
  if (userState.startsWith('USER_REPLYING_JOB:')) {
    const jobId = Number(userState.split(':')[1]);
    await updateUserState(db, telegramId, 'START', {});
    const jobsRepo = new ScrapingJobsRepository(db);
    const job = await jobsRepo.findById(jobId);
    if (job) {
      const mergedPayload = { ...(job.payload ?? {}), customer_reply: text };
      await dbRun(
        db,
        'UPDATE scraping_jobs SET payload = ?, updated_at = unixepoch() WHERE id = ?',
        [toJSON(mergedPayload), job.id]
      );
      if (job.assigned_manager_id) {
        await (managerApi ?? api)
          .sendMessage({
            chat_id: job.assigned_manager_id,
            parse_mode: 'HTML',
            text:
              `📩 <b>پاسخ / کد تایید مشتری برای درخواست #${job.id}:</b>\n\n` +
              `<code>${text}</code>`,
            reply_markup: kb([
              [
                { text: '📤 ثبت نتیجه نهایی', callback_data: `MGR_COMPLETE_PROMPT:${job.id}` },
                { text: '🗂 مشاهده کار', callback_data: `MGR_JOB:${job.id}` },
              ],
            ]),
          })
          .catch(() => {});
      }
    }
    return api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ پاسخ / کد شما برای کارشناس درخواست #${jobId} ارسال شد.`,
    });
  }

  if (command) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: '❓ دستور ناشناخته است.\nبرای مشاهده فهرست دستورات از /help یا /services استفاده کنید.',
    });
  }
}
