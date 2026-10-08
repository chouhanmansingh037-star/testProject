import { ApiErrorSchema, SESSION_HEADER, SseEventSchema, type ErrorCode, type SseEvent } from '../shared/schemas';

/** A request-level failure (network down, HTTP error, protocol violation) as opposed to an AI failure. */
export class ApiRequestError extends Error {
  constructor(
    public readonly kind: 'network' | 'http' | 'protocol' | 'rate_limited' | 'bad_request',
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export type { ErrorCode };

export function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem('approvals.sessionId');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem('approvals.sessionId', fresh);
    return fresh;
  } catch {
    // Storage blocked (private mode etc.): a per-page-load id still keeps the throttle fair.
    memoryId ??= crypto.randomUUID();
    return memoryId;
  }
}
let memoryId: string | undefined;

async function errorFromResponse(res: Response): Promise<ApiRequestError> {
  let message = `Request failed (${res.status}).`;
  let retryAfterSec: number | undefined;
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) {
      message = parsed.data.error.message;
      retryAfterSec = parsed.data.error.retryAfterSec;
    }
  } catch {
    /* body was not JSON (proxy error page etc.): keep the generic message */
  }
  if (res.status === 429) return new ApiRequestError('rate_limited', message, retryAfterSec);
  if (res.status === 400 || res.status === 413 || res.status === 415) return new ApiRequestError('bad_request', message);
  return new ApiRequestError('http', res.status >= 500 ? 'The service is unavailable right now.' : message);
}

/**
 * POSTs to an AI route and yields schema-validated SSE events. Nothing from the network reaches the UI
 * without passing SseEventSchema. Throws ApiRequestError (or an AbortError when `signal` fires).
 */
export async function* streamEvents(
  path: string,
  body: unknown,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<SseEvent, void, void> {
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SESSION_HEADER]: getSessionId() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiRequestError('network', 'Could not reach the server. Check your connection.');
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new ApiRequestError('protocol', 'The server sent an empty response.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (signal.aborted) throw e;
        throw new ApiRequestError('network', 'The connection was lost.');
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue; // comments / keep-alives
        let json: unknown;
        try {
          json = JSON.parse(dataLine.slice(6));
        } catch {
          throw new ApiRequestError('protocol', 'The server sent an unreadable event.');
        }
        const parsed = SseEventSchema.safeParse(json);
        if (!parsed.success) throw new ApiRequestError('protocol', 'The server sent an unexpected response shape.');
        if (parsed.data.type === 'done') sawDone = true;
        yield parsed.data;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (!sawDone) throw new ApiRequestError('network', 'The connection closed before the answer finished.');
}
