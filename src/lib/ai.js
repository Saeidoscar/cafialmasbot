// ─────────────────────────────────────────────
// src/lib/ai.js — موتور هوشمند جمع‌آوری اطلاعات (Hybrid AI + Deterministic Slot-Filling FSM)
// ─────────────────────────────────────────────

import { normalizeDigits } from './services.js';

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

export const FIELD_METADATA = {
  national_id: {
    label:     'کد ملی',
    desc:      '10-digit Iranian national ID (e.g. 0012345678)',
    pattern:   /^\d{10}$/,
    errorHint: 'باید دقیقاً ۱۰ رقم عددی باشد (مثال: 0012345678)',
  },
  birth_date: {
    label:     'تاریخ تولد',
    desc:      'Birth date YYYY/MM/DD (e.g. 1370/05/15)',
    pattern:   /^\d{4}\/\d{2}\/\d{2}$/,
    errorHint: 'فرمت صحیح: ۱۳۷۰/۰۵/۱۵ (چهار رقم سال/دو رقم ماه/دو رقم روز)',
  },
  mobile_number: {
    label:     'شماره موبایل',
    desc:      '11-digit mobile starting with 09 (e.g. 09123456789)',
    pattern:   /^09\d{9}$/,
    errorHint: 'باید ۱۱ رقم و با ۰۹ شروع شود (مثال: 09123456789)',
  },
  phone_number: {
    label:     'شماره موبایل',
    desc:      '11-digit mobile starting with 09 (e.g. 09123456789)',
    pattern:   /^09\d{9}$/,
    errorHint: 'باید ۱۱ رقم و با ۰۹ شروع شود (مثال: 09123456789)',
  },
  serial_number: {
    label:     'سریال شناسنامه',
    desc:      'Birth certificate serial, letter(s)+digits (e.g. الف123456, ب123456 or A123456)',
    pattern:   /^[A-Za-z\u0600-\u06FF\/]+\s?\d{3,12}$/,
    errorHint: 'حرف/حروف و ارقام سریال شناسنامه (مثال: الف123456 یا ب123456)',
  },
  tracking_code: {
    label:     'کد رهگیری',
    desc:      'GICA alphanumeric tracking code (6–20 chars)',
    pattern:   /^[A-Za-z0-9\-]{6,20}$/,
    errorHint: 'باید ۶ تا ۲۰ کاراکتر الفبا-عددی باشد',
  },
  birth_place: {
    label:     'محل تولد',
    desc:      'City or province of birth (e.g. تهران)',
    pattern:   /^[\u0600-\u06FFA-Za-z\s]{2,50}$/,
    errorHint: 'نام شهر یا استان محل تولد را وارد کنید (مثال: تهران)',
  },
  mygov_token: {
    label:     'توکن / کد تایید my.gov.ir',
    desc:      'Token obtained from my.gov.ir login (alphanumeric, min 6 chars)',
    pattern:   /^[A-Za-z0-9\-_]{6,64}$/,
    errorHint: 'توکن یا کد رهگیری حداقل ۶ کاراکتری my.gov.ir را وارد کنید',
  },
  tax_id: {
    label:     'شناسه / کد مالیاتی',
    desc:      'Tax ID number from my.tax.gov.ir (numeric, 8–12 digits)',
    pattern:   /^\d{8,12}$/,
    errorHint: 'شناسه مالیاتی باید ۸ تا ۱۲ رقم باشد',
  },
  insurance_number: {
    label:     'شماره بیمه',
    desc:      'Insurance number from eservice.tamin.ir (numeric, 8–12 digits)',
    pattern:   /^\d{8,12}$/,
    errorHint: 'شماره بیمه باید ۸ تا ۱۲ رقم عددی باشد',
  },
  insurance_type: {
    label:     'نوع بیمه',
    desc:      'Insurance type: پایه (base) or تکمیلی (private)',
    pattern:   /^(پایه|تکمیلی|base|private|خویش فرما|اجباری)$/i,
    errorHint: 'نوع بیمه را وارد کنید (مقادیر مجاز: پایه یا تکمیلی)',
  },
  business_type: {
    label:     'نوع کسب‌وکار',
    desc:      'Type of business for mojavez.ir (e.g. رستوران، فروشگاه)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s\-]{2,80}$/,
    errorHint: 'عنوان رسته یا نوع کسب‌وکار را وارد کنید (مثال: کافی‌شاپ یا فروشگاه)',
  },
  business_address: {
    label:     'آدرس محل کسب',
    desc:      'Business address for mojavez.ir license (5–200 chars)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s،,\-\/\.]{5,200}$/,
    errorHint: 'آدرس دقیق محل کسب را وارد کنید (حداقل ۵ کاراکتر)',
  },
  address: {
    label:     'آدرس منزل / ملک',
    desc:      'Property address for amlak.mrud.ir (5–200 chars)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s،,\-\/\.]{5,200}$/,
    errorHint: 'آدرس کامل ملک را وارد کنید (حداقل ۵ کاراکتر)',
  },
  post_code: {
    label:     'کد پستی ۱۰ رقمی',
    desc:      'Iranian postal code (10 digits)',
    pattern:   /^\d{10}$/,
    errorHint: 'کد پستی باید دقیقاً ۱۰ رقم باشد (بدون خط تیره)',
  },
  contract_type: {
    label:     'نوع قرارداد',
    desc:      'Contract type for khodnevis.mrud.ir (e.g. اجاره، خرید و فروش)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s]{2,50}$/,
    errorHint: 'نوع قرارداد را وارد کنید (مثال: اجاره یا خرید و فروش)',
  },
  loan_amount: {
    label:     'مبلغ وام درخواستی (تومان)',
    desc:      'Loan amount in Tomans (numeric, 6–15 digits)',
    pattern:   /^\d{6,15}$/,
    errorHint: 'مبلغ وام را به عدد (تومان) وارد کنید (مثال: 300000000)',
  },
  loan_type: {
    label:     'نوع وام',
    desc:      'Loan type for saman.mrud.ir (e.g. ودیعه مسکن، نهضت ملی، خرید مسکن)',
    pattern:   /^[\u0600-\u06FFA-Za-z0-9\s]{2,50}$/,
    errorHint: 'نوع وام را وارد کنید (مثال: ودیعه مسکن یا خرید مسکن)',
  },
};

