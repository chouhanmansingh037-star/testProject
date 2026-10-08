import type { Response } from 'express';
import { SseEventSchema, type SseEvent } from '../../shared/schemas';

export function openSse(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/** Validates every outgoing event against the shared contract, so the server cannot ship a bad shape. */
export function sendEvent(res: Response, event: SseEvent): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(SseEventSchema.parse(event))}\n\n`);
}

export function endSse(res: Response): void {
  sendEvent(res, { type: 'done' });
  if (!res.writableEnded) res.end();
}

/** Aborts when the client goes away before we finished (tab closed, Stop pressed, navigation). */
export function clientGoneSignal(res: Response): AbortSignal {
  const ctl = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ctl.abort();
  });
  return ctl.signal;
}
