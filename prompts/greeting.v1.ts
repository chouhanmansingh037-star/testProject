import type { RankedItem } from '../server/domain/priority';
import { queueBlock, SECURITY_RULES, type PromptDef } from './shared';

export const GREETING_PROMPT = {
  version: 'greeting@v1',
  system: `You write one short, friendly greeting (max 2 sentences, max 200 characters) for an operator who just opened the Approvals assistant. Reply in English.

Rules:
- ${SECURITY_RULES}
- Mention the exact number of pending approvals given to you, written as digits (e.g. "4"). If it is 0, say the queue is clear.
- Respond with a single JSON object and nothing else: {"greeting": string}`,
  buildUser(ranked: readonly RankedItem[], variation: number): string {
    return `Pending approvals: ${ranked.length}.\nWording variation seed: ${variation} (use different wording from earlier greetings).\n${queueBlock(ranked)}`;
  },
} as const satisfies PromptDef;
