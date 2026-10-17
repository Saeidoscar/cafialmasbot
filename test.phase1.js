import { describe, it, before } from 'node:test';
import assert from 'node:assert';

process.env.DB_PATH = ':memory:';

import { ok, fail } from './src/http/response.js';
import { isValidTelegramId, sanitizeText, isValidJobId, validateStatus, validateLimit } from './src/validation/validators.js';
import { maskSensitive, safeLog, safeError } from './src/logging/logger.js';
import { validateUploadedFile, ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE } from './src/middleware/upload.js';
import { errorHandler, AuthError, RateLimitError, ValidationError } from './src/http/error-handler.js';
import { AppError, NotFoundError } from './src/errors/AppError.js';
import { requestIdMiddleware } from './src/http/request-id.js';

describe('Phase 1 Base Tests', () => {
  it('ok() returns standardized success response', () => {
    const res = ok({ id: 1 }, 'موفق');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data.id, 1);
    assert.strictEqual(res.message, 'موفق');
    assert.ok(res.timestamp);
  });

  it('fail() returns standardized error response', () => {
    const err = new Error('test error');
    const res = fail(err, 400);
    assert.strictEqual(res.payload.ok, false);
    assert.strictEqual(res.payload.error, 'test error');
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.payload.timestamp);
  });

  it('isValidTelegramId validates numeric strings', () => {
    assert.strictEqual(isValidTelegramId('123456789'), true);
    assert.strictEqual(isValidTelegramId('abc'), false);
    assert.strictEqual(isValidTelegramId(''), false);
  });

  it('sanitizeText trims and limits length', () => {
    assert.strictEqual(sanitizeText('  hello  '), 'hello');
    assert.strictEqual(sanitizeText('a'.repeat(5000)).length, 4096);
  });

  it('isValidJobId validates positive integers', () => {
    assert.strictEqual(isValidJobId(1), true);
    assert.strictEqual(isValidJobId(0), false);
    assert.strictEqual(isValidJobId(-1), false);
    assert.strictEqual(isValidJobId(1.5), false);
  });

  it('validateStatus checks allowed values', () => {
    assert.strictEqual(validateStatus('PENDING', ['PENDING', 'COMPLETED']), true);
    assert.strictEqual(validateStatus('UNKNOWN', ['PENDING', 'COMPLETED']), false);
  });

  it('validateLimit caps and defaults', () => {
    assert.strictEqual(validateLimit(10), 10);
    assert.strictEqual(validateLimit(200), 100);
    assert.strictEqual(validateLimit(-5), 50);
  });

  it('maskSensitive redacts tokens and IDs', () => {
    const input = 'BOT_TOKEN=1234567890:abcdef and mobile 09123456789';
    const masked = maskSensitive(input);
    assert.ok(!masked.includes('1234567890'));
    assert.ok(!masked.includes('09123456789'));
    assert.ok(masked.includes('[REDACTED_BOT_TOKEN]'));
    assert.ok(masked.includes('[REDACTED_PHONE]'));
  });
});

describe('Config and Logging', () => {
  it('loadEnv does not throw when env vars are present', async () => {
    process.env.BOT_TOKEN = 'test-token';
    process.env.AGENT_API_KEY = 'test-agent-key';
    const { loadEnv } = await import('./src/config/env.js');
    assert.doesNotThrow(() => loadEnv());
  });

  it('getAgentApiKey returns the raw key', async () => {
    process.env.AGENT_API_KEY = 'my-secret-key';
    const { getAgentApiKey } = await import('./src/config/env.js');
    assert.strictEqual(getAgentApiKey(), 'my-secret-key');
  });

  it('getDashboardApiKey returns the raw key', async () => {
    process.env.DASHBOARD_API_KEY = 'my-dashboard-key';
    const { getDashboardApiKey } = await import('./src/config/env.js');
    assert.strictEqual(getDashboardApiKey(), 'my-dashboard-key');
  });

  it('safeLog includes requestId when provided', () => {
    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' '); };
    try {
      safeLog('[Test]', { foo: 'bar' }, 'req_123');
      assert.ok(output.includes('[req_123]'));
    } finally {
      console.log = originalLog;
    }
  });

  it('safeError includes requestId when provided', () => {
    let output = '';
    const originalError = console.error;
    console.error = (...args) => { output += args.join(' '); };
    try {
      safeError('[Test]', { foo: 'bar' }, 'req_456');
      assert.ok(output.includes('[req_456]'));
    } finally {
      console.error = originalError;
    }
  });
});

