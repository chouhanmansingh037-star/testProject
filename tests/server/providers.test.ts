import { AnthropicProvider, mapAnthropicError, type AnthropicLike } from '../../server/llm/anthropic';
import { MockProvider } from '../../server/llm/mock';
import { createProvider } from '../../server/llm/factory';
import { loadConfig } from '../../server/config';
import { LlmError, type LlmRequest } from '../../server/llm/types';

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  task: 'chat',
  system: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 50,
  signal: new AbortController().signal,
  mockContext: { pending: [], now: new Date('2026-10-08T00:00:00Z') },
  ...over,
});

async function collect(it: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const t of it) out.push(t);
  return out;
}

describe('AnthropicProvider (fake SDK client)', () => {
  it('sends model, system, messages and max_tokens, and joins text blocks', async () => {
    const create = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Hello ' }, { type: 'tool_use' }, { type: 'text', text: 'world' }] });
    const p = new AnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', client: { messages: { create } } as AnthropicLike });
    await expect(p.complete(req())).resolves.toBe('Hello world');
    const [body, opts] = create.mock.calls[0] as [Record<string, unknown>, { signal: AbortSignal }];
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 50, system: 'sys', stream: false, messages: [{ role: 'user', content: 'hi' }] });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('streams only text deltas', async () => {
    async function* events() {
      yield { type: 'message_start' };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } };
      yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } };
    }
    const p = new AnthropicProvider({ apiKey: 'k', model: 'm', client: { messages: { create: async () => events() } } as unknown as AnthropicLike });
    await expect(collect(p.stream(req()))).resolves.toEqual(['a', 'b']);
  });

  it('with no API key, every call fails with `auth` and never touches the network', async () => {
    const p = new AnthropicProvider({ apiKey: undefined, model: 'm' });
    await expect(p.complete(req())).rejects.toMatchObject({ code: 'auth' });
    await expect(collect(p.stream(req()))).rejects.toMatchObject({ code: 'auth' });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [500, 'upstream'],
    [529, 'upstream'],
    [undefined, 'upstream'],
  ])('maps provider status %s to %s without leaking the original message', (status, code) => {
    const mapped = mapAnthropicError(Object.assign(new Error('sk-ant-SECRET leaked text'), { status }));
    expect(mapped.code).toBe(code);
    expect(mapped.message).not.toContain('SECRET');
  });

  it('recognises aborts and preserves LlmError', () => {
    expect(mapAnthropicError(Object.assign(new Error('x'), { name: 'AbortError' })).code).toBe('aborted');
    const e = new LlmError('timeout');
    expect(mapAnthropicError(e)).toBe(e);
  });
});

describe('MockProvider', () => {
  it('stops generating when the request is aborted', async () => {
    const ctl = new AbortController();
    const p = new MockProvider({ delayMs: 20 });
    const it = p.stream(req({ signal: ctl.signal, mockContext: { pending: [], now: new Date(), question: 'hello' } }));
    const first = it[Symbol.asyncIterator]();
    await first.next();
    ctl.abort();
    await expect(first.next()).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('config + factory', () => {
  it('defaults to the mock provider (runs without any key)', () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.provider).toBe('mock');
    expect(c.llmTimeoutMs).toBe(8000);
    expect(createProvider(c).name).toBe('mock');
  });

  it('treats a blank API key as missing and still builds the anthropic provider', () => {
    const c = loadConfig({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '   ' } as NodeJS.ProcessEnv);
    expect(c.anthropicApiKey).toBeUndefined();
    expect(createProvider(c).name).toBe('anthropic');
  });

  it('rejects out-of-range numbers', () => {
    expect(() => loadConfig({ LLM_TIMEOUT_MS: '999999' } as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadConfig({ PORT: '0' } as NodeJS.ProcessEnv)).toThrow();
  });
});
