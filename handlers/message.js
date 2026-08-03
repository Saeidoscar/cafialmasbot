// ─────────────────────────────────────────────
// handlers/message.js — مسیریاب پیام‌های تلگرام
//
// SDK جدید tgcloud:
//   • پارامتر اول: شیء Message (نه ctx)
//   • api  از 'sdk'  — کلاینت Bot API
//   • db   از 'sdk'  — query builder (Drizzle)
// ─────────────────────────────────────────────

import { api, db }                                               from 'sdk';
import { eq, and }                                              from 'sdk/db';
import { users, linkedChats, scrapingJobs }                     from 'schema';
import { processConversationWithAI, getRequiredFields, getFieldLabel } from 'lib/ai';
import { getStats, getRecentJobs, buildDashboardHTML }          from 'lib/dashboard';

// ═══════════════════════════════════════════════
// ابزارهای کاربر
// ═══════════════════════════════════════════════

const MAX_MESSAGE_LENGTH = 4096;

function validateTelegramId(id) {
  return /^\d+$/.test(String(id)) && String(id).length > 0;
}

function sanitizeText(text) {
  return String(text ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
}

async function getOrCreateUser(telegramId, username) {
  const existing = await db.select().from(users)
    .where(eq(users.telegramId, telegramId)).get();

  if (existing) return existing;

  await db.insert(users).values({
    telegramId,
    username:  username ?? 'ناشناس',
    role:      'user',
    state:     'START',
    documents: {},
    tempData:  {},
    createdAt: new Date(),
  }).run();

  return db.select().from(users).where(eq(users.telegramId, telegramId)).get();
}

async function updateUserState(telegramId, newState, tempData = null) {
  const set = { state: newState };
  if (tempData !== null) set.tempData = tempData;
  await db.update(users).set(set).where(eq(users.telegramId, telegramId)).run();
}

function parseArgs(text) {
  return text.trim().split(/\s+/).slice(1);
}

function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

const TASK_NAME_FA = {
  SANA:      'سانا',
  GICA:      'گیکا',
  MYGOV:     'my.gov.ir',
  TAX:       'my.tax.gov.ir',
  INSURANCE: 'eservice.tamin.ir',
  MOJAVEZ:   'mojavez.ir',
  AMLAK:     'amlak.mrud.ir',
  KHODNEWIS: 'khodnevis.mrud.ir',
  SAMAN:     'saman.mrud.ir',
};

// ═══════════════════════════════════════════════
// هندلرهای دستورات
// ═══════════════════════════════════════════════

async function cmdStart(message) {
  const name = message.from?.first_name ?? 'کاربر';
  await api.sendMessage({
    chat_id: message.chat.id,
    text:
      `سلام ${name} عزیز! 👋\n` +
      `به ربات هوشمند کافه اینترنت خوش آمدید.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 دستورات موجود:\n\n` +
      `🔵 /sana — ثبت درخواست سامانه سانا\n` +
      `🔵 /gica — ثبت درخواست سامانه گیکا\n` +
      `🔵 /mygov — ورود به my.gov.ir\n` +
      `🔵 /tax — امور مالیاتی my.tax.gov.ir\n` +
      `🔵 /insurance — بیمه تامین اجتماعی و تکمیلی\n` +
      `🔵 /mojavez — مجوز کسب\n` +
      `🔵 /amlak — استعلام املاک\n` +
      `🔵 /khodnevis — قرارداد خنویس\n` +
      `🔵 /saman — وام سامان\n\n` +
      `📁 /add_doc [نام] [مقدار] — ذخیره مدرک\n` +
      `📂 /my_docs — مشاهده مدارک ذخیره‌شده\n\n` +
      `🔗 /link_chat [chat_id] — اتصال گروه یا کانال\n` +
      `❌ /cancel — لغو عملیات جاری\n` +
      `❓ /help — راهنمای کامل\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `برای شروع، دستور مربوط به سرویس را ارسال کنید.`,
  });
}

async function cmdHelp(message) {
  await api.sendMessage({
    chat_id: message.chat.id,
    text:
      `📖 راهنمای کامل ربات کافه هوشمند\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `۱. /sana — ثبت درخواست سانا\n` +
      `   اطلاعات لازم:\n` +
      `   • کد ملی (۱۰ رقم)\n` +
      `   • تاریخ تولد (فرمت: ۱۳۷۰/۰۵/۱۵)\n` +
      `   • شماره موبایل (۱۱ رقم، شروع با ۰۹)\n` +
      `   • سریال شناسنامه (مثال: ب۱۲۳۴۵۶)\n\n` +
      `۲. /gica — ثبت درخواست گیکا\n` +
      `   اطلاعات لازم:\n` +
      `   • کد ملی، تاریخ تولد، موبایل، کد رهگیری\n\n` +
      `۳. /mygov — ورود به my.gov.ir\n` +
      `   • شماره موبایل، کد ملی، تاریخ تولد، محل تولد\n\n` +
      `۴. /tax — امور مالیاتی my.tax.gov.ir\n` +
      `   • کد ملی، تاریخ تولد، توکن my.gov.ir، شناسه مالیاتی\n\n` +
      `۵. /insurance — بیمه تامین اجتماعی و تکمیلی\n` +
      `   • کد ملی، تاریخ تولد، شماره بیمه، نوع بیمه\n\n` +
      `۶. /mojavez — مجوز کسب\n` +
      `   • کد ملی، تاریخ تولد، نوع کسب، آدرس کسب\n\n` +
      `۷. /amlak — استعلام املاک\n` +
      `   • کد ملی، تاریخ تولد، آدرس، کد پستی\n\n` +
      `۸. /khodnevis — قرارداد خنویس\n` +
      `   • کد ملی، تاریخ تولد، نوع قرارداد\n\n` +
      `۹. /saman — وام سامان\n` +
      `   • کد ملی، تاریخ تولد، مبلغ وام، نوع وام\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `۱۰. /add_doc [نام] [مقدار]\n` +
      `   ذخیره مدرک برای استفاده مجدد\n` +
      `   مثال: /add_doc national_id 0012345678\n\n` +
      `۱۱. /my_docs — نمایش تمام مدارک ذخیره‌شده\n\n` +
      `۱۲. /link_chat [chat_id]\n` +
      `   اتصال گروه یا کانالی که مدیر آن هستید\n` +
      `   مثال: /link_chat -1001234567890\n\n` +
      `۱۳. /cancel — لغو عملیات جاری\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
  });
}

async function cmdCancel(message, user) {
  if (user.state === 'START') {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '⚠️ در حال حاضر هیچ عملیات فعالی در جریان نیست.',
    });
  }
  await updateUserState(String(message.from.id), 'START', {});
  await api.sendMessage({
    chat_id: message.chat.id,
    text: '✅ عملیات با موفقیت لغو شد.\nبرای شروع دوباره از دستور سرویس مورد نظر استفاده کنید.',
  });
}