describe('Upload Middleware', () => {
  it('validateUploadedFile rejects missing file', () => {
    const res = validateUploadedFile(null);
    assert.strictEqual(res.ok, false);
  });

  it('validateUploadedFile rejects oversized file', () => {
    const res = validateUploadedFile({ size: MAX_UPLOAD_SIZE + 1, type: 'image/jpeg' });
    assert.strictEqual(res.ok, false);
  });

  it('validateUploadedFile rejects disallowed mime type', () => {
    const res = validateUploadedFile({ size: 1024, type: 'application/zip' });
    assert.strictEqual(res.ok, false);
  });

  it('validateUploadedFile accepts allowed file', () => {
    const res = validateUploadedFile({ size: 1024, type: 'image/jpeg' });
    assert.strictEqual(res.ok, true);
  });

  it('ALLOWED_UPLOAD_MIME_TYPES contains expected types', () => {
    assert.ok(ALLOWED_UPLOAD_MIME_TYPES.has('image/jpeg'));
    assert.ok(ALLOWED_UPLOAD_MIME_TYPES.has('application/pdf'));
    assert.ok(!ALLOWED_UPLOAD_MIME_TYPES.has('application/zip'));
  });
});

describe('Error Handler', () => {
  it('errorHandler returns AppError payload with requestId', () => {
    const err = new AuthError('احراز هویت ناموفق');
    const req = { id: 'req_789' };
    const res = {
      status: (code) => ({ json: (payload) => { res._status = code; res._payload = payload; } }),
      headersSent: false,
    };
    const next = () => {};
    errorHandler(err, req, res, next);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(res._payload.requestId, 'req_789');
    assert.strictEqual(res._payload.code, 'AUTH_ERROR');
  });

  it('errorHandler handles unknown errors with requestId', () => {
    const err = new Error(' unexpected');
    const req = { id: 'req_abc' };
    const res = {
      status: (code) => ({ json: (payload) => { res._status = code; res._payload = payload; } }),
      headersSent: false,
    };
    const next = () => {};
    errorHandler(err, req, res, next);
    assert.strictEqual(res._status, 500);
    assert.strictEqual(res._payload.requestId, 'req_abc');
    assert.strictEqual(res._payload.code, 'INTERNAL_ERROR');
  });
});

describe('Request ID Middleware', () => {
  it('requestIdMiddleware sets req.id and X-Request-Id header', () => {
    const req = {};
    const res = { setHeader: () => {} };
    const next = () => {};
    requestIdMiddleware(req, res, next);
    assert.ok(req.id);
    assert.ok(req.id.startsWith('req_'));
  });
});

describe('Auth Flow (unit)', () => {
  it('AuthError has correct defaults', () => {
    const err = new AuthError();
    assert.strictEqual(err.statusCode, 401);
    assert.strictEqual(err.code, 'AUTH_ERROR');
    assert.strictEqual(err.message, 'احراز هویت ناموفق بود.');
  });

  it('RateLimitError has correct defaults', () => {
    const err = new RateLimitError();
    assert.strictEqual(err.statusCode, 429);
    assert.strictEqual(err.code, 'RATE_LIMIT_EXCEEDED');
  });

  it('ValidationError includes field', () => {
    const err = new ValidationError('نامعتبر', 'email');
    assert.strictEqual(err.statusCode, 400);
    assert.strictEqual(err.field, 'email');
  });

  it('NotFoundError has correct defaults', () => {
    const err = new NotFoundError();
    assert.strictEqual(err.statusCode, 404);
    assert.strictEqual(err.code, 'NOT_FOUND');
  });
});

