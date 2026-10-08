import { TEACH_STEPS } from '../../shared/teachSteps';
import type { ApprovalItem, GreetingResult, Priority, SummaryResult } from '../../shared/schemas';
import { rankApprovals, OVERDUE_AFTER_DAYS, type RankedItem } from './priority';
import type { Retrieved } from './retriever';

const URGENCY_ORDER: Priority[] = ['low', 'medium', 'high'];

function reasonFor(r: RankedItem): string {
  const parts: string[] = [];
  if (r.item.safetyCritical) parts.push('Safety-critical content is always reviewed first');
  if (r.item.blocksOthers) parts.push('other content depends on this folder');
  if (r.overdue) parts.push(`pending ${r.ageDays} days (over the ${OVERDUE_AFTER_DAYS}-day limit)`);
  else parts.push(`pending ${r.ageDays} day${r.ageDays === 1 ? '' : 's'}`);
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

function actionFor(r: RankedItem): string {
  if (r.item.safetyCritical) return 'Review now and request second-reviewer sign-off.';
  if (r.overdue) return 'Review now and escalate to the Site Operations Lead.';
  return 'Review in queue order.';
}

/** Deterministic summary: same shape as the AI result, built purely from the data. */
export function summaryFallback(pending: readonly ApprovalItem[], now: Date): SummaryResult {
  const ranked = rankApprovals(pending, now);
  const top = ranked[0];
  if (!top) {
    return {
      kind: 'summary',
      source: 'fallback',
      pendingCount: 0,
      headline: 'There are no pending approvals right now.',
      overallUrgency: 'low',
      items: [],
    };
  }
  const overdue = ranked.filter((r) => r.overdue).length;
  const overall = ranked.reduce<Priority>(
    (acc, r) => (URGENCY_ORDER.indexOf(r.priority) > URGENCY_ORDER.indexOf(acc) ? r.priority : acc),
    'low',
  );
  const n = ranked.length;
  return {
    kind: 'summary',
    source: 'fallback',
    pendingCount: n,
    headline: `${n} approval${n === 1 ? ' is' : 's are'} pending${overdue ? `, ${overdue} overdue` : ''}. Start with "${top.item.title}".`,
    overallUrgency: overall,
    items: ranked.map((r) => ({
      id: r.item.id,
      title: r.item.title,
      type: r.item.type,
      submittedBy: r.item.submittedBy,
      priority: r.priority,
      reason: reasonFor(r),
      suggestedAction: actionFor(r),
    })),
  };
}

export function greetingText(count: number): string {
  if (count === 0) return 'Hello! You have no approvals waiting for review right now.';
  return `Hello! You have ${count} approval${count === 1 ? '' : 's'} waiting for review. Want a quick summary?`;
}

export function greetingFallback(count: number): GreetingResult {
  return { kind: 'greeting', source: 'fallback', pendingCount: count, greeting: greetingText(count) };
}

export function chatFallback(pending: readonly ApprovalItem[], now: Date): string {
  const ranked = rankApprovals(pending, now);
  if (ranked.length === 0) return 'The assistant is unavailable right now, but the queue is empty.';
  const lines = ranked.map((r, i) => `${i + 1}. ${r.item.title} (${r.item.type}, ${r.item.submittedBy}) - ${r.priority} priority`);
  return `The assistant is unavailable right now. Here is the queue in priority order:\n${lines.join('\n')}`;
}

export function helpFallback(hits: readonly Retrieved[]): string {
  const best = hits[0];
  if (!best) return 'That is not covered by the approval policy note, so I cannot answer it. Please ask the Site Operations Lead.';
  return `From the policy ("${best.chunk.heading}"): ${best.chunk.text}`;
}

export function teachFallback(stepIndex: number): string {
  const step = TEACH_STEPS[Math.min(Math.max(stepIndex, 0), TEACH_STEPS.length - 1)];
  return step ? `${step.title}. ${step.body}` : 'Open the queue and review items in priority order.';
}
