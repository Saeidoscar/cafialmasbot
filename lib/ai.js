// ─────────────────────────────────────────────
// lib/ai.js — یکپارچه‌سازی ArvanCloud AI (GPT-5-Nano) برای جمع‌آوری اطلاعات
//
// سازگار با هر OpenAI-compatible gateway از جمله ArvanCloud
// متغیرهای محیطی:
//   OPENAI_API_KEY  — کلید API از داشبورد ArvanCloud (ماشین‌یوزر)
//   OPENAI_BASE_URL — آدرس gateway (از صفحه مدل در ArvanCloud)
//   OPENAI_MODEL    — نام مدل (مثلاً GPT-5-Nano-udho3)
// ─────────────────────────────────────────────

import { fetch } from 'sdk/fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE    = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_URL     = `${OPENAI_BASE}/chat/completions`;
const OPENAI_MODEL   = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

function sanitizeForAI(text) {
  const cleaned = String(text ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .slice(0, 2000);
  return cleaned;
}

// ═══════════════════════════════════════════════
// تعریف فیلدهای لازم
// ═══════════════════════════════════════════════

export const TASK_REQUIRED_FIELDS = {
  SANA:      ['national_id', 'birth_date', 'mobile_number', 'serial_number'],
  GICA:      ['national_id', 'birth_date', 'mobile_number', 'tracking_code'],
  MYGOV:     ['phone_number', 'national_id', 'birth_date', 'birth_place'],
  TAX:       ['national_id', 'birth_date', 'mygov_token', 'tax_id'],
  INSURANCE: ['national_id', 'birth_date', 'insurance_number', 'insurance_type'],
  MOJAVEZ:   ['national_id', 'birth_date', 'business_type', 'business_address'],
  AMLAK:     ['national_id', 'birth_date', 'address', 'post_code'],
  KHODNEWIS: ['national_id', 'birth_date', 'contract_type'],
  SAMAN:     ['national_id', 'birth_date', 'loan_amount', 'loan_type'],
};

const FIELD_METADATA = {
  national_id: {
    label:     'کد ملی',
    desc:      '10-digit Iranian national ID number (e.g. 0012345678)',
    pattern:   /^\d{10}$/,
    errorHint: 'باید دقیقاً ۱۰ رقم باشد',
  },
  birth_date: {
    label:     'تاریخ تولد',
    desc:      'Birth date in YYYY/MM/DD format (e.g. 1370/05/15)',
    pattern:   /^\d{4}\/\d{2}\/\d{2}$/,
    errorHint: 'فرمت صحیح: ۱۳۷۰/۰۵/۱۵',
  },
  mobile_number: {
    label:     'شماره موبایل',
    desc:      '11-digit Iranian mobile starting with 09 (e.g. 09123456789)',
    pattern:   /^09\d{9}$/,
    errorHint: 'باید ۱۱ رقم و با ۰۹ شروع شود',
  },
  serial_number: {
    label:     'سریال شناسنامه',
    desc:      'Serial number from the Iranian birth certificate — letter(s) followed by digits',
    pattern:   /^[A-Za-z\u0600-\u06FF]\d+$/,
    errorHint: 'مثال: ب۱۲۳۴۵۶ یا A123456',
  },
  tracking_code: {
    label:     'کد رهگیری',
    desc:      'Alphanumeric tracking code from a previous GICA submission (6–20 chars)',
    pattern:   /^[A-Za-z0-9]{6,20}$/,
    errorHint: 'باید ۶ تا ۲۰ کاراکتر الفبا-عددی باشد',
  },
  phone_number: {
    label:     'شماره موبایل',
    desc:      '11-digit Iranian mobile starting with 09 (e.g. 09123456789)',
    pattern:   /^09\d{9}$/,
    errorHint: 'باید ۱۱ رقم و با ۰۹ شروع شود',
  },
  birth_place: {
    label:     'محل تولد',
    desc:      'City or province of birth in Persian (e.g. تهران)',
    pattern:   /^[\u0600-\u06FF\s]{2,50}$/,
    errorHint: 'نام شهر یا استان را به فارسی وارد کنید',
  },
  mygov_token: {
    label:     'توکن my.gov.ir',
    desc:      'Token obtained from my.gov.ir login (alphanumeric, min 8 chars)',
    pattern:   /^[A-Za-z0-9]{8,}$/,
    errorHint: 'توکن باید حداقل ۸ کاراکتر الفبا-عددی باشد',
  },
  tax_id: {
    label:     'شناسه مالیاتی',
    desc:      'Tax ID number from my.tax.gov.ir (numeric, 8–12 digits)',
    pattern:   /^\d{8,12}$/,
    errorHint: 'باید ۸ تا ۱۲ رقم باشد',
  },
  insurance_number: {
    label:     'شماره بیمه',
    desc:      'Insurance number from eservice.tamin.ir (numeric, 8–12 digits)',
    pattern:   /^\d{8,12}$/,
    errorHint: 'باید ۸ تا ۱۲ رقم باشد',
  },
  insurance_type: {
    label:     'نوع بیمه',
    desc:      'Insurance type: پایه (base) or تکمیلی (private)',
    pattern:   /^(پایه|تکمیلی|base|private)$/i,
    errorHint: 'مقادیر مجاز: پایه یا تکمیلی',
  },
  business_type: {
    label:     'نوع کسب',
    desc:      'Type of business for mojavez.ir (e.g..restaurant, shop)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s]{2,50}$/,
    errorHint: 'نوع کسب را وارد کنید (مثال: رستوران)',
  },
  business_address: {
    label:     'آدرس کسب',
    desc:      'Business address for mojavez.ir license (max 200 chars)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s\/\-]{5,200}$/,
    errorHint: 'آدرس کامل کسب را وارد کنید',
  },
  address: {
    label:     'آدرس',
    desc:      'Home address for amlak.mrud.ir (max 200 chars)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s\/\-]{5,200}$/,
    errorHint: 'آدرس کامل منزل را وارد کنید',
  },
  post_code: {
    label:     'کد پستی',
    desc:      'Iranian postal code (10 digits)',
    pattern:   /^\d{10}$/,
    errorHint: 'باید دقیقاً ۱۰ رقم باشد',
  },
  contract_type: {
    label:     'نوع قرارداد',
    desc:      'Contract type for khodnevis.mrud.ir (e.g. خرید، اجاره)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s]{2,50}$/,
    errorHint: 'نوع قرارداد را وارد کنید (مثال: خرید، اجاره)',
  },
  loan_amount: {
    label:     'مبلغ وام',
    desc:      'Loan amount in Tomans (numeric, e.g. 500000000)',
    pattern:   /^\d{6,15}$/,
    errorHint: 'مبلغ را به تومان وارد کنید (حداقل ۶ رقم)',
  },
  loan_type: {
    label:     'نوع وام',
    desc:      'Loan type for saman.mrud.ir (e.g. مسکن، خرید کالا)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s]{2,50}$/,
    errorHint: 'نوع وام را وارد کنید (مثال: مسکن)',
  },
};

// ═══════════════════════════════════════════════
// صادرات اصلی
// ═══════════════════════════════════════════════

export async function processConversationWithAI(userMessage, currentSessionData, taskType) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY تنظیم نشده است. متغیر محیطی را در tgcloud اضافه کنید.');
  }

  const requiredFields = TASK_REQUIRED_FIELDS[taskType];
  if (!requiredFields) {
    throw new Error(`نوع کار ناشناخته: "${taskType}"`);
  }

  const fieldTable = requiredFields.map((f) => {
    const m = FIELD_METADATA[f] ?? { label: f, desc: f, errorHint: '' };
    return `  • "${f}" (${m.label}): ${m.desc}. راهنمای اعتبارسنجی: ${m.errorHint}`;
  }).join('\n');

  const systemPrompt =
    `You are an AI assistant integrated into an Iranian Internet Cafe management system.\n` +
    `Your only job is to collect the information required to submit a ${taskType} government portal registration.\n\n` +
    `TASK: ${taskType}\n` +
    `REQUIRED FIELDS:\n${fieldTable}\n\n` +
    `INSTRUCTIONS:\n` +
    `1. Extract any values matching required fields from the user's message.\n` +
    `2. Merge with CURRENT_COLLECTED_DATA. Never drop already-collected valid fields.\n` +
    `3. Validate strictly using patterns provided per field.\n` +
    `4. Invalid values: do NOT include in "data". Ask to re-enter.\n` +
    `5. ALL fields valid → "status":"COMPLETE", "next_question":""\n` +
    `6. Any missing/invalid → "status":"INCOMPLETE", ask for ONE field at a time in friendly Persian.\n` +
    `7. Unrelated messages → gently redirect in Persian.\n\n` +
    `OUTPUT: respond with ONLY this JSON, no markdown:\n` +
    `{"status":"COMPLETE"|"INCOMPLETE","data":{...},"next_question":"..."}`;

  const userPrompt =
    `CURRENT_COLLECTED_DATA:\n${JSON.stringify(currentSessionData ?? {}, null, 2)}\n\n` +
    `USER_MESSAGE:\n"${sanitizeForAI(userMessage)}"`;

  const response = await fetch(OPENAI_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:           OPENAI_MODEL,
      messages:        [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature:     0.1,
      max_tokens:      600,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${response.status}: ${errText}`);
  }

  const apiResult = await response.json();
  const content   = apiResult?.choices?.[0]?.message?.content ?? '';

  if (!content) throw new Error('پاسخ OpenAI خالی است.');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error('[AI] خروجی نامعتبر:', content);
    throw new Error('هوش مصنوعی JSON نامعتبر برگرداند.');
  }

  return {
    status:        parsed.status === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
    data:          typeof parsed.data === 'object' && parsed.data !== null ? parsed.data : {},
    next_question: typeof parsed.next_question === 'string' ? parsed.next_question : '',
  };
}

export function getRequiredFields(taskType) {
  return TASK_REQUIRED_FIELDS[taskType] ?? [];
}

export function getFieldLabel(fieldKey) {
  return FIELD_METADATA[fieldKey]?.label ?? fieldKey;
}