describe('Repository Layer (mocked)', () => {
  let mockDb;

  before(() => {
    mockDb = {
      prepare: () => ({
        get: (...args) => ({ c: 5 }),
        all: (...args) => [{ id: 1, status: 'PENDING' }],
        run: (...args) => ({ changes: 1 }),
      }),
      exec: () => {},
    };
  });

  it('UsersRepository.count returns count', async () => {
    const { UsersRepository } = await import('./src/db/repository.js');
    const repo = new UsersRepository(mockDb);
    assert.strictEqual(repo.count(), 5);
  });

  it('ScrapingJobsRepository.count returns count', async () => {
    const { ScrapingJobsRepository } = await import('./src/db/repository.js');
    const repo = new ScrapingJobsRepository(mockDb);
    assert.strictEqual(repo.count(), 5);
  });

  it('ScrapingJobsRepository.countByStatus returns count', async () => {
    const { ScrapingJobsRepository } = await import('./src/db/repository.js');
    const repo = new ScrapingJobsRepository(mockDb);
    assert.strictEqual(repo.countByStatus('PENDING'), 5);
  });

  it('ScrapingJobsRepository.findById returns row', async () => {
    const { ScrapingJobsRepository } = await import('./src/db/repository.js');
    const repo = new ScrapingJobsRepository(mockDb);
    const row = repo.findById(1);
    assert.ok(row);
  });

  it('ScrapingJobsRepository.findPending returns rows', async () => {
    const { ScrapingJobsRepository } = await import('./src/db/repository.js');
    const repo = new ScrapingJobsRepository(mockDb);
    const rows = repo.findPending();
    assert.ok(Array.isArray(rows));
    assert.strictEqual(rows.length, 1);
  });

  it('ScrapingJobsRepository.findRecent returns rows', async () => {
    const { ScrapingJobsRepository } = await import('./src/db/repository.js');
    const repo = new ScrapingJobsRepository(mockDb);
    const rows = repo.findRecent(10);
    assert.ok(Array.isArray(rows));
    assert.strictEqual(rows.length, 1);
  });

  it('ScrapingJobsRepository.findByStatus returns rows', async () => {
    const { ScrapingJobsRepository } = await import('./src/db/repository.js');
    const repo = new ScrapingJobsRepository(mockDb);
    const rows = repo.findByStatus('PENDING', 10);
    assert.ok(Array.isArray(rows));
    assert.strictEqual(rows.length, 1);
  });

  it('ScrapingJobsRepository.updateStatus runs', async () => {
    const { ScrapingJobsRepository } = await import('./src/db/repository.js');
    const repo = new ScrapingJobsRepository(mockDb);
    assert.doesNotThrow(() => repo.updateStatus(1, 'COMPLETED'));
  });

  it('LinkedChatsRepository.findByUserAndChat returns row', async () => {
    const { LinkedChatsRepository } = await import('./src/db/repository.js');
    const repo = new LinkedChatsRepository(mockDb);
    const row = repo.findByUserAndChat('123', '456');
    assert.ok(row);
  });
});

describe('Migration Runner (mocked)', () => {
  it('getMigrations returns array', async () => {
    const { getMigrations } = await import('./src/db/migration-runner.js');
    const migrations = getMigrations();
    assert.ok(Array.isArray(migrations));
    assert.ok(migrations.length >= 1);
  });

  it('ensureMigrationsTable creates table', async () => {
    const { ensureMigrationsTable } = await import('./src/db/migration-runner.js');
    await assert.doesNotReject(ensureMigrationsTable);
  });
});

