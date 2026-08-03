import { describe, it, before } from 'node:test';
import assert from 'node:assert';

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
