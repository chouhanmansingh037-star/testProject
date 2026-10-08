import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmProvider, type LlmRequest } from './types';

/** The slice of the SDK we use, so tests can inject a fake without network access. */
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
  };
}

export interface AnthropicOptions {
  apiKey: string | undefined;
  model: string;
  client?: AnthropicLike;
}

export function mapAnthropicError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined;
  if (status === 401 || status === 403) return new LlmError('auth', 'provider rejected credentials', { cause: e });
  if (status === 429) return new LlmError('rate_limited', 'provider rate limit', { cause: e });
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'APIUserAbortError')) return new LlmError('aborted', undefined, { cause: e });
  return new LlmError('upstream', 'provider call failed', { cause: e });
}

function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b: unknown) => ((b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
    .join('');
}

/**
 * Claude via the official SDK. Server-side only: the key is read from env by config and never
 * leaves this process. SDK retries are disabled because our guard owns timeouts and retries.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: AnthropicLike | undefined;

  constructor(private readonly opts: AnthropicOptions) {
    if (opts.client) this.client = opts.client;
    else if (opts.apiKey) this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }) as unknown as AnthropicLike;
  }

  private requireClient(): AnthropicLike {
    if (!this.client) throw new LlmError('auth', 'ANTHROPIC_API_KEY is not configured');
    return this.client;
  }

  private body(req: LlmRequest, stream: boolean): Record<string, unknown> {
    return {
      model: this.opts.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };
  }

  async complete(req: LlmRequest): Promise<string> {
    const client = this.requireClient();
    try {
      return extractText(await client.messages.create(this.body(req, false), { signal: req.signal }));
    } catch (e) {
      throw mapAnthropicError(e);
    }
  }

  async *stream(req: LlmRequest): AsyncGenerator<string, void, void> {
    const client = this.requireClient();
    try {
      const events = (await client.messages.create(this.body(req, true), { signal: req.signal })) as AsyncIterable<{
        type: string;
        delta?: { type?: string; text?: string };
      }>;
      for await (const ev of events) {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) yield ev.delta.text;
      }
    } catch (e) {
      throw mapAnthropicError(e);
    }
  }
}
