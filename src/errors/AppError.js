export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

export class ValidationError extends AppError {
  constructor(message, field) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

export class AuthError extends AppError {
  constructor(message = 'احراز هویت ناموفق بود.') {
    super(message, 401, 'AUTH_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'منبع یافت نشد.') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'تعداد درخواست‌ها بیش از حد مجاز است.') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}
