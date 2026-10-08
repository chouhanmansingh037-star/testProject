import { z } from 'zod';
import { completeWithTimeout, streamWithTimeouts } from '../../server/llm/guard';
import { completeStructured } from '../../server/llm/structured';
import { LlmError, type LlmProvider, type LlmRequest, type LlmRequestInput } from '../../server/llm/types';

const baseReq: LlmRequestInput = {
  task: 'chat',
  system: 's',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 100,
  mockContext: { pending: [], now: new Date('2026-10-08T00:00:00Z') },
};

function provider(impl: Partial<LlmProvider>): LlmProvider {
  return {
    name: 'test',
    complete: async () => 'ok',
    stream: async function* () {
      yield 'ok';
    },
    ...impl,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of it) out.push(t);
  return out;
}

describe('completeWithTimeout', () => {
  it('returns the provider text', async () => {
    await expect(completeWithTimeout(provider({}), baseReq, { timeoutMs: 100 })).resolves.toBe('ok');
  });

  it('times out and aborts the request signal', async () => {
    let seen: AbortSignal | undefined;
    const p = provider({
      complete: (req: LlmRequest) =>
        new Promise((_, reject) => {
          seen = req.signal;
          req.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    await expect(completeWithTimeout(p, baseReq, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
    expect(seen?.aborted).toBe(true);
  });

  it('still times out when the provider ignores the abort signal', async () => {
    const p = provider({ complete: () => new Promise(() => undefined) });
    await expect(completeWithTimeout(p, baseReq, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps unknown errors to upstream and preserves LlmError codes', async () => {
    const boom = provider({ complete: async () => { throw new Error('secret-provider-detail'); } });
    await expect(completeWithTimeout(boom, baseReq, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'upstream' });
    const auth = provider({ complete: async () => { throw new LlmError('auth'); } });
    await expect(completeWithTimeout(auth, baseReq, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'auth' });
  });

  it('reports aborted when the parent signal fires (client disconnect)', async () => {
    const ctl = new AbortController();
    const p = provider({ complete: () => new Promise(() => undefined) });
    const pending = completeWithTimeout(p, baseReq, { timeoutMs: 1000, parentSignal: ctl.signal });
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('streamWithTimeouts', () => {
  const opts = { firstTokenMs: 40, idleMs: 40, totalMs: 500 };

  it('yields every token', async () => {
    const p = provider({ stream: async function* () { yield 'a'; yield 'b'; } });
    await expect(collect(streamWithTimeouts(p, baseReq, opts))).resolves.toEqual(['a', 'b']);
  });

  it('fails with timeout when no first token arrives', async () => {
    const p = provider({ stream: async function* () { await sleep(300); yield 'late'; } });
    await expect(collect(streamWithTimeouts(p, baseReq, opts))).rejects.toMatchObject({ code: 'timeout' });
  });

  it('fails with timeout when the stream stalls mid-way, after delivering earlier tokens', async () => {
    const p = provider({ stream: async function* () { yield 'a'; await sleep(300); yield 'b'; } });
    const got: string[] = [];
    await expect(
      (async () => { for await (const t of streamWithTimeouts(p, baseReq, opts)) got.push(t); })(),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(got).toEqual(['a']);
  });

  it('enforces the total time cap even when tokens keep trickling in', async () => {
    const p = provider({ stream: async function* () { for (;;) { await sleep(10); yield 'x'; } } });
    await expect(
      collect(streamWithTimeouts(p, baseReq, { firstTokenMs: 100, idleMs: 100, totalMs: 80 })),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps mid-stream provider errors, and stops on parent abort', async () => {
    const bad = provider({ stream: async function* () { yield 'a'; throw new Error('x'); } });
    await expect(collect(streamWithTimeouts(bad, baseReq, opts))).rejects.toMatchObject({ code: 'upstream' });

    const ctl = new AbortController();
    const slow = provider({ stream: async function* () { yield 'a'; await sleep(200); yield 'b'; } });
    const run = collect(streamWithTimeouts(slow, baseReq, { ...opts, idleMs: 400, parentSignal: ctl.signal }));
    setTimeout(() => ctl.abort(), 20);
    await expect(run).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('completeStructured', () => {
  const schema = z.strictObject({ n: z.number() });
  const run = (p: LlmProvider, semantic?: (v: { n: number }) => string | null) =>
    completeStructured(p, baseReq, schema, { timeoutMs: 100, maxAttempts: 2, semanticCheck: semantic });

  it('parses valid JSON', async () => {
    await expect(run(provider({ complete: async () => '{"n":1}' }))).resolves.toEqual({ n: 1 });
  });

  it('accepts a response that is exactly one fenced json block', async () => {
    await expect(run(provider({ complete: async () => '```json\n{"n":2}\n```' }))).resolves.toEqual({ n: 2 });
  });

  it('does not extract JSON from surrounding prose', async () => {
    const p = provider({ complete: async () => 'Sure! {"n":1} hope that helps' });
    await expect(run(p)).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('retries once on a bad shape, then succeeds', async () => {
    const complete = jest.fn().mockResolvedValueOnce('{"n":"x"}').mockResolvedValueOnce('{"n":3}');
    await expect(run(provider({ complete }))).resolves.toEqual({ n: 3 });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('gives up with invalid_output after maxAttempts; rejects extra keys and empty text', async () => {
    const complete = jest.fn().mockResolvedValue('{"n":1,"extra":true}');
    await expect(run(provider({ complete }))).rejects.toMatchObject({ code: 'invalid_output' });
    expect(complete).toHaveBeenCalledTimes(2);
    await expect(run(provider({ complete: async () => '' }))).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('applies the semantic check and retries when it fails', async () => {
    const complete = jest.fn().mockResolvedValueOnce('{"n":1}').mockResolvedValueOnce('{"n":2}');
    const out = await run(provider({ complete }), (v) => (v.n === 1 ? 'n must not be 1' : null));
    expect(out).toEqual({ n: 2 });
  });

  it('does NOT retry timeouts or auth failures (retrying would blow the latency budget)', async () => {
    const t = jest.fn().mockImplementation(() => new Promise(() => undefined));
    await expect(
      completeStructured(provider({ complete: t }), baseReq, schema, { timeoutMs: 20, maxAttempts: 2 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(t).toHaveBeenCalledTimes(1);

    const a = jest.fn().mockRejectedValue(new LlmError('auth'));
    await expect(run(provider({ complete: a }))).rejects.toMatchObject({ code: 'auth' });
    expect(a).toHaveBeenCalledTimes(1);
  });
});
