import { LlmError, type LlmProvider, type LlmRequestInput } from './types';

export interface CompleteOptions {
  timeoutMs: number;
  parentSignal?: AbortSignal;
}

export interface StreamOptions {
  /** Max wait for the first token. */
  firstTokenMs: number;
  /** Max silence between tokens. */
  idleMs: number;
  /** Hard cap for the whole stream. */
  totalMs: number;
  parentSignal?: AbortSignal;
}

/**
 * Settles with `p`, or rejects with a typed LlmError on timeout / abort. Works even when the
 * provider ignores the abort signal, so a stalled call can never hang a request.
 */
function raceWithDeadline<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new LlmError('aborted'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new LlmError('timeout', `no response within ${ms}ms`));
    }, ms);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e: unknown) => {
        cleanup();
        reject(e);
      },
    );
  });
}

/** Provider-specific errors are collapsed to a coarse code; raw messages never leave the server. */
export function normalizeError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  return new LlmError('upstream', 'provider call failed', { cause: e });
}

function linkedController(parent?: AbortSignal): { ctl: AbortController; unlink: () => void } {
  const ctl = new AbortController();
  const onParent = () => ctl.abort();
  if (parent?.aborted) ctl.abort();
  else parent?.addEventListener('abort', onParent, { once: true });
  return { ctl, unlink: () => parent?.removeEventListener('abort', onParent) };
}

export async function completeWithTimeout(
  provider: LlmProvider,
  req: LlmRequestInput,
  { timeoutMs, parentSignal }: CompleteOptions,
): Promise<string> {
  const { ctl, unlink } = linkedController(parentSignal);
  try {
    const call = Promise.resolve().then(() => provider.complete({ ...req, signal: ctl.signal }));
    call.catch(() => undefined); // avoid unhandled rejection if we stop waiting first
    return await raceWithDeadline(call, timeoutMs, ctl.signal);
  } catch (e) {
    throw normalizeError(e);
  } finally {
    ctl.abort();
    unlink();
  }
}

export async function* streamWithTimeouts(
  provider: LlmProvider,
  req: LlmRequestInput,
  { firstTokenMs, idleMs, totalMs, parentSignal }: StreamOptions,
): AsyncGenerator<string, void, void> {
  const { ctl, unlink } = linkedController(parentSignal);
  const deadline = Date.now() + totalMs;
  let it: AsyncIterator<string> | undefined;
  try {
    it = provider.stream({ ...req, signal: ctl.signal })[Symbol.asyncIterator]();
    let first = true;
    for (;;) {
      const wait = Math.min(first ? firstTokenMs : idleMs, deadline - Date.now());
      if (wait <= 0) throw new LlmError('timeout', `stream exceeded ${totalMs}ms`);
      const next = it.next();
      next.catch(() => undefined);
      const r = await raceWithDeadline(next, wait, ctl.signal);
      if (r.done) return;
      first = false;
      yield r.value;
    }
  } catch (e) {
    throw normalizeError(e);
  } finally {
    ctl.abort();
    unlink();
    // Fire and forget: a stalled generator may never settle `return()`.
    void Promise.resolve(it?.return?.()).catch(() => undefined);
  }
}