describe('Backup Functions (mocked)', () => {
  it('listBackups returns empty array when dir missing', async () => {
    const { listBackups } = await import('./src/db/backup.js');
    const backups = await listBackups();
    assert.ok(Array.isArray(backups));
  });

  it('getDbPath returns DB_PATH', async () => {
    const { getDbPath } = await import('./src/db/backup.js');
    assert.ok(typeof getDbPath() === 'string');
  });
});

describe('Route Handling (unit)', () => {
  it('ok() response has correct shape for routes', () => {
    const res = ok([{ id: 1 }]);
    assert.strictEqual(res.ok, true);
    assert.ok(Array.isArray(res.data));
  });

  it('fail() response has correct shape for auth errors', () => {
    const err = new AuthError();
    const res = fail(err, err.statusCode);
    assert.strictEqual(res.payload.ok, false);
    assert.strictEqual(res.payload.code, 'AUTH_ERROR');
  });

  it('fail() response has correct shape for rate limit errors', () => {
    const err = new RateLimitError();
    const res = fail(err, err.statusCode);
    assert.strictEqual(res.payload.ok, false);
    assert.strictEqual(res.payload.code, 'RATE_LIMIT_EXCEEDED');
  });

  it('fail() response has correct shape for validation errors', () => {
    const err = new ValidationError('نامعتبر', 'field');
    const res = fail(err, err.statusCode);
    assert.strictEqual(res.payload.ok, false);
    assert.strictEqual(res.payload.code, 'VALIDATION_ERROR');
    assert.strictEqual(res.payload.field, 'field');
  });

  it('fail() response has correct shape for not found errors', () => {
    const err = new NotFoundError();
    const res = fail(err, err.statusCode);
    assert.strictEqual(res.payload.ok, false);
    assert.strictEqual(res.payload.code, 'NOT_FOUND');
  });
});

