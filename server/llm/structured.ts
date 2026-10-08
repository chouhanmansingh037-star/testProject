import type { z } from 'zod';
import { completeWithTimeout } from './guard';
import { LlmError, type LlmProvider, type LlmRequestInput } from './types';

export interface StructuredOptions<T> {
  timeoutMs: number;
  /** Total attempts when the output is malformed (timeouts and auth errors are never retried). */
  maxAttempts: number;
  /** Cross-checks the parsed value against facts we own. Return an error string to reject it. */
  semanticCheck?: (value: T) => string | null | undefined;
  parentSignal?: AbortSignal;
}

/** Accepts a response that is exactly one fenced block; anything else must already be raw JSON. */
function unwrapFence(text: string): string {
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);
  return m?.[1] ?? text;
}

function parseOnce<T>(text: string, schema: z.ZodType<T>, semantic?: StructuredOptions<T>['semanticCheck']): T {
  const trimmed = text.trim();
  if (!trimmed) throw new LlmError('invalid_output', 'empty response');
  let json: unknown;
  try {
    json = JSON.parse(unwrapFence(trimmed));
  } catch {
    throw new LlmError('invalid_output', 'response is not valid JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new LlmError('invalid_output', `schema mismatch: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  const problem = semantic?.(parsed.data);
  if (problem) throw new LlmError('invalid_output', problem);
  return parsed.data;
}

/**
 * LLM call that must return JSON matching `schema`. The UI never sees model text that has not
 * passed through here: shape (strict Zod) first, then semantic checks against our own data.
 */
export async function completeStructured<T>(
  provider: LlmProvider,
  req: LlmRequestInput,
  schema: z.ZodType<T>,
  opts: StructuredOptions<T>,
): Promise<T> {
  let last: LlmError = new LlmError('invalid_output');
  for (let attempt = 1; attempt <= Math.max(1, opts.maxAttempts); attempt++) {
    const text = await completeWithTimeout(provider, req, {
      timeoutMs: opts.timeoutMs,
      parentSignal: opts.parentSignal,
    });
    try {
      return parseOnce(text, schema, opts.semanticCheck);
    } catch (e) {
      if (!(e instanceof LlmError) || e.code !== 'invalid_output') throw e;
      last = e;
    }
  }
  throw last;
}