async function cmdLinkChat(message, user) {
  const args   = parseArgs(message.text);
  const chatId = args[0];

  if (!chatId) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text:
        '❌ فرمت دستور اشتباه است.\n' +
        'استفاده صحیح: /link_chat [chat_id]\n' +
        'مثال: /link_chat -1001234567890',
    });
  }

  let member;
  try {
    member = await api.getChatMember({ chat_id: chatId, user_id: message.from.id });
  } catch {
    return api.sendMessage({
      chat_id: message.chat.id,
      text:
        '❌ دریافت اطلاعات چت ناموفق بود.\n' +
        'لطفاً مطمئن شوید ربات عضو گروه است و chat_id درست وارد شده است.',
    });
  }

  if (member.status !== 'creator' && member.status !== 'administrator') {
    return api.sendMessage({
      chat_id: message.chat.id,
      text:
        '❌ شما مدیر یا سازنده این چت نیستید.\n' +
        'تنها مدیران و سازنده گروه می‌توانند آن را متصل کنند.',
    });
  }

  let chatTitle = 'نامشخص';
  try {
    const chatInfo = await api.getChat({ chat_id: chatId });
    chatTitle = chatInfo.title ?? 'نامشخص';
  } catch { /* غیربحرانی */ }

  const userId   = String(message.from.id);
  const existing = await db.select().from(linkedChats)
    .where(and(eq(linkedChats.userId, userId), eq(linkedChats.chatId, chatId)))
    .get();

  if (existing) {
    await db.update(linkedChats)
      .set({ chatTitle, verified: true })
      .where(and(eq(linkedChats.userId, userId), eq(linkedChats.chatId, chatId)))
      .run();
  } else {
    await db.insert(linkedChats).values({
      userId, chatId, chatTitle,
      verified:  true,
      createdAt: new Date(),
    }).run();
  }

  await api.sendMessage({
    chat_id: message.chat.id,
    text: `✅ گروه «${chatTitle}» با موفقیت به حساب شما متصل شد!`,
  });
}