describe('Multi-Service Catalog & Hybrid AI/Deterministic Slot-Filling', () => {
  it('supports all 9 government & cafe services with required fields', async () => {
    const { ALL_SERVICE_CODES, SERVICES_CATALOG, normalizeDigits } = await import('./src/lib/services.js');
    const { getRequiredFields } = await import('./src/lib/ai.js');

    assert.strictEqual(ALL_SERVICE_CODES.length, 9);
    for (const code of ['SANA', 'GICA', 'MYGOV', 'TAX', 'INSURANCE', 'MOJAVEZ', 'AMLAK', 'KHODNEWIS', 'SAMAN']) {
      assert.ok(SERVICES_CATALOG[code], `Service ${code} should exist in catalog`);
      const fields = getRequiredFields(code);
      assert.ok(fields.length >= 3, `Service ${code} should have at least 3 required fields`);
    }
    assert.strictEqual(normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
  });

  it('extracts and completes SANA fields deterministically with Persian digits', async () => {
    const { processConversationDeterministic } = await import('./src/lib/ai.js');
    let state = {};

    const step1 = processConversationDeterministic('۰۰۱۲۳۴۵۶۷۸ ۱۳۷۰/۰۵/۱۵ ۰۹۱۲۳۴۵۶۷۸۹', state, 'SANA');
    assert.strictEqual(step1.status, 'INCOMPLETE');
    assert.strictEqual(step1.data.national_id, '0012345678');
    assert.strictEqual(step1.data.birth_date, '1370/05/15');
    assert.strictEqual(step1.data.mobile_number, '09123456789');

    const step2 = processConversationDeterministic('ب123456', step1.data, 'SANA');
    assert.strictEqual(step2.status, 'COMPLETE');
    assert.strictEqual(step2.data.serial_number, 'ب123456');
  });
});

describe('Dual-Bot Ecosystem: Service-End Bot + Manager-End Bot + n8n Webhook', () => {
  let db;
  let customerMessages = [];
  let managerMessages = [];
  let mockCustomerApi;
  let mockManagerApi;

  before(async () => {
    process.env.DB_PATH = ':memory:';
    const { getDb } = await import('./src/lib/db.js');
    db = getDb();

    mockCustomerApi = {
      sendMessage: async (p) => { customerMessages.push(p); return { message_id: customerMessages.length }; },
      editMessageText: async (p) => { customerMessages.push(p); return { message_id: customerMessages.length }; },
      answerCallbackQuery: async () => true,
      getChatMember: async () => ({ status: 'creator' }),
      getChat: async () => ({ title: 'Test Group' }),
    };

    mockManagerApi = {
      sendMessage: async (p) => { managerMessages.push(p); return { message_id: managerMessages.length }; },
      editMessageText: async (p) => { managerMessages.push(p); return { message_id: managerMessages.length }; },
      answerCallbackQuery: async () => true,
    };
  });

  it('Manager Bot: registers manager, sets time slots, and toggles services', async () => {
    const { handleManagerMessage, handleManagerCallbackQuery } = await import('./src/handlers/manager.js');
    const { TimeSlotsRepository, ManagersRepository } = await import('./src/db/repository.js');

    managerMessages = [];
    await handleManagerMessage(
      mockManagerApi,
      db,
      { from: { id: 777001, username: 'mgr_ali', first_name: 'علی' }, chat: { id: 777001 }, text: '/register_manager admin123' },
      {},
      mockCustomerApi
    );
    assert.ok(managerMessages.length >= 1);

    await handleManagerMessage(
      mockManagerApi,
      db,
      { from: { id: 777001, username: 'mgr_ali', first_name: 'علی' }, chat: { id: 777001 }, text: '/set_time 1405/07/28 09:00 11:00 2' },
      {},
      mockCustomerApi
    );

    const slotsRepo = new TimeSlotsRepository(db);
    const openSlots = await slotsRepo.listOpenSlots('SANA');
    assert.ok(openSlots.length >= 1);
    assert.strictEqual(openSlots[0].start_time, '09:00');

    const mgrRepo = new ManagersRepository(db);
    await handleManagerCallbackQuery(
      mockManagerApi,
      db,
      { id: 'cq1', from: { id: 777001, username: 'mgr_ali' }, message: { chat: { id: 777001 }, message_id: 1 }, data: 'MGR_TOGGLE_SVC:SAMAN' },
      {},
      mockCustomerApi
    );
    const mgr = await mgrRepo.findById('777001');
    assert.ok(!mgr.services_offered.includes('SAMAN'));
  });

  it('Service Bot + Manager Bot: customer books slot, completes SANA, manager claims & delivers result, customer rates 5 stars', async () => {
    const { handleMessage } = await import('./src/handlers/message.js');
    const { handleCallbackQuery } = await import('./src/handlers/callback_query.js');
    const { handleManagerCallbackQuery, handleManagerMessage } = await import('./src/handlers/manager.js');
    const { TimeSlotsRepository, ScrapingJobsRepository, ManagersRepository } = await import('./src/db/repository.js');

    const slotsRepo = new TimeSlotsRepository(db);
    const jobsRepo  = new ScrapingJobsRepository(db);
    const mgrRepo   = new ManagersRepository(db);

    const slot = (await slotsRepo.listOpenSlots('SANA'))[0];
    assert.ok(slot);

    customerMessages = [];
    managerMessages = [];

    // Customer books the manager's slot for SANA
    await handleCallbackQuery(
      mockCustomerApi,
      db,
      {
        id: 'cq_book',
        from: { id: 888001, username: 'cust_sara', first_name: 'سارا' },
        message: { chat: { id: 888001 }, message_id: 10 },
        data: `BOOK_SLOT:${slot.id}:SANA`,
      },
      {},
      mockManagerApi
    );

    // Customer submits required fields
    await handleMessage(
      mockCustomerApi,
      db,
      { from: { id: 888001, username: 'cust_sara', first_name: 'سارا' }, chat: { id: 888001 }, text: '0012345678 1375/02/10 09121112233' },
      {},
      mockManagerApi
    );
    await handleMessage(
      mockCustomerApi,
      db,
      { from: { id: 888001, username: 'cust_sara', first_name: 'سارا' }, chat: { id: 888001 }, text: 'الف123456' },
      {},
      mockManagerApi
    );

    // Verify job was created, assigned to manager 777001, and manager was notified!
    const userJobs = await jobsRepo.findByUser('888001');
    assert.strictEqual(userJobs.length, 1);
    const job = userJobs[0];
    assert.strictEqual(job.task_type, 'SANA');
    assert.strictEqual(job.assigned_manager_id, '777001');
    assert.strictEqual(job.slot_id, slot.id);
    assert.ok(managerMessages.some((m) => String(m.text).includes('درخواست سرویس جدید')));

    // Manager claims the job
    await handleManagerCallbackQuery(
      mockManagerApi,
      db,
      { id: 'cq_claim', from: { id: 777001, username: 'mgr_ali' }, message: { chat: { id: 777001 }, message_id: 20 }, data: `MGR_CLAIM:${job.id}` },
      {},
      mockCustomerApi
    );
    assert.strictEqual((await jobsRepo.findById(job.id)).status, 'PROCESSING');

    // Manager delivers the final result
    await handleManagerMessage(
      mockManagerApi,
      db,
      { from: { id: 777001, username: 'mgr_ali', first_name: 'علی' }, chat: { id: 777001 }, text: `/complete ${job.id} کد رهگیری ثنا: 55443322` },
      {},
      mockCustomerApi
    );

    const completedJob = await jobsRepo.findById(job.id);
    assert.strictEqual(completedJob.status, 'COMPLETED');
    assert.ok(completedJob.result_data.summary.includes('55443322'));
    assert.ok(customerMessages.some((m) => String(m.text).includes('55443322')));

    // Customer rates the completed job 5 stars
    await handleCallbackQuery(
      mockCustomerApi,
      db,
      {
        id: 'cq_rate',
        from: { id: 888001, username: 'cust_sara' },
        message: { chat: { id: 888001 }, message_id: 30 },
        data: `RATE_JOB:${job.id}:5`,
      },
      {},
      mockManagerApi
    );
    const ratedJob = await jobsRepo.findById(job.id);
    assert.strictEqual(ratedJob.rating, 5);
    const updatedMgr = await mgrRepo.findById('777001');
    assert.strictEqual(updatedMgr.rating_sum, 5);
  });

  it('n8n Webhook Bridge: handles list_services, set_manager_slots, create_service_job, complete_job', async () => {
    const { handleN8nWebhook } = await import('./src/handlers/n8n.js');

    const svcRes = await handleN8nWebhook({ action: 'list_services' }, db, mockCustomerApi, mockManagerApi);
    assert.strictEqual(svcRes.ok, true);
    assert.strictEqual(svcRes.services.length, 9);

    const jobRes = await handleN8nWebhook(
      {
        action: 'create_service_job',
        user_id: '888002',
        username: 'n8n_user',
        task_type: 'TAX',
        payload: { national_id: '0011223344', birth_date: '1368/01/01' },
      },
      db,
      mockCustomerApi,
      mockManagerApi
    );
    assert.strictEqual(jobRes.ok, true);
    assert.strictEqual(jobRes.job.task_type, 'TAX');

    const doneRes = await handleN8nWebhook(
      {
        action: 'complete_job',
        job_id: jobRes.job.id,
        manager_id: '777001',
        result_text: 'پرونده مالیاتی تایید شد',
        tracking_code: 'TAX-998877',
      },
      db,
      mockCustomerApi,
      mockManagerApi
    );
    assert.strictEqual(doneRes.ok, true);
    assert.strictEqual(doneRes.job.status, 'COMPLETED');
  });
});

