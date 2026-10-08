import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ApprovalsResponseSchema, type ApprovalItem } from '../shared/schemas';
import type { Config } from './config';
import { loadDataset } from './domain/approvals';
import { createAiHandlers } from './handlers/ai';
import { HttpError, errorBody } from './http/errors';
import { aiRateLimiters, generalRateLimiter, validateSession } from './http/limits';
import type { LlmProvider } from './llm/types';

export interface Logger {
  info(o: Record<string, unknown>): void;
  warn(o: Record<string, unknown>): void;
  error(o: Record<string, unknown>): void;
}

export interface AppDeps {
  config: Config;
  provider: LlmProvider;
  /** Injected clock so age/overdue maths is deterministic in tests. */
  now: () => Date;
  /** Pending approvals. Injected so tests can supply hostile data. */
  getQueue: () => ApprovalItem[];
  logger: Logger;
}

export const consoleLogger: Logger = {
  info: (o) => console.log(JSON.stringify({ level: 'info', ...o })),
  warn: (o) => console.warn(JSON.stringify({ level: 'warn', ...o })),
  error: (o) => console.error(JSON.stringify({ level: 'error', ...o })),
};

const requireJson = (req: Request, _res: Response, next: NextFunction) =>
  req.is('application/json') ? next() : next(new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json'));

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // No CORS: the browser reaches this API same-origin through the Next.js rewrite.
  app.use(helmet());
  app.use((_req, res, next) => {
    const id = randomUUID();
    res.locals.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/approvals', generalRateLimiter(deps.config), (_req, res) => {
    const items = deps.getQueue();
    res.json(ApprovalsResponseSchema.parse({ items, pendingCount: items.length }));
  });

  const ai = express.Router();
  const handlers = createAiHandlers(deps);
  // Guards run in this order: session check -> rate limits -> content type -> size-capped JSON parse.
  const guards = [validateSession, ...aiRateLimiters(deps.config), requireJson, express.json({ limit: '16kb', strict: true })];
  ai.post('/summary', ...guards, handlers.summary);
  ai.post('/greeting', ...guards, handlers.greeting);
  ai.post('/chat', ...guards, handlers.chat);
  ai.post('/help', ...guards, handlers.help);
  ai.post('/teach', ...guards, handlers.teach);
  app.use('/api/ai', ai);

  app.use((_req, res) => {
    res.status(404).json(errorBody('not_found', 'Not found', { requestId: res.locals.requestId as string }));
  });

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const requestId = res.locals.requestId as string | undefined;
    let status = 500;
    let body = errorBody('internal', 'Something went wrong.', { requestId });

    if (err instanceof HttpError) {
      status = err.status;
      body = errorBody(err.code, err.message, { requestId, issues: err.issues });
    } else if (typeof err === 'object' && err !== null && 'type' in err) {
      const type = String((err as { type: unknown }).type);
      if (type === 'entity.too.large') {
        status = 413;
        body = errorBody('payload_too_large', 'Request body too large', { requestId });
      } else if (type === 'entity.parse.failed' || type.startsWith('encoding.') || type.startsWith('charset.')) {
        status = 400;
        body = errorBody('bad_request', 'Malformed request body', { requestId });
      }
    }
    if (status === 500) deps.logger.error({ requestId, msg: 'unhandled error', err: err instanceof Error ? err.message : 'unknown' });
    if (res.headersSent) return void res.end();
    res.status(status).json(body);
  };
  app.use(onError);

  // Fail fast if the fixture is invalid.
  loadDataset();
  return app;
}
