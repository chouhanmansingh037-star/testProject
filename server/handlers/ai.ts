import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CHAT_PROMPT, GREETING_PROMPT, HELP_PROMPT, SUMMARY_PROMPT, TEACH_PROMPT } from '../../prompts';
import {
  ChatRequestSchema,
  GreetingModelOutputSchema,
  GreetingRequestSchema,
  HelpRequestSchema,
  MAX_MESSAGE_CHARS,
  SummaryModelOutputSchema,
  SummaryRequestSchema,
  TeachRequestSchema,
  type ChatMessage,
  type ErrorCode,
  type GreetingResult,
  type Priority,
  type SummaryModelOutput,
  type SummaryResult,
} from '../../shared/schemas';
import type { AppDeps } from '../app';
import { chatFallback, greetingFallback, helpFallback, summaryFallback, teachFallback } from '../domain/fallbacks';
import { rankApprovals, type RankedItem } from '../domain/priority';
import { retrieve } from '../domain/retriever';
import { sanitizeText, stripInvisible } from '../domain/sanitize';
import { HttpError, USER_MESSAGES, toErrorCode } from '../http/errors';
import { clientGoneSignal, endSse, openSse, sendEvent } from '../http/sse';
import { completeStructured } from '../llm/structured';
import { normalizeError, streamWithTimeouts } from '../llm/guard';
import type { LlmMessage, LlmRequestInput } from '../llm/types';

const MAX_OUTPUT_CHARS = 4000;
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function parseBody<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    // Paths and messages only: never echo submitted values back.
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
    throw new HttpError(400, 'bad_request', 'Invalid request', issues);
  }
  return parsed.data;
}

/** Providers need the conversation to start with a user turn; also strips hidden characters. */
function toLlmMessages(history: readonly ChatMessage[], latest: string): LlmMessage[] {
  const cleaned = history.map((m): LlmMessage => ({ role: m.role, content: sanitizeText(m.content, MAX_MESSAGE_CHARS * 4) }));
  while (cleaned[0]?.role === 'assistant') cleaned.shift();
  return [...cleaned, { role: 'user', content: sanitizeText(latest, MAX_MESSAGE_CHARS) }];
}

function buildSummary(out: SummaryModelOutput, ranked: readonly RankedItem[]): SummaryResult {
  const byId = new Map(ranked.map((r) => [r.item.id, r.item]));
  const items = out.items
    .flatMap((i) => {
      const item = byId.get(i.id);
      if (!item) return [];
      return [
        {
          id: item.id,
          title: item.title,
          type: item.type,
          submittedBy: item.submittedBy,
          priority: i.priority,
          reason: sanitizeText(i.reason, 300),
          suggestedAction: sanitizeText(i.suggestedAction, 200),
        },
      ];
    })
    // Array.prototype.sort is stable: the model's order is kept within each priority tier.
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  return {
    kind: 'summary',
    source: 'ai',
    pendingCount: ranked.length, // computed by us, never by the model
    headline: sanitizeText(out.headline, 240),
    overallUrgency: out.overallUrgency,
    items,
  };
}

function checkSummary(ranked: readonly RankedItem[]) {
  const expected = new Set(ranked.map((r) => r.item.id));
  return (v: SummaryModelOutput): string | null => {
    const ids = v.items.map((i) => i.id);
    if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) {
      return 'item ids do not match the queue';
    }
    const top = v.items.reduce<Priority>((acc, i) => (PRIORITY_RANK[i.priority] < PRIORITY_RANK[acc] ? i.priority : acc), 'low');
    return top === v.overallUrgency ? null : 'overallUrgency inconsistent with items';
  };
}

function checkGreeting(count: number) {
  return (v: { greeting: string }): string | null => {
    if (count > 0) return v.greeting.includes(String(count)) ? null : 'greeting does not state the pending count';
    return /[1-9]/.test(v.greeting) ? 'greeting states a count for an empty queue' : null;
  };
}

