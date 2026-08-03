let requestIdCounter = 0;

export function requestIdMiddleware(req, res, next) {
  const id = `req_${Date.now(0)}_${++requestIdCounter}_${Math.random().toString(36).slice(2, 8)}`;
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
