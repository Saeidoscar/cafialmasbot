export function loadEnv() {
  const required = ['BOT_TOKEN', 'AGENT_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`متغیرهای محیطی ضروری تنظیم نشده‌اند: ${missing.join(', ')}`);
  }
}

export function getAgentApiKey() {
  return process.env.AGENT_API_KEY;
}

export function getDashboardApiKey() {
  return process.env.DASHBOARD_API_KEY;
}

export const ENV = {
  NODE_ENV:        process.env.NODE_ENV ?? 'development',
  PORT:            process.env.PORT ? Number(process.env.PORT) : 3000,
  BOT_TOKEN:       process.env.BOT_TOKEN,
  AGENT_API_KEY:   process.env.AGENT_API_KEY ? '[REDACTED]' : undefined,
  DASHBOARD_API_KEY: process.env.DASHBOARD_API_KEY ? '[REDACTED]' : undefined,
  DB_PATH:         process.env.DB_PATH ?? './data/cafe.db',
  APP_URL:         process.env.APP_URL,
  OPENAI_API_KEY:  process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  OPENAI_MODEL:    process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
};