export function createAiHandlers(deps: AppDeps) {
  const { config, provider, logger } = deps;
  const timeoutMs = config.llmTimeoutMs;
  const requestId = (res: Response) => res.locals.requestId as string | undefined;

  function log(res: Response, task: string, fields: Record<string, unknown>): void {
    logger.info({ requestId: requestId(res), task, provider: provider.name, ...fields });
  }

  /** Streams a free-text answer. Failure before the first token => deterministic fallback; after => `interrupted`. */
  async function runStream(
    res: Response,
    task: string,
    promptVersion: string,
    request: LlmRequestInput,
    fallbackText: string,
    meta: { grounded?: boolean; sources?: { id: string; heading: string }[] } = {},
  ): Promise<void> {
    const started = Date.now();
    const signal = clientGoneSignal(res);
    openSse(res);
    sendEvent(res, { type: 'meta', promptVersion, ...meta });

    let tokens = 0;
    let chars = 0;
    let outcome = 'ok';
    let errorCode: ErrorCode | undefined;
    try {
      for await (const raw of streamWithTimeouts(provider, request, {
        firstTokenMs: timeoutMs,
        idleMs: timeoutMs,
        totalMs: Math.min(timeoutMs * 4, 30_000),
        parentSignal: signal,
      })) {
        const text = stripInvisible(raw).slice(0, MAX_OUTPUT_CHARS - chars);
        if (!text) continue;
        tokens++;
        chars += text.length;
        sendEvent(res, { type: 'token', text });
        if (chars >= MAX_OUTPUT_CHARS) {
          outcome = 'truncated';
          break;
        }
      }
      if (tokens === 0) {
        errorCode = 'invalid_output';
        outcome = 'fallback';
        sendEvent(res, { type: 'fallback', text: fallbackText, reason: errorCode });
      }
    } catch (e) {
      const err = normalizeError(e);
      errorCode = toErrorCode(err.code);
      if (err.code === 'aborted' && signal.aborted) {
        outcome = 'client_disconnected';
      } else if (tokens === 0) {
        outcome = 'fallback';
        sendEvent(res, { type: 'fallback', text: fallbackText, reason: errorCode });
      } else {
        outcome = 'interrupted';
        sendEvent(res, { type: 'error', code: 'interrupted', message: USER_MESSAGES.interrupted });
      }
    }
    endSse(res);
    log(res, task, { promptVersion, outcome, errorCode, tokens, durationMs: Date.now() - started });
  }

  return {
    async summary(req: Request, res: Response): Promise<void> {
      parseBody(SummaryRequestSchema, req);
      const started = Date.now();
      const signal = clientGoneSignal(res);
      const pending = deps.getQueue();
      const now = deps.now();
      const ranked = rankApprovals(pending, now);
      openSse(res);
      sendEvent(res, { type: 'meta', promptVersion: SUMMARY_PROMPT.version });

      let result: SummaryResult;
      let outcome = 'ok';
      let errorCode: ErrorCode | undefined;
      if (ranked.length === 0) {
        // Nothing to reason about: an LLM call would add cost and risk, not value.
        result = { ...summaryFallback([], now), source: 'static' };
        outcome = 'static';
      } else {
        try {
          const out = await completeStructured(
            provider,
            {
              task: 'summary',
              system: SUMMARY_PROMPT.system,
              messages: [{ role: 'user', content: SUMMARY_PROMPT.buildUser(ranked) }],
              maxTokens: 1200,
              mockContext: { pending, now },
            },
            SummaryModelOutputSchema,
            { timeoutMs, maxAttempts: 2, semanticCheck: checkSummary(ranked), parentSignal: signal },
          );
          result = buildSummary(out, ranked);
        } catch (e) {
          const err = normalizeError(e);
          errorCode = toErrorCode(err.code);
          outcome = 'fallback';
          result = summaryFallback(pending, now);
        }
      }
      sendEvent(res, { type: 'result', data: result });
      endSse(res);
      log(res, 'summary', { promptVersion: SUMMARY_PROMPT.version, outcome, errorCode, durationMs: Date.now() - started });
    },

    async greeting(req: Request, res: Response): Promise<void> {
      const body = parseBody(GreetingRequestSchema, req);
      const started = Date.now();
      const signal = clientGoneSignal(res);
      const pending = deps.getQueue();
      const now = deps.now();
      const ranked = rankApprovals(pending, now);
      const variation = body.variation ?? 0;
      openSse(res);
      sendEvent(res, { type: 'meta', promptVersion: GREETING_PROMPT.version });

      let result: GreetingResult;
      let outcome = 'ok';
      let errorCode: ErrorCode | undefined;
      try {
        const out = await completeStructured(
          provider,
          {
            task: 'greeting',
            system: GREETING_PROMPT.system,
            messages: [{ role: 'user', content: GREETING_PROMPT.buildUser(ranked, variation) }],
            maxTokens: 150,
            mockContext: { pending, now, variation },
          },
          GreetingModelOutputSchema,
          { timeoutMs, maxAttempts: 2, semanticCheck: checkGreeting(ranked.length), parentSignal: signal },
        );
        result = { kind: 'greeting', source: 'ai', pendingCount: ranked.length, greeting: sanitizeText(out.greeting, 240) };
      } catch (e) {
        const err = normalizeError(e);
        errorCode = toErrorCode(err.code);
        outcome = 'fallback';
        result = greetingFallback(ranked.length);
      }
      sendEvent(res, { type: 'result', data: result });
      endSse(res);
      log(res, 'greeting', { promptVersion: GREETING_PROMPT.version, outcome, errorCode, durationMs: Date.now() - started });
    },

    async chat(req: Request, res: Response): Promise<void> {
      const body = parseBody(ChatRequestSchema, req);
      const pending = deps.getQueue();
      const now = deps.now();
      const ranked = rankApprovals(pending, now);
      await runStream(
        res,
        'chat',
        CHAT_PROMPT.version,
        {
          task: 'chat',
          system: CHAT_PROMPT.buildSystem(ranked),
          messages: toLlmMessages(body.history, body.message),
          maxTokens: 400,
          mockContext: { pending, now, question: body.message },
        },
        chatFallback(pending, now),
      );
    },

    async help(req: Request, res: Response): Promise<void> {
      const body = parseBody(HelpRequestSchema, req);
      const pending = deps.getQueue();
      const now = deps.now();
      const hits = retrieve(body.question);

      if (hits.length === 0) {
        // Ungrounded question: refuse deterministically rather than let the model improvise.
        openSse(res);
        sendEvent(res, { type: 'meta', promptVersion: HELP_PROMPT.version, grounded: false, sources: [] });
        sendEvent(res, { type: 'token', text: helpFallback([]) });
        endSse(res);
        log(res, 'help', { promptVersion: HELP_PROMPT.version, outcome: 'not_covered' });
        return;
      }
      await runStream(
        res,
        'help',
        HELP_PROMPT.version,
        {
          task: 'help',
          system: HELP_PROMPT.buildSystem(hits),
          messages: [{ role: 'user', content: sanitizeText(body.question, MAX_MESSAGE_CHARS) }],
          maxTokens: 300,
          mockContext: { pending, now, question: body.question, chunks: hits },
        },
        helpFallback(hits),
        { grounded: true, sources: hits.map((h) => ({ id: h.chunk.id, heading: h.chunk.heading })) },
      );
    },

    async teach(req: Request, res: Response): Promise<void> {
      const body = parseBody(TeachRequestSchema, req);
      const pending = deps.getQueue();
      const now = deps.now();
      const hits = retrieve(body.question, 2);
      await runStream(
        res,
        'teach',
        TEACH_PROMPT.version,
        {
          task: 'teach',
          system: TEACH_PROMPT.buildSystem(body.step, hits),
          messages: toLlmMessages(body.history, body.question),
          maxTokens: 300,
          mockContext: { pending, now, question: body.question, chunks: hits, step: body.step },
        },
        teachFallback(body.step),
      );
    },
  };
}
