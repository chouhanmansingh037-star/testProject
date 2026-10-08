'use client';

import { useEffect, useRef } from 'react';
import { TEACH_STEPS } from '../shared/teachSteps';
import { useAssistant, type ThreadView as ThreadKind } from '../store/assistant';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';

const CONFIG: Record<ThreadKind, { title: string; intro: string; placeholder: string; suggestions: string[] }> = {
  talk: {
    title: 'Talk to me',
    intro: 'Ask me anything about the pending approvals.',
    placeholder: 'e.g. Which of these needs my attention first and why?',
    suggestions: ['Which of these needs my attention first and why?', 'What is overdue?', 'Who submitted what?'],
  },
  help: {
    title: 'Help me',
    intro: 'Ask an operational question. I answer only from the approval policy note.',
    placeholder: 'e.g. What should I write when I reject an item?',
    suggestions: ['How long do I have to do the first review?', 'What do I write when I reject an item?', 'Who must sign off safety-critical items?'],
  },
  teach: {
    title: 'Teach me',
    intro: 'Follow the steps below. Ask a follow-up question any time.',
    placeholder: 'Ask a question about this step…',
    suggestions: ['Why does the order matter?', 'What counts as personal data?'],
  },
};

export function ThreadView({ view }: { view: ThreadKind }) {
  const cfg = CONFIG[view];
  const messages = useAssistant((s) => s.threads[view]);
  const send = useAssistant((s) => s.send);
  const stop = useAssistant((s) => s.stop);
  const retry = useAssistant((s) => s.retry);
  const step = useAssistant((s) => s.teachStep);
  const setStep = useAssistant((s) => s.setTeachStep);
  const busy = messages.some((m) => m.status === 'streaming');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const current = TEACH_STEPS[Math.min(step, TEACH_STEPS.length - 1)];

  return (
    <section className="thread" aria-label={cfg.title}>
      <h2 className="view-title">{cfg.title}</h2>
      {view === 'teach' && current && (
        <div className="steps" aria-label="Review walkthrough">
          <p className="steps__count">
            Step {Math.min(step, TEACH_STEPS.length - 1) + 1} of {TEACH_STEPS.length}
          </p>
          <h3 className="steps__title">{current.title}</h3>
          <p>{current.body}</p>
          <div className="steps__nav">
            <button type="button" className="btn btn--small" disabled={step <= 0} onClick={() => setStep(step - 1)}>
              Previous
            </button>
            <button type="button" className="btn btn--small" disabled={step >= TEACH_STEPS.length - 1} onClick={() => setStep(step + 1)}>
              Next step
            </button>
          </div>
        </div>
      )}

      <div className="log" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="empty">
            <p>{cfg.intro}</p>
            <div className="suggestions">
              {cfg.suggestions.map((q) => (
                <button key={q} type="button" className="chip chip--button" disabled={busy} onClick={() => void send(view, q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble key={m.id} message={m} onRetry={i === messages.length - 1 ? () => void retry(view) : undefined} />
          ))
        )}
        <div ref={endRef} />
      </div>

      <Composer placeholder={cfg.placeholder} busy={busy} onSend={(t) => void send(view, t)} onStop={stop} autoFocusKey={view} />
    </section>
  );
}