async function cmdAddDoc(message, user) {
  const args  = parseArgs(message.text);
  const name  = sanitizeText(args[0], 64);
  const value = sanitizeText(args.slice(1).join(' '), 512);

  if (!name || !value) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text:
        '❌ فرمت دستور اشتباه است.\n' +
        'استفاده صحیح: /add_doc [نام] [مقدار]\n' +
        'مثال: /add_doc national_id 0012345678',
    });
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text:
        '❌ نام مدرک باید فقط شامل حروف انگلیسی، اعداد و علامت _ باشد.\n' +
        'نمونه‌های معتبر: passport ، national_id ، birth_cert',
    });
  }

  const docs = { ...(user.documents ?? {}) };
  docs[name] = value;

  await db.update(users)
    .set({ documents: docs })
    .where(eq(users.telegramId, String(message.from.id)))
    .run();

  await api.sendMessage({
    chat_id: message.chat.id,
    text: `✅ مدرک «${name}» با موفقیت ذخیره شد.`,
  });
}

async function cmdMyDocs(message, user) {
  const docs = user.documents ?? {};
  const keys = Object.keys(docs);

  if (keys.length === 0) {
    return api.sendMessage({
      chat_id: message.chat.id,
      text:
        'ℹ️ هنوز هیچ مدرکی ذخیره نشده است.\n\n' +
        'برای ذخیره مدرک از دستور زیر استفاده کنید:\n' +
        '/add_doc [نام] [مقدار]',
    });
  }

  const lines = keys.map((k) => `  • <b>${k}</b>: <code>${docs[k]}</code>`);
  await api.sendMessage({
    chat_id:    message.chat.id,
    text:       `📂 مدارک ذخیره‌شده شما:\n\n${lines.join('\n')}`,
    parse_mode: 'HTML',
  });
}

// ═══════════════════════════════════════════════
// شروع جلسه سانا / گیکا
// ═══════════════════════════════════════════════

async function cmdStartTask(message, user, taskType) {
  const telegramId     = String(message.from.id);
  const savedDocs      = user.documents ?? {};
  const requiredFields = getRequiredFields(taskType);
  const preFilled      = {};

  for (const field of requiredFields) {
    if (savedDocs[field]) preFilled[field] = savedDocs[field];
  }

  await updateUserState(telegramId, `AI_COLLECTING_${taskType}`, preFilled);

  const summary = requiredFields.map((f) => {
    const label  = getFieldLabel(f);
    const filled = preFilled[f] ? `✅ ${preFilled[f]}` : '❓ نیاز به تکمیل';
    return `  • ${label}: ${filled}`;
  }).join('\n');

  const taskNameFa = TASK_NAME_FA[taskType] ?? taskType;
  const prompt     = Object.keys(preFilled).length > 0
    ? `اطلاعات اولیه از مدارک شما بارگذاری شد. لطفاً موارد ناقص را تکمیل کنید:`
    : `لطفاً اطلاعات لازم برای سرویس ${taskNameFa} را وارد کنید:`;

  await api.sendMessage({
    chat_id: message.chat.id,
    text:
      `📋 شروع فرآیند ثبت درخواست ${taskNameFa}\n\n` +
      `${prompt}\n\n${summary}\n\n` +
      `برای لغو در هر مرحله: /cancel`,
  });

  if (Object.keys(preFilled).length === 0) {
    await handleAIConversation(message, user, taskType, 'شروع');
  }
}

// ═══════════════════════════════════════════════
// ماشین حالت هوش مصنوعی
// ═══════════════════════════════════════════════

