import { vi } from 'vitest';
import type { SseEvent } from '../../shared/schemas';

const enc = new TextEncoder();
export const frame = (ev: unknown): string => `data: ${JSON.stringify(ev)}\n\n`;

export interface Controlled {
  response: Response;
  push: (ev: SseEvent | unknown) => void;
  pushRaw: (text: string) => void;
  close: () => void;
  fail: () => void;
}

/** An SSE response the test drives by hand, so intermediate UI states can be asserted. */
export function controlledSse(signal?: AbortSignal | null): Controlled {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  signal?.addEventListener('abort', () => {
    try {
      ctl.error(new DOMException('Aborted', 'AbortError'));
    } catch {
      /* already closed */
    }
  });
  return {
    response: new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (ev) => ctl.enqueue(enc.encode(frame(ev))),
    pushRaw: (t) => ctl.enqueue(enc.encode(t)),
    close: () => ctl.close(),
    fail: () => ctl.error(new Error('socket reset')),
  };
}

/** A complete SSE response made of the given events. */
export function sseOf(events: unknown[], signal?: AbortSignal | null): Response {
  const c = controlledSse(signal);
  for (const e of events) c.push(e);
  c.close();
  return c.response;
}

export const meta = (extra: Record<string, unknown> = {}) => ({ type: 'meta', promptVersion: 'test@v1', ...extra });
export const token = (text: string) => ({ type: 'token', text });
export const done = { type: 'done' };

export const greetingResult = (greeting = 'Hello! You have 4 approvals waiting.', source = 'ai') => ({
  type: 'result',
  data: { kind: 'greeting', source, pendingCount: 4, greeting },
});

export const summaryResult = (source: 'ai' | 'fallback' | 'static' = 'ai') => ({
  type: 'result',
  data: {
    kind: 'summary',
    source,
    pendingCount: 2,
    headline: '2 approvals are pending. Start with "Safety Equipment & Sensor Specs".',
    overallUrgency: 'high',
    items: [
      { id: 'apr-003', title: 'Safety Equipment & Sensor Specs', type: 'pdf', submittedBy: 'Sam HelpAdmin', priority: 'high', reason: 'Safety-critical content.', suggestedAction: 'Review now.' },
      { id: 'apr-004', title: '360° Spatial Zone Layout & Camera Map', type: 'image', submittedBy: 'Elena HelpAdmin', priority: 'low', reason: 'Lower impact.', suggestedAction: 'Review in queue order.' },
    ],
  },
});

export interface Call {
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
}
export type Handler = (call: Call) => Response | Promise<Response>;

/** Routes fetch by URL path. Unknown paths fail the test loudly. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const call = { url, body, signal: init?.signal };
    calls.push(call);
    const handler = routes[url];
    if (!handler) throw new Error(`Unexpected fetch to ${url}`);
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn, to: (url: string) => calls.filter((c) => c.url === url) };
}

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
