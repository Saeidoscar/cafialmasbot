// ─────────────────────────────────────────────
// local_agent/scraper.js — Playwright Automation Agent
//
// Responsibilities:
//   1. Poll the tgcloud bot's HTTP API every 30 seconds for PENDING jobs
//   2. Atomically claim each job (PENDING → PROCESSING)
//   3. Launch Chromium (headed, so the cafe operator can solve the CAPTCHA manually)
//   4. Fill the SANA or GICA form using the job's payload
//   5. Wait for the operator to submit and page to navigate
//   6. Report COMPLETED or FAILED back to the API
//
// SETUP:
//   cd local_agent
//   npm install
//   npx playwright install chromium
//   cp ../.env.example .env   (then fill in AGENT_API_KEY and BOT_API_URL)
//   node scraper.js
// ─────────────────────────────────────────────

import { chromium }    from 'playwright';
import axios           from 'axios';
import { config }      from 'dotenv';

// Load .env from the local_agent directory (or the project root as fallback)
config({ path: new URL('.env', import.meta.url).pathname });
config({ path: new URL('../.env', import.meta.url).pathname });

// ─────────────────────────────────────────────
// Configuration (from environment variables)
// ─────────────────────────────────────────────

/**
 * Full base URL of your tgcloud bot's HTTP webhook.
 * Example: https://my-bot.tgcloud.io
 */
const BOT_API_URL = process.env.BOT_API_URL?.replace(/\/$/, '');

/**
 * Shared secret that matches AGENT_API_KEY on the bot side.
 */
const AGENT_API_KEY = process.env.AGENT_API_KEY;

/**
 * How often (ms) the agent polls for new jobs.
 */
const POLL_INTERVAL_MS = 30_000;

/**
 * Time (ms) given to the human operator to solve the CAPTCHA and submit the form.
 * Increase this on slow connections.
 */
const CAPTCHA_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * URLs for each government portal.
 * Override via environment variables if the portals change.
 */
const PORTAL_URLS = {
  SANA:      process.env.SANA_PORTAL_URL ?? 'https://sana.ir',
  GICA:      process.env.GICA_PORTAL_URL ?? 'https://gica.ir',
  MYGOV:     process.env.MYGOV_PORTAL_URL ?? 'https://my.gov.ir',
  TAX:       process.env.TAX_PORTAL_URL ?? 'https://my.tax.gov.ir',
  INSURANCE: process.env.INSURANCE_PORTAL_URL ?? 'https://eservice.tamin.ir',
  MOJAVEZ:   process.env.MOJAVEZ_PORTAL_URL ?? 'https://mojavez.ir',
  AMLAK:     process.env.AMLAK_PORTAL_URL ?? 'https://amlak.mrud.ir',
  KHODNEWIS: process.env.KHODNEWIS_PORTAL_URL ?? 'https://khodnevis.mrud.ir',
  SAMAN:     process.env.SAMAN_PORTAL_URL ?? 'https://saman.mrud.ir',
};

// ─────────────────────────────────────────────
// Axios instance — pre-configured with auth header
// ─────────────────────────────────────────────

const api = axios.create({
  baseURL: BOT_API_URL,
  headers: { 'X-Api-Key': AGENT_API_KEY },
  timeout: 15_000,
});

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────

/**
 * Fetch PENDING jobs from the bot API.
 *
 * @returns {Promise<Array>}
 */
async function fetchPendingJobs() {
  const res = await api.get('/api/jobs', { params: { status: 'PENDING', limit: 3 } });
  return res.data?.jobs ?? [];
}

/**
 * Atomically claim a job (PENDING → PROCESSING).
 * Returns true if claim succeeded, false if the job was already taken by
 * another agent instance (race condition protection via HTTP 409).
 *
 * @param {number|string} jobId
 * @returns {Promise<boolean>}
 */
async function claimJob(jobId) {
  try {
    await api.post(`/api/jobs/${jobId}/claim`);
    return true;
  } catch (err) {
    if (err.response?.status === 409) {
      console.log(`[Agent] Job #${jobId} already claimed by another instance. Skipping.`);
      return false;
    }
    throw err;
  }
}

/**
 * Mark a job as COMPLETED.
 *
 * @param {number|string} jobId
 */
async function completeJob(jobId) {
  await api.post(`/api/jobs/${jobId}/complete`);
}

/**
 * Mark a job as FAILED and record the reason.
 *
 * @param {number|string} jobId
 * @param {string} errorMessage
 */
async function failJob(jobId, errorMessage) {
  await api.post(`/api/jobs/${jobId}/fail`, { error_message: errorMessage });
}

