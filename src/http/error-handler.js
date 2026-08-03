import { AppError, AuthError, RateLimitError, ValidationError } from '../errors/AppError.js';
import { fail } from './response.js';

export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== 'production';
  const requestId = req?.id ?? 'unknown';

  if (err instanceof AppError) {
    const { payload, statusCode } = fail(err, err.statusCode);
    const response = { ...payload, requestId };
    if (isDev && err.stack) {
      console.error(`[Error:${requestId}]`, err);
    }
    return res.status(statusCode).json(response);
  }

  const unknownError = new AppError('خطای سیستمی.', 500, 'INTERNAL_ERROR');
  const { payload, statusCode } = fail(unknownError, 500);
  console.error(`[Unhandled:${requestId}]`, err);
  return res.status(statusCode).json({ ...payload, requestId });
}

export { AuthError, RateLimitError, ValidationError };
