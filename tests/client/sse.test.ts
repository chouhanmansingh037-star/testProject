import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, streamEvents } from '../../lib/sse';
import { SESSION_HEADER, SessionIdSchema } from '../../shared/schemas';
import { controlledSse, done, frame, jsonResponse, meta, sseOf, token } from './helpers';

afterEach(() => vi.unstubAllGlobals());

async function collect(res: Response | (() => Response | Promise<Response>)) {
  const fetchImpl = vi.fn(async () => (typeof res === 'function' ? res() : res)) as unknown as typeof fetch;
  const out = [];
  for await (const ev of streamEvents('/api/ai/chat', { message: 'x' }, new AbortController().signal, fetchImpl)) out.push(ev);
  return { out, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

describe('streamEvents', () => {
  it('parses events even when chunks split an event in the middle', async () => {
    const text = frame(meta()) + frame(token('héllo 🌍')) + frame(done);
    const bytes = new TextEncoder().encode(text);
    // Deliver one byte at a time: also splits multi-byte characters.
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        for (const b of bytes) ctl.enqueue(new Uint8Array([b]));
        ctl.close();
      },
    });
    const { out } = await collect(new Response(stream, { status: 200 }));
    expect(out.map((e) => e.type)).toEqual(['meta', 'token', 'done']);
    expect(out[1]).toEqual({ type: 'token', text: 'héllo 🌍' });
  });

  it('sends the session header (a valid uuid) and a JSON body', async () => {
    const { fetchImpl } = await collect(sseOf([meta(), done]));
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(SessionIdSchema.safeParse(headers[SESSION_HEADER]).success).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ message: 'x' });
  });

  it('ignores SSE comments / keep-alives', async () => {
    const { out } = await collect(sseOf([meta(), done]).clone());
    expect(out).toHaveLength(2);
    const res = new Response(`: keep-alive\n\n${frame(meta())}${frame(done)}`, { status: 200 });
    expect((await collect(res)).out).toHaveLength(2);
  });

  it('maps HTTP errors: 429 keeps retry-after, 400 is bad_request, 500 is generic', async () => {
    const r429 = jsonResponse(429, { error: { code: 'rate_limited', message: 'slow down', retryAfterSec: 9 } });
    await expect(collect(r429)).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSec: 9 });
    await expect(collect(jsonResponse(400, { error: { code: 'bad_request', message: 'Invalid request' } }))).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(collect(new Response('<html>502 Bad Gateway</html>', { status: 502 }))).rejects.toMatchObject({ kind: 'http', message: expect.not.stringContaining('<html>') });
  });

  it('turns fetch rejection into a network error, but rethrows aborts untouched', async () => {
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const gen = streamEvents('/x', {}, new AbortController().signal, failing);
    await expect(gen.next()).rejects.toBeInstanceOf(ApiRequestError);

    const ctl = new AbortController();
    ctl.abort();
    const aborting = vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }) as unknown as typeof fetch;
    await expect(streamEvents('/x', {}, ctl.signal, aborting).next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed JSON and schema-violating events as protocol errors', async () => {
    await expect(collect(new Response('data: {not json\n\n', { status: 200 }))).rejects.toMatchObject({ kind: 'protocol' });
    await expect(collect(new Response(frame({ type: 'token' }), { status: 200 }))).rejects.toMatchObject({ kind: 'protocol' });
    await expect(collect(new Response(frame({ type: 'token', text: 'x', extra: 1 }), { status: 200 }))).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('errors when the stream ends without `done`, or the socket resets mid-stream', async () => {
    await expect(collect(sseOf([meta(), token('a')]))).rejects.toMatchObject({ kind: 'network' });
    const c = controlledSse();
    c.push(meta());
    const run = collect(c.response);
    c.fail();
    await expect(run).rejects.toMatchObject({ kind: 'network' });
  });
});
