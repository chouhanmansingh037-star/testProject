/** Static walkthrough for "Teach me". Deterministic: no LLM needed for the steps themselves. */
export interface TeachStep {
  title: string;
  body: string;
}

export const TEACH_STEPS: readonly TeachStep[] = [
  {
    title: 'Open the queue in priority order',
    body: 'Start with safety-critical items, then folders other content depends on, then videos and images. Anything pending more than 7 calendar days is overdue.',
  },
  {
    title: 'Open the item and inspect it',
    body: 'Check the title matches the content, the file opens completely, the folder path is correct, and no personal data or site credentials are visible.',
  },
  {
    title: 'Decide: approve or reject',
    body: 'Approve only if every check passes. If any check fails, reject it. There is no "approve with comments".',
  },
  {
    title: 'Give a reason when rejecting',
    body: 'Write at least one sentence telling the submitter exactly what to fix. The item returns to them and leaves your queue.',
  },
  {
    title: 'Get a second sign-off for safety-critical items',
    body: 'Safety-critical items need a second reviewer. You cannot approve your own submission. If unsure, escalate to the Site Operations Lead.',
  },
];
