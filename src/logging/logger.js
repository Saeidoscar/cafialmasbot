const SENSITIVE_PATTERNS = [
  { pattern: /(?:[Bb]ot[Tt]oken|BOT_TOKEN)\s*[:=]\s*([^\s,}]+)/g,              mask: '[REDACTED_BOT_TOKEN]' },
  { pattern: /(?:[Aa]gent[_-]?[Kk]ey|AGENT_API_KEY)\s*[:=]\s*([^\s,}]+)/g,     mask: '[REDACTED_AGENT_KEY]' },
  { pattern: /(?:[Oo]pen[_-]?[Aa][Ii]|OPENAI_API_KEY)\s*[:=]\s*([^\s,}]+)/g,   mask: '[REDACTED_OPENAI_KEY]' },
  { pattern: /\b09\d{9}\b/g,                                                        mask: '[REDACTED_PHONE]' },
  { pattern: /\b\d{10,}\b/g,                                                        mask: '[REDACTED_ID]' },
  { pattern: /"Authorization"\s*:\s*"[^"]*"/g,                                      mask: '"Authorization": "[REDACTED]"' },
];

export function maskSensitive(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const { pattern, mask } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, mask);
  }
  return result;
}

export function safeLog(prefix, data, requestId) {
  const id = requestId ? `[${requestId}]` : '';
  const masked = maskSensitive(JSON.stringify(data));
  console.log(`${prefix}${id}`, masked);
}

export function safeError(prefix, data, requestId) {
  const id = requestId ? `[${requestId}]` : '';
  const masked = maskSensitive(JSON.stringify(data));
  console.error(`${prefix}${id}`, masked);
}
