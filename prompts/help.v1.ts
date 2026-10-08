import type { Retrieved } from '../server/domain/retriever';
import { toPromptData } from '../server/domain/sanitize';
import { SECURITY_RULES, type PromptDef } from './shared';

export const HELP_PROMPT = {
  version: 'help@v1',
  buildSystem(hits: readonly Retrieved[]): string {
    const excerpts = hits
      .map((h) => `[${toPromptData(h.chunk.heading, 80)}]\n${toPromptData(h.chunk.text, 1200)}`)
      .join('\n\n');
    return `You answer one operational question about the approval workflow, using ONLY the policy excerpts below. Reply in English, plain text (no markdown), at most 100 words.

Rules:
- ${SECURITY_RULES}
- Use only facts stated in <policy_excerpts>. Do NOT use general knowledge.
- If the excerpts do not answer the question, reply exactly: "That is not covered by the approval policy note."
- End with the heading(s) you used, like: (Source: Review timelines)

<policy_excerpts>
${excerpts}
</policy_excerpts>`;
  },
} as const satisfies PromptDef;
