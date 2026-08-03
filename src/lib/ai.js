// ─────────────────────────────────────────────
// lib/ai.js — یکپارچه‌سازی ArvanCloud AI (GPT-5-Nano)
// ─────────────────────────────────────────────

export const TASK_REQUIRED_FIELDS = {
  SANA: ['national_id', 'birth_date', 'mobile_number', 'serial_number'],
  GICA: ['national_id', 'birth_date', 'mobile_number', 'tracking_code'],
};

const FIELD_METADATA = {
  national_id:   { label: 'کد ملی',         desc: '10-digit Iranian national ID',              errorHint: 'باید دقیقاً ۱۰ رقم باشد' },
  birth_date:    { label: 'تاریخ تولد',      desc: 'Birth date YYYY/MM/DD (e.g. 1370/05/15)',  errorHint: 'فرمت صحیح: ۱۳۷۰/۰۵/۱۵' },
  mobile_number: { label: 'شماره موبایل',    desc: '11-digit mobile starting with 09',          errorHint: 'باید ۱۱ رقم و با ۰۹ شروع شود' },
  serial_number: { label: 'سریال شناسنامه', desc: 'Birth certificate serial, letter+digits',   errorHint: 'مثال: ب۱۲۳۴۵۶ یا A123456' },
  tracking_code: { label: 'کد رهگیری',      desc: 'GICA alphanumeric tracking code (6–20ch)', errorHint: 'باید ۶ تا ۲۰ کاراکتر الفبا-عددی باشد' },
};

export function getRequiredFields(taskType) {
  return TASK_REQUIRED_FIELDS[taskType] ?? [];
}

export function getFieldLabel(fieldKey) {
  return FIELD_METADATA[fieldKey]?.label ?? fieldKey;
}

export async function processConversationWithAI(userMessage, currentSessionData, taskType) {
  const apiKey  = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model   = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const url     = `${baseUrl}/chat/completions`;

  if (!apiKey) throw new Error('OPENAI_API_KEY تنظیم نشده است.');

  const requiredFields = TASK_REQUIRED_FIELDS[taskType];
  if (!requiredFields) throw new Error(`نوع کار ناشناخته: "${taskType}"`);

  const fieldTable = requiredFields.map((f) => {
    const m = FIELD_METADATA[f] ?? { label: f, desc: f, errorHint: '' };
    return `  • "${f}" (${m.label}): ${m.desc}. راهنمای اعتبارسنجی: ${m.errorHint}`;
  }).join('\n');

  const systemPrompt =
    `You are an AI assistant in an Iranian Internet Cafe management system.\n` +
    `Collect info for ${taskType} government portal registration.\n\n` +
    `REQUIRED FIELDS:\n${fieldTable}\n\n` +
    `RULES:\n` +
    `1. Extract matching fields from user message.\n` +
    `2. Merge with CURRENT_COLLECTED_DATA, never drop valid fields.\n` +
    `3. Validate: national_id=10digits, mobile=11digits starting 09, birth_date=YYYY/MM/DD, serial=letter+digits, tracking=6-20 alphanumeric.\n` +
    `4. Invalid value → exclude from data, ask to re-enter.\n` +
    `5. All valid → status:COMPLETE, next_question:"".\n` +
    `6. Missing/invalid → status:INCOMPLETE, ask ONE field in friendly Persian.\n` +
    `7. Unrelated → redirect in Persian.\n\n` +
    `OUTPUT JSON only:\n{"status":"COMPLETE"|"INCOMPLETE","data":{...},"next_question":"..."}`;

  const userPrompt =
    `CURRENT_COLLECTED_DATA:\n${JSON.stringify(currentSessionData ?? {}, null, 2)}\n\n` +
    `USER_MESSAGE:\n"${userMessage}"`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages:        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature:     0.1,
      max_tokens:      600,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`ArvanCloud AI HTTP ${res.status}: ${err}`);
  }

  const result  = await res.json();
  const content = result?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('پاسخ هوش مصنوعی خالی است.');

  let parsed;
  try { parsed = JSON.parse(content); }
  catch {
    console.error('[AI] خروجی نامعتبر:', content);
    throw new Error('هوش مصنوعی خروجی نامعتبر برگرداند.');
  }

  return {
    status:        parsed.status === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
    data:          typeof parsed.data === 'object' && parsed.data !== null ? parsed.data : {},
    next_question: typeof parsed.next_question === 'string' ? parsed.next_question : '',
  };
}
