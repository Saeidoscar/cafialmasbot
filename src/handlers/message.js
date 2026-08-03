// ─────────────────────────────────────────────
// handlers/message.js — هندلر پیام‌های تلگرام
// ─────────────────────────────────────────────

import { dbGet, dbAll, dbRun, toJSON, fromJSON } from '../lib/db.js';
import { processConversationWithAI, getRequiredFields, getFieldLabel } from '../lib/ai.js';
import { safeError } from '../logging/logger.js';
import { isValidTelegramId, sanitizeText, validateNationalId, validateMobile, validateBirthDate, validateSerialNumber, validateTrackingCode } from '../validation/validators.js';

// ═══════════════════════════════════════
// ابزارها
// ═══════════════════════════════════════

const MAX_MESSAGE_LENGTH = 4096;

function validateTelegramId(id) {
  return /^\d+$/.test(String(id)) && String(id).length > 0;
}

function getOrCreateUser(db, telegramId, username) {
  let user = dbGet(db, 'SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  if (user) {
    user.documents = fromJSON(user.documents);
    user.temp_data = fromJSON(user.temp_data);
    return user;
  }
  dbRun(db,
    `INSERT INTO users (telegram_id, username, role, state, documents, temp_data)
     VALUES (?, ?, 'user', 'START', '{}', '{}')`,
    [telegramId, username ?? 'ناشناس']);
  user = dbGet(db, 'SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  user.documents = fromJSON(user.documents);
  user.temp_data = fromJSON(user.temp_data);
  return user;
}

function updateUserState(db, telegramId, newState, tempData = null) {
  if (tempData !== null) {
    dbRun(db,
      'UPDATE users SET state = ?, temp_data = ? WHERE telegram_id = ?',
      [newState, toJSON(tempData), telegramId]);
  } else {
    dbRun(db,
      'UPDATE users SET state = ? WHERE telegram_id = ?',
      [newState, telegramId]);
  }
}

function parseArgs(text) { return text.trim().split(/\s+/).slice(1); }
function kb(rows)        { return { inline_keyboard: rows }; }

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

// ═══════════════════════════════════════
// دستورات
// ═══════════════════════════════════════

async function cmdStart(api, message) {
  const name = message.from?.first_name ?? 'کاربر';
  await api.sendMessage({
    chat_id: message.chat.id,
    text:
      `سلام ${name} عزیز! 👋\n` +
      `به ربات هوشمند کافه اینترنت الماس خوش آمدید.\n\n` +
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

async function cmdHelp(api, message) {
  await api.sendMessage({
    chat_id: message.chat.id,
    text:
      `📖 راهنمای کامل ربات کافه هوشمند الماس\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `۱. /sana — ثبت درخواست سانا\n` +
      `   • کد ملی (۱۰ رقم)\n` +
      `   • تاریخ تولد (فرمت: ۱۳۷۰/۰۵/۱۵)\n` +
      `   • شماره موبایل (۱۱ رقم، شروع با ۰۹)\n` +
      `   • سریال شناسنامه (مثال: ب۱۲۳۴۵۶)\n\n` +
      `۲. /gica — ثبت درخواست گیکا\n` +
      `   • کد ملی، تاریخ تولد، موبایل، کد رهگیری\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `۳. /add_doc [نام] [مقدار] — ذخیره مدرک\n` +
      `   مثال: /add_doc national_id 0012345678\n\n` +
      `۴. /my_docs — نمایش مدارک ذخیره‌شده\n\n` +
      `۵. /link_chat [chat_id] — اتصال گروه/کانال\n\n` +
      `۶. /cancel — لغو عملیات جاری\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
  });
}

async function cmdCancel(api, db, message, user) {
  if (user.state === 'START') {
    return api.sendMessage({ chat_id: message.chat.id, text: '⚠️ هیچ عملیات فعالی در جریان نیست.' });
  }
  updateUserState(db, String(message.from.id), 'START', {});
  await api.sendMessage({
    chat_id: message.chat.id,
    text: '✅ عملیات با موفقیت لغو شد.\nبرای شروع دوباره از دستور سرویس مورد نظر استفاده کنید.',
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
  dbRun(db, 'UPDATE users SET documents = ? WHERE telegram_id = ?',
    [toJSON(docs), String(message.from.id)]);

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
  const lines = keys.map((k) => `  • <b>${k}</b>: <code>${docs[k]}</code>`);
  await api.sendMessage({
    chat_id: message.chat.id, parse_mode: 'HTML',
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
  try { member = await api.getChatMember({ chat_id: chatId, user_id: message.from.id }); }
  catch {
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
  try { const info = await api.getChat({ chat_id: chatId }); chatTitle = info?.title ?? 'نامشخص'; } catch {}

  const userId   = String(message.from.id);
  const existing = dbGet(db,
    'SELECT id FROM linked_chats WHERE user_id = ? AND chat_id = ?', [userId, chatId]);

  if (existing) {
    dbRun(db, 'UPDATE linked_chats SET chat_title = ?, verified = 1 WHERE user_id = ? AND chat_id = ?',
      [chatTitle, userId, chatId]);
  } else {
    dbRun(db, 'INSERT INTO linked_chats (user_id, chat_id, chat_title, verified) VALUES (?, ?, ?, 1)',
      [userId, chatId, chatTitle]);
  }

  await api.sendMessage({ chat_id: message.chat.id, text: `✅ گروه «${chatTitle}» با موفقیت متصل شد!` });
}

async function cmdStartTask(api, db, message, user, taskType) {
  const telegramId     = String(message.from.id);
  const savedDocs      = user.documents ?? {};
  const requiredFields = getRequiredFields(taskType);
  const preFilled      = {};

  for (const f of requiredFields) {
    if (savedDocs[f]) preFilled[f] = savedDocs[f];
  }

  updateUserState(db, telegramId, `AI_COLLECTING_${taskType}`, preFilled);

  const summary    = requiredFields.map((f) =>
    `  • ${getFieldLabel(f)}: ${preFilled[f] ? `✅ ${preFilled[f]}` : '❓ نیاز به تکمیل'}`
  ).join('\n');
  const taskNameFa = TASK_NAME_FA[taskType] ?? taskType;
  const prompt     = Object.keys(preFilled).length > 0
    ? 'اطلاعات اولیه از مدارک شما بارگذاری شد. لطفاً موارد ناقص را تکمیل کنید:'
    : `لطفاً اطلاعات لازم برای سرویس ${taskNameFa} را وارد کنید:`;

  await api.sendMessage({
    chat_id: message.chat.id,
    text: `📋 شروع فرآیند ثبت درخواست ${taskNameFa}\n\n${prompt}\n\n${summary}\n\nبرای لغو: /cancel`,
  });

  if (Object.keys(preFilled).length === 0) {
    await handleAIConversation(api, db, message, user, taskType, 'شروع');
  }
}

// ═══════════════════════════════════════
// ماشین حالت هوش مصنوعی
// ═══════════════════════════════════════

async function handleAIConversation(api, db, message, user, taskType, userMessage) {
  const telegramId  = String(message.from.id);
  const sessionData = user.temp_data ?? {};

  let aiResult;
  try {
    aiResult = await processConversationWithAI(userMessage, sessionData, taskType);
  } catch (err) {
    safeError('[AI] خطا:', { error: err.message, stack: err.stack });
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '⚠️ خطا در ارتباط با هوش مصنوعی.\nلطفاً دوباره تلاش کنید یا /cancel را بزنید.',
    });
  }

  const { status, data, next_question } = aiResult;
  const mergedData = { ...sessionData, ...data };

  if (status === 'COMPLETE') {
    dbRun(db,
      `INSERT INTO scraping_jobs (user_id, task_type, payload, status)
       VALUES (?, ?, ?, 'PENDING')`,
      [telegramId, taskType, toJSON(mergedData)]);

    updateUserState(db, telegramId, 'START', {});

    const taskNameFa = TASK_NAME_FA[taskType] ?? taskType;
    await api.sendMessage({
      chat_id:      message.chat.id,
      text:
        `✅ اطلاعات کامل شد! درخواست ${taskNameFa} در صف پردازش قرار گرفت.\n\n` +
        `کارمند کافه به‌زودی فرآیند ثبت را انجام می‌دهد.\n🕐 لطفاً صبور باشید.`,
      reply_markup: kb([[{ text: '📋 بررسی وضعیت درخواست', callback_data: `STATUS_CHECK:${taskType}` }]]),
    });
  } else {
    updateUserState(db, telegramId, `AI_COLLECTING_${taskType}`, mergedData);
    await api.sendMessage({
      chat_id: message.chat.id,
      text:    next_question || 'لطفاً اطلاعات بعدی را وارد کنید.',
    });
  }
}

// ═══════════════════════════════════════
// صادرات اصلی
// ═══════════════════════════════════════

export async function handleMessage(api, db, message) {
  if (!message?.text) return;

  const text       = message.text.trim();
  const telegramId = String(message.from?.id ?? '');
  if (!telegramId) return;

  const user = getOrCreateUser(db, telegramId,
    message.from?.username ?? message.from?.first_name);

  const commandMatch = text.match(/^(\/[a-z_]+)(?:@\S+)?/i);
  const command      = commandMatch ? commandMatch[1].toLowerCase() : null;

  switch (command) {
    case '/start':     return cmdStart(api, message);
    case '/help':      return cmdHelp(api, message);
    case '/cancel':    return cmdCancel(api, db, message, user);
    case '/sana':      return cmdStartTask(api, db, message, user, 'SANA');
    case '/gica':      return cmdStartTask(api, db, message, user, 'GICA');
    case '/mygov':     return cmdStartTask(api, db, message, user, 'MYGOV');
    case '/tax':       return cmdStartTask(api, db, message, user, 'TAX');
    case '/insurance': return cmdStartTask(api, db, message, user, 'INSURANCE');
    case '/mojavez':   return cmdStartTask(api, db, message, user, 'MOJAVEZ');
    case '/amlak':     return cmdStartTask(api, db, message, user, 'AMLAK');
    case '/khodnevis': return cmdStartTask(api, db, message, user, 'KHODNEWIS');
    case '/saman':     return cmdStartTask(api, db, message, user, 'SAMAN');
    case '/add_doc':   return cmdAddDoc(api, db, message, user);
    case '/my_docs':   return cmdMyDocs(api, message, user);
    case '/link_chat': return cmdLinkChat(api, db, message);
    default: break;
  }

  const aiState = user.state;
  if (aiState && aiState.startsWith('AI_COLLECTING_')) {
    const taskType = aiState.replace('AI_COLLECTING_', '');
    return handleAIConversation(api, db, message, user, taskType, text);
  }

  if (command) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: '❓ دستور ناشناخته است.\nبرای مشاهده فهرست دستورات از /help استفاده کنید.',
    });
  }
}