// ─────────────────────────────────────────────
// SANA Portal Automation
// ─────────────────────────────────────────────

/**
 * Fill and submit the SANA registration form.
 *
 * Fields expected in `payload`:
 *   national_id    — 10-digit Iranian national ID
 *   birth_date     — YYYY/MM/DD
 *   mobile_number  — 11-digit mobile (starts with 09)
 *   serial_number  — birth certificate serial (e.g. B123456)
 *
 * The browser launches headed (visible) so the cafe operator can solve the
 * image/audio CAPTCHA manually and then press the submit button.
 * The agent waits up to CAPTCHA_TIMEOUT_MS for a navigation event that signals
 * a successful or error submission.
 *
 * @param {object} page      Playwright Page
 * @param {object} payload   Parsed job payload JSON
 */
async function runSanaAutomation(page, payload) {
  console.log('[SANA] Navigating to portal…');
  await page.goto(PORTAL_URLS.SANA, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // ── Fill national ID ──────────────────────────────────────────────────────
  // NOTE: Selectors below are representative. Update them to match the live
  //       SANA portal's actual element IDs/names if they change.
  await page.fill('input[name="nationalCode"], #nationalCode, #national_id', payload.national_id);

  // ── Fill birth date ───────────────────────────────────────────────────────
  await page.fill('input[name="birthDate"], #birthDate, #birth_date', payload.birth_date);

  // ── Fill mobile number ────────────────────────────────────────────────────
  await page.fill('input[name="mobile"], #mobile, #mobileNumber, #mobile_number', payload.mobile_number);

  // ── Fill birth certificate serial ─────────────────────────────────────────
  await page.fill('input[name="serialNumber"], #serialNumber, #serial_number', payload.serial_number);

  // ── Wait for CAPTCHA solve + manual form submission ────────────────────────
  console.log(
    `[SANA] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  // waitForNavigation resolves when the page navigates away (i.e. form submitted)
  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  // ── Check for error messages on the result page ───────────────────────────
  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`SANA portal returned an error: ${errorText.trim()}`);
  }

  console.log('[SANA] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// GICA Portal Automation
// ─────────────────────────────────────────────

/**
 * Fill and submit the GICA registration form.
 *
 * Fields expected in `payload`:
 *   national_id    — 10-digit Iranian national ID
 *   birth_date     — YYYY/MM/DD
 *   mobile_number  — 11-digit mobile
 *   tracking_code  — alphanumeric tracking code from a prior submission
 *
 * @param {object} page      Playwright Page
 * @param {object} payload   Parsed job payload JSON
 */
async function runGicaAutomation(page, payload) {
  console.log('[GICA] Navigating to portal…');
  await page.goto(PORTAL_URLS.GICA, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // ── Fill fields ───────────────────────────────────────────────────────────
  await page.fill('input[name="nationalCode"], #nationalCode, #national_id', payload.national_id);
  await page.fill('input[name="birthDate"],    #birthDate,    #birth_date',  payload.birth_date);
  await page.fill('input[name="mobile"],       #mobile,       #mobile_number', payload.mobile_number);
  await page.fill('input[name="trackingCode"], #trackingCode, #tracking_code', payload.tracking_code);

  // ── Wait for operator CAPTCHA + submit ────────────────────────────────────
  console.log(
    `[GICA] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  // ── Check for error messages ──────────────────────────────────────────────
  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`GICA portal returned an error: ${errorText.trim()}`);
  }

  console.log('[GICA] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// my.gov.ir Portal Automation
// ─────────────────────────────────────────────

async function runMygovAutomation(page, payload) {
  console.log('[MYGOV] Navigating to portal…');
  await page.goto(PORTAL_URLS.MYGOV, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.fill('input[name="phone"], #phone, #phoneNumber', payload.phone_number);
  await page.fill('input[name="nationalCode"], #nationalCode', payload.national_id);
  await page.fill('input[name="birthDate"], #birthDate', payload.birth_date);
  await page.fill('input[name="birthPlace"], #birthPlace', payload.birth_place);

  console.log(
    `[MYGOV] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`MYGOV portal returned an error: ${errorText.trim()}`);
  }

  console.log('[MYGOV] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// my.tax.gov.ir Portal Automation
// ─────────────────────────────────────────────

async function runTaxAutomation(page, payload) {
  console.log('[TAX] Navigating to portal…');
  await page.goto(PORTAL_URLS.TAX, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.fill('input[name="nationalCode"], #nationalCode', payload.national_id);
  await page.fill('input[name="birthDate"], #birthDate', payload.birth_date);
  await page.fill('input[name="mygovToken"], #mygovToken', payload.mygov_token);
  if (payload.tax_id) {
    await page.fill('input[name="taxId"], #taxId', payload.tax_id);
  }

  console.log(
    `[TAX] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`TAX portal returned an error: ${errorText.trim()}`);
  }

  console.log('[TAX] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// eservice.tamin.ir Portal Automation
// ─────────────────────────────────────────────

async function runInsuranceAutomation(page, payload) {
  console.log('[INSURANCE] Navigating to portal…');
  await page.goto(PORTAL_URLS.INSURANCE, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.fill('input[name="nationalCode"], #nationalCode', payload.national_id);
  await page.fill('input[name="birthDate"], #birthDate', payload.birth_date);
  await page.fill('input[name="insuranceNumber"], #insuranceNumber', payload.insurance_number);
  await page.selectOption('select[name="insuranceType"], #insuranceType', payload.insurance_type);

  console.log(
    `[INSURANCE] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`INSURANCE portal returned an error: ${errorText.trim()}`);
  }

  console.log('[INSURANCE] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// mojavez.ir Portal Automation
// ─────────────────────────────────────────────

async function runMojavezAutomation(page, payload) {
  console.log('[MOJAVEZ] Navigating to portal…');
  await page.goto(PORTAL_URLS.MOJAVEZ, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.fill('input[name="nationalCode"], #nationalCode', payload.national_id);
  await page.fill('input[name="birthDate"], #birthDate', payload.birth_date);
  await page.fill('input[name="businessType"], #businessType', payload.business_type);
  await page.fill('input[name="businessAddress"], #businessAddress', payload.business_address);

  console.log(
    `[MOJAVEZ] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`MOJAVEZ portal returned an error: ${errorText.trim()}`);
  }

  console.log('[MOJAVEZ] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// amlak.mrud.ir Portal Automation
// ─────────────────────────────────────────────

async function runAmlakAutomation(page, payload) {
  console.log('[AMLAK] Navigating to portal…');
  await page.goto(PORTAL_URLS.AMLAK, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.fill('input[name="nationalCode"], #nationalCode', payload.national_id);
  await page.fill('input[name="birthDate"], #birthDate', payload.birth_date);
  await page.fill('input[name="address"], #address', payload.address);
  await page.fill('input[name="postCode"], #postCode', payload.post_code);

  console.log(
    `[AMLAK] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`AMLAK portal returned an error: ${errorText.trim()}`);
  }

  console.log('[AMLAK] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// khodnevis.mrud.ir Portal Automation
// ─────────────────────────────────────────────

async function runKhodnevisAutomation(page, payload) {
  console.log('[KHODNEWIS] Navigating to portal…');
  await page.goto(PORTAL_URLS.KHODNEWIS, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.fill('input[name="nationalCode"], #nationalCode', payload.national_id);
  await page.fill('input[name="birthDate"], #birthDate', payload.birth_date);
  await page.fill('input[name="contractType"], #contractType', payload.contract_type);

  console.log(
    `[KHODNEWIS] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`KHODNEWIS portal returned an error: ${errorText.trim()}`);
  }

  console.log('[KHODNEWIS] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// saman.mrud.ir Portal Automation
// ─────────────────────────────────────────────

async function runSamanAutomation(page, payload) {
  console.log('[SAMAN] Navigating to portal…');
  await page.goto(PORTAL_URLS.SAMAN, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.fill('input[name="nationalCode"], #nationalCode', payload.national_id);
  await page.fill('input[name="birthDate"], #birthDate', payload.birth_date);
  await page.fill('input[name="loanAmount"], #loanAmount', String(payload.loan_amount));
  await page.fill('input[name="loanType"], #loanType', payload.loan_type);

  console.log(
    `[SAMAN] ⚠️  CAPTCHA visible. Operator has ${CAPTCHA_TIMEOUT_MS / 1000}s to solve and submit.`
  );

  await page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout:   CAPTCHA_TIMEOUT_MS,
  });

  const errorEl = await page.$('.error-message, .alert-danger, [class*="error"]');
  if (errorEl) {
    const errorText = await errorEl.innerText();
    throw new Error(`SAMAN portal returned an error: ${errorText.trim()}`);
  }

  console.log('[SAMAN] Form submitted successfully.');
}

// ─────────────────────────────────────────────
// Job Dispatcher
// ─────────────────────────────────────────────

/**
 * Process a single scraping job end-to-end:
 *   1. Claim it
 *   2. Launch Chromium (headed for CAPTCHA)
 *   3. Run the appropriate automation
 *   4. Report result back to the API
 *
 * @param {object} job  Job row from GET /api/jobs
 */
async function processJob(job) {
  const jobId = job.id;
  console.log(`\n[Agent] Processing job #${jobId} | type=${job.task_type} | user=${job.user_id}`);

  // ── Claim the job (atomic, prevents double-processing) ────────────────────
  const claimed = await claimJob(jobId);
  if (!claimed) return; // Another agent instance took it

  let payload;
  try {
    payload = JSON.parse(job.payload || '{}');
  } catch {
    await failJob(jobId, 'Invalid JSON payload stored in job.');
    return;
  }

  // ── Launch headed Chromium ─────────────────────────────────────────────────
  // headless: false is intentional — the cafe operator must solve the CAPTCHA
  const browser = await chromium.launch({
    headless: false,
    args:     ['--window-size=1280,800'],
  });

  const context = await browser.newContext({
    viewport:          { width: 1280, height: 800 },
    locale:            'fa-IR',   // Persian locale for correct date/text rendering
    timezoneId:        'Asia/Tehran',
    acceptDownloads:   false,
  });

  const page = await context.newPage();

  try {
    // ── Dispatch to task-specific automation ──────────────────────────────
    switch (job.task_type) {
      case 'SANA':      await runSanaAutomation(page, payload); break;
      case 'GICA':      await runGicaAutomation(page, payload); break;
      case 'MYGOV':     await runMygovAutomation(page, payload); break;
      case 'TAX':       await runTaxAutomation(page, payload); break;
      case 'INSURANCE': await runInsuranceAutomation(page, payload); break;
      case 'MOJAVEZ':   await runMojavezAutomation(page, payload); break;
      case 'AMLAK':     await runAmlakAutomation(page, payload); break;
      case 'KHODNEWIS': await runKhodnevisAutomation(page, payload); break;
      case 'SAMAN':     await runSamanAutomation(page, payload); break;
      default:
        throw new Error(`Unknown task_type: "${job.task_type}"`);
    }

    await completeJob(jobId);
    console.log(`[Agent] ✅ Job #${jobId} completed.`);

  } catch (err) {
    const msg = err.message ?? String(err);
    console.error(`[Agent] ❌ Job #${jobId} failed:`, msg);
    await failJob(jobId, msg);

  } finally {
    // Always close the browser, even on failure, to free OS resources
    await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────
// Poll Loop
// ─────────────────────────────────────────────

/**
 * One poll cycle: fetch pending jobs and process each sequentially.
 * Sequential processing is deliberate — the cafe has a single operator
 * who solves CAPTCHAs one at a time.
 */
async function pollCycle() {
  let jobs;
  try {
    jobs = await fetchPendingJobs();
  } catch (err) {
    console.error('[Agent] Failed to fetch jobs:', err.message);
    return;
  }

  if (jobs.length === 0) {
    process.stdout.write('.'); // Heartbeat dot — shows the agent is alive
    return;
  }

  console.log(`\n[Agent] Found ${jobs.length} pending job(s).`);

  for (const job of jobs) {
    try {
      await processJob(job);
    } catch (outerErr) {
      // Catch unexpected errors so a single bad job doesn't crash the poll loop
      console.error(`[Agent] Unexpected error processing job #${job.id}:`, outerErr.message);
      await failJob(job.id, `Unexpected agent error: ${outerErr.message}`).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────
// Entry Point & Startup Checks
// ─────────────────────────────────────────────

function validateConfig() {
  const errors = [];
  if (!BOT_API_URL)   errors.push('BOT_API_URL is not set in .env');
  if (!AGENT_API_KEY) errors.push('AGENT_API_KEY is not set in .env');

  if (errors.length > 0) {
    console.error('\n[Agent] ❌ Configuration errors:');
    errors.forEach((e) => console.error('  -', e));
    console.error('\nCreate a .env file in local_agent/ (copy from ../.env.example) and fill in the values.\n');
    process.exit(1);
  }
}

async function main() {
  validateConfig();

  console.log('─────────────────────────────────────────');
  console.log(' Smart Cafe Local Scraper Agent');
  console.log(`  API URL    : ${BOT_API_URL}`);
  console.log(`  Poll every : ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  CAPTCHA timeout: ${CAPTCHA_TIMEOUT_MS / 1000}s`);
  console.log('─────────────────────────────────────────\n');

  // Run once immediately, then on a fixed interval
  await pollCycle();
  setInterval(pollCycle, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[Agent] Fatal startup error:', err);
  process.exit(1);
});
