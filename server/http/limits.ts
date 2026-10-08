import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { SESSION_HEADER, SessionIdSchema } from '../../shared/schemas';
import type { Config } from '../config';
import { HttpError, errorBody } from './errors';

/** Rejects a present-but-malformed session id before it can be used as a rate-limit key. */
export const validateSession: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const raw = req.get(SESSION_HEADER);
  if (raw !== undefined && !SessionIdSchema.safeParse(raw).success) {
    return next(new HttpError(400, 'bad_request', `Invalid ${SESSION_HEADER} header`));
  }
  next();
};

function limiter(max: number, windowMs: number, key: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: key,
    handler: (req, res) => {
      const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
      const resetMs = info?.resetTime ? info.resetTime.getTime() - Date.now() : windowMs;
      const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json(
        errorBody('rate_limited', 'Too many requests. Please slow down and try again shortly.', {
          retryAfterSec,
          requestId: res.locals.requestId as string | undefined,
        }),
      );
    },
  });
}

const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown');

/**
 * Two layers: a per-session bucket (fair use per tab) and a larger per-IP bucket, because a
 * client can mint fresh session ids but cannot mint fresh IPs. Both are in-memory (single
 * process); a shared store such as Redis would be needed to scale horizontally.
 */
export function aiRateLimiters(config: Config): RequestHandler[] {
  const { sessionMax, ipMax, windowMs } = config.rateLimit;
  return [
    limiter(ipMax, windowMs, (req) => `ip:${ipKey(req)}`),
    limiter(sessionMax, windowMs, (req) => {
      const sid = req.get(SESSION_HEADER);
      return sid ? `sid:${sid}` : `ip:${ipKey(req)}`;
    }),
  ];
}

export function generalRateLimiter(config: Config): RequestHandler {
  return limiter(config.rateLimit.ipMax * 5, config.rateLimit.windowMs, (req) => `ip:${ipKey(req)}`);
}
