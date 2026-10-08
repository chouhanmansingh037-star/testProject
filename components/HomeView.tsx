'use client';

import { useEffect } from 'react';
import { useAssistant, type View } from '../store/assistant';
import { ActionArt, Avatar } from './icons';

const CARDS: { view: Exclude<View, 'home'>; label: string; art: 'summary' | 'talk' | 'help' | 'teach' }[] = [
  { view: 'summary', label: 'Present me Summary', art: 'summary' },
  { view: 'talk', label: 'Talk to me', art: 'talk' },
  { view: 'help', label: 'Help me', art: 'help' },
  { view: 'teach', label: 'Teach me', art: 'teach' },
];

export function HomeView() {
  const greeting = useAssistant((s) => s.greeting);
  const load = useAssistant((s) => s.loadGreeting);
  const goTo = useAssistant((s) => s.goTo);

  useEffect(() => {
    if (greeting.status === 'idle') void load();
  }, [greeting.status, load]);

  return (
    <section className="home" aria-label="Approvals assistant home">
      <div className="greeting" aria-live="polite">
        <Avatar size={32} />
        <div className="greeting__body">
          {(greeting.status === 'loading' || greeting.status === 'idle') && !greeting.data && (
            <span className="typing" role="status" aria-label="Loading greeting">
              <span /> <span /> <span />
            </span>
          )}
          {greeting.data && <p>{greeting.data.greeting}</p>}
          {greeting.status === 'loading' && greeting.data && <p className="muted">Refreshing…</p>}
          {greeting.status === 'done' && greeting.data?.source === 'fallback' && (
            <p className="muted">AI is unavailable, using a standard greeting.</p>
          )}
          {greeting.status === 'error' && (
            <div className="errorbox" role="alert">
              <p>{greeting.error ?? 'Could not load the greeting.'}</p>
              <button type="button" className="btn btn--small" onClick={() => void load()}>
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="cards">
        {CARDS.map((c) => (
          <button key={c.view} type="button" className="card" onClick={() => goTo(c.view)}>
            <ActionArt kind={c.art} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
