import type { Express } from 'express';
import request from 'supertest';
import { loadConfig, type Config } from '../../server/config';
import { createApp, type AppDeps } from '../../server/app';
import { MockProvider, type MockMode } from '../../server/llm/mock';
import type { LlmProvider } from '../../server/llm/types';
import { getPendingItems, loadDataset } from '../../server/domain/approvals';
import type { SseEvent } from '../../shared/schemas';
import { SseEventSchema } from '../../shared/schemas';

export const FIXED_NOW = new Date('2026-10-08T10:00:00Z');
export const SESSION = '123e4567-e89b-42d3-a456-426614174000';

export const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function testConfig(over: Partial<Record<string, string>> = {}): Config {
  return loadConfig({ MOCK_DELAY_MS: '0', LLM_TIMEOUT_MS: '200', ...over } as NodeJS.ProcessEnv);
}

export function buildApp(opts: { mode?: MockMode; provider?: LlmProvider; env?: Record<string, string>; deps?: Partial<AppDeps> } = {}): Express {
  const config = testConfig(opts.env);
  const provider = opts.provider ?? new MockProvider({ mode: opts.mode ?? 'ok', delayMs: 0 });
  return createApp({
    config,
    provider,
    now: () => FIXED_NOW,
    getQueue: () => getPendingItems(loadDataset().items),
    logger: silentLogger,
    ...opts.deps,
  });
}

export function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) throw new Error(`SSE block without data: ${block}`);
      return SseEventSchema.parse(JSON.parse(line.slice(6)));
    });
}

/** POST to an AI route and return status + parsed (and schema-validated) SSE events. */
export async function postSse(app: Express, path: string, body: unknown, session: string | null = SESSION) {
  const req = request(app).post(path).set('Content-Type', 'application/json');
  if (session) req.set('x-session-id', session);
  const res = await req
    .send(JSON.stringify(body))
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (data += c));
      r.on('end', () => cb(null, data));
    });
  const isSse = String(res.headers['content-type'] ?? '').includes('text/event-stream');
  return { status: res.status, headers: res.headers, raw: res.body as string, events: isSse ? parseSse(res.body as string) : [] };
}

export function tokensOf(events: SseEvent[]): string {
  return events.map((e) => (e.type === 'token' ? e.text : '')).join('');
}