async function handleAIConversation(message, user, taskType, userMessage) {
  const telegramId  = String(message.from.id);
  const sessionData = user.tempData ?? {};

  let aiResult;
  try {
    aiResult = await processConversationWithAI(userMessage, sessionData, taskType);
  } catch (err) {
    console.error('[AI] خطا:', err.message);
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '⚠️ خطا در ارتباط با هوش مصنوعی.\nلطفاً دوباره تلاش کنید یا /cancel را بزنید.',
    });
  }

  const { status, data, next_question } = aiResult;
  const mergedData = { ...sessionData, ...data };

  if (status === 'COMPLETE') {
    await db.insert(scrapingJobs).values({
      userId:    telegramId,
      taskType,
      payload:   mergedData,
      status:    'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    await updateUserState(telegramId, 'START', {});

    const taskNameFa = TASK_NAME_FA[taskType] ?? taskType;
    await api.sendMessage({
      chat_id:      message.chat.id,
      text:
        `✅ اطلاعات کامل شد! درخواست ${taskNameFa} در صف پردازش قرار گرفت.\n\n` +
        `کارمند کافه به‌زودی فرآیند ثبت را انجام می‌دهد.\n` +
        `🕐 لطفاً صبور باشید.`,
      reply_markup: inlineKeyboard([[
        { text: '📋 بررسی وضعیت درخواست', callback_data: `STATUS_CHECK:${taskType}` },
      ]]),
    });
  } else {
    await updateUserState(telegramId, `AI_COLLECTING_${taskType}`, mergedData);
    await api.sendMessage({
      chat_id: message.chat.id,
      text:    next_question || 'لطفاً اطلاعات بعدی را وارد کنید.',
    });
  }
}

// ═══════════════════════════════════════════════
// داشبورد مدیریتی
// ═══════════════════════════════════════════════

async function cmdDashboard(message, user) {
  // فقط ادمین می‌تواند داشبورد را ببیند
  if (user.role !== 'admin') {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '⛔ دسترسی محدود است. این دستور فقط برای مدیران سیستم در دسترس است.',
    });
  }

  try {
    const [stats, jobs] = await Promise.all([getStats(), getRecentJobs(20)]);
    const html = buildDashboardHTML(stats, jobs);

    // ارسال به‌عنوان فایل HTML
    await api.sendDocument({
      chat_id:   message.chat.id,
      document:  { source: Buffer.from(html, 'utf-8'), filename: 'dashboard.html' },
      caption:   `📊 داشبورد کافه هوشمند\n\nفایل را دانلود کرده و در مرورگر باز کنید.\nآمار لحظه‌ای: ${stats.pending} در انتظار · ${stats.processing} در پردازش · ${stats.completed} تکمیل‌شده`,
    });
  } catch (err) {
    console.error('[Dashboard] خطا:', err.message);
    await api.sendMessage({
      chat_id: message.chat.id,
      text: '⚠️ خطا در تولید داشبورد. لطفاً دوباره تلاش کنید.',
    });
  }
}

// ═══════════════════════════════════════════════
// صادرات اصلی — نقطه ورودی tgcloud
// ═══════════════════════════════════════════════

export default async function (message) {
  if (!message?.text) return;

  const text       = message.text.trim();
  const telegramId = String(message.from?.id ?? '');
  if (!telegramId) return;

  const user = await getOrCreateUser(
    telegramId,
    message.from?.username ?? message.from?.first_name
  );

  // ── مسیریابی دستورات ──────────────────────────────────────────────────────
  const commandMatch = text.match(/^(\/[a-z_]+)(?:@\S+)?/i);
  const command      = commandMatch ? commandMatch[1].toLowerCase() : null;

  switch (command) {
    case '/start':     return cmdStart(message);
    case '/help':      return cmdHelp(message);
    case '/cancel':    return cmdCancel(message, user);
    case '/sana':      return cmdStartTask(message, user, 'SANA');
    case '/gica':      return cmdStartTask(message, user, 'GICA');
    case '/mygov':     return cmdStartTask(message, user, 'MYGOV');
    case '/tax':       return cmdStartTask(message, user, 'TAX');
    case '/insurance': return cmdStartTask(message, user, 'INSURANCE');
    case '/mojavez':   return cmdStartTask(message, user, 'MOJAVEZ');
    case '/amlak':     return cmdStartTask(message, user, 'AMLAK');
    case '/khodnevis': return cmdStartTask(message, user, 'KHODNEWIS');
    case '/saman':     return cmdStartTask(message, user, 'SAMAN');
    case '/add_doc':   return cmdAddDoc(message, user);
    case '/my_docs':   return cmdMyDocs(message, user);
    case '/link_chat': return cmdLinkChat(message, user);
    case '/dashboard': return cmdDashboard(message, user);
    default: break;
  }

  // ── ماشین حالت هوش مصنوعی ────────────────────────────────────────────────
  const aiState = user.state;
  if (aiState && aiState.startsWith('AI_COLLECTING_')) {
    const taskType = aiState.replace('AI_COLLECTING_', '');
    return handleAIConversation(message, user, taskType, text);
  }

  // ── دستور ناشناخته ────────────────────────────────────────────────────────
  if (command) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: '❓ دستور ناشناخته است.\nبرای مشاهده فهرست دستورات از /help استفاده کنید.',
    });
  }
}
