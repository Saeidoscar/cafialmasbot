export function ok(data = null, message = 'موفق') {
  return { ok: true, data, message, timestamp: new Date().toISOString() };
}

export function fail(error, statusCode = 500) {
  const payload = {
    ok: false,
    error: error?.message ?? String(error),
    code: error?.code ?? 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
  };
  if (error?.field) payload.field = error.field;
  return { payload, statusCode };
}
