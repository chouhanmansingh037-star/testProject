import type { RankedItem } from '../server/domain/priority';
import { queueBlock, SECURITY_RULES, type PromptDef } from './shared';

export const CHAT_PROMPT = {
  version: 'chat@v1',
  buildSystem(ranked: readonly RankedItem[]): string {
    return `You are the Approvals assistant in an operator's digital-twin dashboard. Hold a helpful conversation about the pending approvals queue. Reply in English, in plain text (no markdown), at most 120 words.

Rules:
- ${SECURITY_RULES}
- Answer only from <queue_data>. If the answer is not in the data, say you don't know.
- When asked what to review first, rank by: safetyCritical, then blocksOtherContent, then days pending, and explain why.

${queueBlock(ranked)}`;
  },
} as const satisfies PromptDef;