export function getRequiredFields(taskType) {
  return TASK_REQUIRED_FIELDS[String(taskType ?? '').toUpperCase()] ?? [];
}

export function getFieldLabel(fieldKey) {
  return FIELD_METADATA[fieldKey]?.label ?? fieldKey;
}

export function getFieldErrorHint(fieldKey) {
  return FIELD_METADATA[fieldKey]?.errorHint ?? '';
}

export function validateFieldValue(fieldKey, rawValue) {
  const meta = FIELD_METADATA[fieldKey];
  if (!meta) return Boolean(rawValue && String(rawValue).trim().length > 0);
  const normalized = normalizeDigits(String(rawValue ?? '').trim()).replace(/,/g, '');
  return meta.pattern.test(normalized);
}

/**
 * موتور جایگزین قطعی (Deterministic Slot-Filling) — بدون نیاز به کلید OpenAI
 * یا در صورت بروز خطا در سرویس ابری هوش مصنوعی
 */
export function processConversationDeterministic(userMessage, currentSessionData, taskType) {
  const requiredFields = getRequiredFields(taskType);
  if (!requiredFields.length) {
    throw new Error(`نوع کار ناشناخته: "${taskType}"`);
  }

  // Keep internal metadata keys (like _slot_id, _manager_id) intact
  const data = { ...(currentSessionData ?? {}) };
  const normalizedText = normalizeDigits(String(userMessage ?? '').trim());
  const isInitialTrigger = normalizedText === 'شروع' || normalizedText.startsWith('/');

  // Determine which required fields are still missing before processing this message
  const missingBefore = requiredFields.filter((f) => !data[f] || !validateFieldValue(f, data[f]));

  let validationErrorFeedback = '';

  if (!isInitialTrigger && normalizedText.length > 0 && missingBefore.length > 0) {
    // 1. Try multi-field extraction from free-form text (e.g., if user pasted mobile + national_id + birth_date)
    let extractedAny = false;

    for (const field of missingBefore) {
      if (field === 'mobile_number' || field === 'phone_number') {
        const m = normalizedText.match(/\b(09\d{9})\b/);
        if (m) { data[field] = m[1]; extractedAny = true; }
      } else if (field === 'birth_date') {
        const m = normalizedText.match(/\b(1[34]\d{2}\/\d{1,2}\/\d{1,2})\b/);
        if (m) {
          const [y, mo, d] = m[1].split('/');
          data[field] = `${y}/${mo.padStart(2, '0')}/${d.padStart(2, '0')}`;
          extractedAny = true;
        }
      } else if (field === 'national_id' || field === 'post_code') {
        // Only auto-match 10-digit token if it's the current expected field or clearly distinct
        const matches = normalizedText.match(/\b(\d{10})\b/g) ?? [];
        for (const candidate of matches) {
          if (!candidate.startsWith('09') && Object.values(data).indexOf(candidate) === -1) {
            data[field] = candidate;
            extractedAny = true;
            break;
          }
        }
      }
    }

    // 2. Direct validation against the first currently missing field (`targetField`)
    const targetField = missingBefore[0];
    if (!data[targetField]) {
      const candidateVal = normalizedText.replace(/,/g, '').trim();
      if (validateFieldValue(targetField, candidateVal)) {
        data[targetField] = candidateVal;
        extractedAny = true;
      } else if (!extractedAny) {
        const meta = FIELD_METADATA[targetField];
        validationErrorFeedback = `⚠️ مقدار واردشده برای «${meta?.label ?? targetField}» معتبر نیست.\n💡 راهنما: ${meta?.errorHint ?? ''}\n\n`;
      }
    }
  }

  const remainingMissing = requiredFields.filter((f) => !data[f] || !validateFieldValue(f, data[f]));

  if (remainingMissing.length === 0) {
    return {
      status: 'COMPLETE',
      data,
      next_question: '',
    };
  }

  const nextField = remainingMissing[0];
  const nextMeta = FIELD_METADATA[nextField] ?? { label: nextField, errorHint: '' };
  const stepIndex = requiredFields.indexOf(nextField) + 1;
  const totalSteps = requiredFields.length;

  const nextQuestion =
    `${validationErrorFeedback}` +
    `🔹 مرحله ${stepIndex} از ${totalSteps} — لطفاً <b>${nextMeta.label}</b> خود را ارسال کنید:\n` +
    `(${nextMeta.errorHint})`;

  return {
    status: 'INCOMPLETE',
    data,
    next_question: nextQuestion,
  };
}

