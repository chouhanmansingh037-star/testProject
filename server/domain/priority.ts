import type { ApprovalItem, Priority } from '../../shared/schemas';

/** Matches the policy note: pending longer than 7 calendar days is overdue and must be escalated. */
export const OVERDUE_AFTER_DAYS = 7;

const TYPE_WEIGHT: Record<ApprovalItem['type'], number> = { folder: 5, pdf: 4, video: 2, image: 1 };
const DAY_MS = 86_400_000;

export interface RankedItem {
  item: ApprovalItem;
  score: number;
  priority: Priority;
  ageDays: number;
  overdue: boolean;
}

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function ageInDays(submittedOn: string, now: Date): number {
  const submitted = Date.parse(`${submittedOn}T00:00:00Z`);
  if (Number.isNaN(submitted)) return 0;
  return Math.max(0, Math.floor((utcMidnight(now) - submitted) / DAY_MS));
}

function toPriority(score: number): Priority {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/**
 * Deterministic urgency ranking. This is the source of truth for ordering and for the
 * non-AI fallback; the LLM only explains and may not reorder facts we compute ourselves.
 */
export function rankApprovals(items: readonly ApprovalItem[], now: Date): RankedItem[] {
  return items
    .map((item) => {
      const ageDays = ageInDays(item.submittedOn, now);
      const score =
        (item.safetyCritical ? 60 : 0) + (item.blocksOthers ? 30 : 0) + Math.min(ageDays, 30) + TYPE_WEIGHT[item.type];
      return { item, score, priority: toPriority(score), ageDays, overdue: ageDays > OVERDUE_AFTER_DAYS };
    })
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
}
