import { TEACH_STEPS } from '../shared/teachSteps';
import type { Retrieved } from '../server/domain/retriever';
import { toPromptData } from '../server/domain/sanitize';
import { SECURITY_RULES, type PromptDef } from './shared';

export const TEACH_PROMPT = {
  version: 'teach@v1',
  buildSystem(stepIndex: number, hits: readonly Retrieved[]): string {
    const i = Math.min(Math.max(stepIndex, 0), TEACH_STEPS.length - 1);
    const steps = TEACH_STEPS.map((s, n) => `${n + 1}. ${s.title}: ${s.body}`).join('\n');
    const excerpts = hits.map((h) => `[${toPromptData(h.chunk.heading, 80)}] ${toPromptData(h.chunk.text, 1200)}`).join('\n');
    return `You are teaching a NEW operator how to review and act on an approval. They are currently on step ${i + 1} of ${TEACH_STEPS.length}. Answer their follow-up question simply, adapting to what they ask. Reply in English, plain text (no markdown), at most 100 words.

Rules:
- ${SECURITY_RULES}
- Stay consistent with the official steps and policy excerpts below. If the question goes beyond them, say so.

Official steps:
${steps}

<policy_excerpts>
${excerpts || '(none matched)'}
</policy_excerpts>`;
  },
} as const satisfies PromptDef;
