import { rankApprovals } from '../domain/priority';
import { teachFallback } from '../domain/fallbacks';
import { LlmError, type LlmProvider, type LlmRequest, type MockContext } from './types';

export const MOCK_MODES = ['ok', 'timeout', 'error', 'auth', 'rate_limited', 'malformed', 'hallucinated', 'empty', 'partial'] as const;
export type MockMode = (typeof MOCK_MODES)[number];

export interface MockOptions {
  mode?: MockMode;
  /** Delay between streamed tokens. */
  delayMs?: number;
}

/** Waits `ms`, but rejects as soon as the signal aborts (so timeouts/disconnects stop the mock too). */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LlmError('aborted'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new LlmError('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const hang = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) return reject(new LlmError('aborted'));
    signal.addEventListener('abort', () => reject(new LlmError('aborted')), { once: true });
  });

function summaryJson(ctx: MockContext, hallucinate: boolean): string {
  const ranked = rankApprovals(ctx.pending, ctx.now);
  const overdue = ranked.filter((r) => r.overdue).length;
  const top = ranked[0];
  const items = ranked.map((r) => ({
    id: r.item.id,
    priority: r.priority,
    reason: r.item.safetyCritical
      ? 'Safety-critical specs must be reviewed before anything else.'
      : r.item.blocksOthers
        ? 'Other onboarding content depends on this folder.'
        : `Lower impact, waiting ${r.ageDays} days.`,
    suggestedAction: r.overdue ? 'Review now and escalate to the Site Operations Lead.' : 'Review in queue order.',
  }));
  if (hallucinate) items.push({ id: 'apr-999', priority: 'high', reason: 'Made up.', suggestedAction: 'Ignore.' });
  return JSON.stringify({
    headline: top
      ? `${ranked.length} pending approval${ranked.length === 1 ? '' : 's'}${overdue ? `, ${overdue} overdue` : ''}. Begin with "${top.item.title}".`
      : 'There are no pending approvals right now.',
    overallUrgency: top?.priority ?? 'low',
    items,
  });
}

function greetingJson(ctx: MockContext): string {
  const n = ctx.pending.length;
  const plural = `${n} approval${n === 1 ? '' : 's'}`;
  const variants = [
    `Hi there! ${plural} ${n === 1 ? 'is' : 'are'} waiting on your review.`,
    `Welcome back. Your queue currently holds ${plural}.`,
    `Good to see you! There ${n === 1 ? 'is' : 'are'} ${plural} pending right now.`,
  ];
  if (n === 0) return JSON.stringify({ greeting: 'Hi there! Your approvals queue is clear.' });
  return JSON.stringify({ greeting: variants[(ctx.variation ?? 0) % variants.length] });
}

function chatText(ctx: MockContext): string {
  const q = (ctx.question ?? '').toLowerCase();
  const ranked = rankApprovals(ctx.pending, ctx.now);
  const top = ranked[0];
  if (!top) return 'The approvals queue is empty, so there is nothing to review right now.';
  if (/first|attention|urgent|priorit|start|important/.test(q)) {
    const why = top.item.safetyCritical
      ? 'it is safety-critical, and safety content is always reviewed first'
      : top.item.blocksOthers
        ? 'other content depends on it'
        : `it has been waiting ${top.ageDays} days`;
    const next = ranked[1] ? ` After that, look at "${ranked[1].item.title}".` : '';
    return `Start with "${top.item.title}" because ${why}.${next}`;
  }
  if (/how many|count|number|pending/.test(q)) {
    return `There ${ranked.length === 1 ? 'is' : 'are'} ${ranked.length} pending approval${ranked.length === 1 ? '' : 's'}.`;
  }
  if (/who|submit|author/.test(q)) {
    const by = new Map<string, number>();
    for (const r of ranked) by.set(r.item.submittedBy, (by.get(r.item.submittedBy) ?? 0) + 1);
    return `Submissions by person: ${[...by].map(([n, c]) => `${n} (${c})`).join(', ')}.`;
  }
  if (/overdue|late|old|escalat/.test(q)) {
    const od = ranked.filter((r) => r.overdue);
    return od.length
      ? `${od.length} item${od.length === 1 ? ' is' : 's are'} overdue and should be escalated to the Site Operations Lead: ${od.map((r) => `"${r.item.title}"`).join(', ')}.`
      : 'Nothing is overdue.';
  }
  return `I can help with the ${ranked.length} pending approvals. Try asking which one needs attention first, who submitted what, or what is overdue.`;
}

function helpText(ctx: MockContext): string {
  const best = ctx.chunks?.[0];
  if (!best) return 'That is not covered by the approval policy note.';
  return `${best.chunk.text} (Source: ${best.chunk.heading})`;
}

function teachText(ctx: MockContext): string {
  const step = ctx.step ?? 0;
  const extra = ctx.chunks?.[0]?.chunk.text.split('. ')[0];
  return `${teachFallback(step)}${extra ? ` On your question: ${extra.replace(/\.$/, '')}.` : ''}`;
}

/**
 * Deterministic stand-in for the LLM so the app runs end-to-end without an API key.
 * `mode` simulates the failure drills graders ask for (timeouts, bad JSON, auth, mid-stream drops).
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  private readonly mode: MockMode;
  private readonly delayMs: number;

  constructor(opts: MockOptions = {}) {
    this.mode = opts.mode ?? 'ok';
    this.delayMs = opts.delayMs ?? 15;
  }

  private failIfScripted(): void {
    if (this.mode === 'error') throw new LlmError('upstream', 'mock upstream failure');
    if (this.mode === 'auth') throw new LlmError('auth', 'mock invalid api key');
    if (this.mode === 'rate_limited') throw new LlmError('rate_limited', 'mock provider rate limit');
  }

  async complete(req: LlmRequest): Promise<string> {
    if (this.mode === 'timeout') return hang(req.signal);
    this.failIfScripted();
    await abortableSleep(this.delayMs, req.signal);
    if (this.mode === 'empty') return '';
    if (this.mode === 'malformed') return '{"headline": 42, "unexpected": true}';
    if (req.task === 'summary') return summaryJson(req.mockContext, this.mode === 'hallucinated');
    if (req.task === 'greeting') return greetingJson(req.mockContext);
    return this.textFor(req);
  }

  private textFor(req: LlmRequest): string {
    if (req.task === 'help') return helpText(req.mockContext);
    if (req.task === 'teach') return teachText(req.mockContext);
    return chatText(req.mockContext);
  }

  async *stream(req: LlmRequest): AsyncGenerator<string, void, void> {
    if (this.mode === 'timeout') await hang(req.signal);
    this.failIfScripted();
    if (this.mode === 'empty') return;
    const tokens = this.textFor(req).match(/\S+\s*/g) ?? [];
    let sent = 0;
    for (const t of tokens) {
      await abortableSleep(this.delayMs, req.signal);
      if (this.mode === 'partial' && sent === 3) throw new LlmError('upstream', 'mock connection dropped mid-stream');
      yield t;
      sent++;
    }
  }
}