/**
 * پردازش مکالمه با هوش مصنوعی (همراه با Fallback هوشمند به موتور قطعی)
 */
export async function processConversationWithAI(userMessage, currentSessionData, taskType, env = null) {
  const normalizedTask = String(taskType ?? '').toUpperCase();
  const requiredFields = TASK_REQUIRED_FIELDS[normalizedTask];
  if (!requiredFields) throw new Error(`نوع کار ناشناخته: "${taskType}"`);

  const apiKey  = env?.OPENAI_API_KEY ?? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '');
  const baseUrl = ((env?.OPENAI_BASE_URL ?? (typeof process !== 'undefined' ? process.env?.OPENAI_BASE_URL : '')) || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model   = (env?.OPENAI_MODEL ?? (typeof process !== 'undefined' ? process.env?.OPENAI_MODEL : '')) || 'gpt-4o-mini';

  // If no OpenAI key is configured (or placeholder key), use the deterministic slot-filling engine seamlessly
  if (!apiKey || apiKey === 'your-api-key' || apiKey.startsWith('test-')) {
    return processConversationDeterministic(userMessage, currentSessionData, normalizedTask);
  }

  const fieldTable = requiredFields.map((f) => {
    const m = FIELD_METADATA[f] ?? { label: f, desc: f, errorHint: '' };
    return `  • "${f}" (${m.label}): ${m.desc}. راهنمای اعتبارسنجی: ${m.errorHint}`;
  }).join('\n');

  const systemPrompt =
    `You are an AI assistant in an Iranian Internet Cafe management system.\n` +
    `Collect info for ${normalizedTask} government portal registration.\n\n` +
    `REQUIRED FIELDS:\n${fieldTable}\n\n` +
    `RULES:\n` +
    `1. Extract matching fields from user message (convert Persian digits ۰-۹ to 0-9).\n` +
    `2. Merge with CURRENT_COLLECTED_DATA, never drop valid fields.\n` +
    `3. Validate strictly according to field descriptions.\n` +
    `4. Invalid value → exclude from data, ask to re-enter.\n` +
    `5. All valid → status:COMPLETE, next_question:"".\n` +
    `6. Missing/invalid → status:INCOMPLETE, ask ONE field in friendly Persian.\n` +
    `7. Unrelated → redirect in Persian.\n\n` +
    `OUTPUT JSON only:\n{"status":"COMPLETE"|"INCOMPLETE","data":{...},"next_question":"..."}`;

  const userPrompt =
    `CURRENT_COLLECTED_DATA:\n${JSON.stringify(currentSessionData ?? {}, null, 2)}\n\n` +
    `USER_MESSAGE:\n"${normalizeDigits(userMessage)}"`;

  try {
    const authHeader = apiKey.startsWith('Bearer ') || apiKey.startsWith('Apikey ') ? apiKey : `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method:  'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages:        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature:     0.1,
        max_tokens:      600,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      throw new Error(`AI HTTP ${res.status}`);
    }

    const result  = await res.json();
    const content = result?.choices?.[0]?.message?.content ?? '';
    const parsed  = JSON.parse(content);

    // Preserve internal underscore metadata keys from currentSessionData
    const mergedData = { ...(currentSessionData ?? {}), ...(parsed.data ?? {}) };
    for (const k of Object.keys(mergedData)) {
      if (!k.startsWith('_') && typeof mergedData[k] === 'string') {
        mergedData[k] = normalizeDigits(mergedData[k]);
      }
    }

    return {
      status:        parsed.status === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
      data:          mergedData,
      next_question: typeof parsed.next_question === 'string' ? parsed.next_question : '',
    };
  } catch (err) {
    // Graceful fallback to deterministic slot-filling engine so user flow never breaks
    console.warn('[AI] Fallback to deterministic slot-filling:', err.message);
    return processConversationDeterministic(userMessage, currentSessionData, normalizedTask);
  }
}
