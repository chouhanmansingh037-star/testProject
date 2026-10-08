'use client';

import { useAssistant } from '../store/assistant';

const LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export function SummaryView() {
  const summary = useAssistant((s) => s.summary);
  const load = useAssistant((s) => s.loadSummary);
  const { status, data, error } = summary;

  return (
    <section className="summary" aria-label="Approvals summary" aria-busy={status === 'loading'}>
      <h2 className="view-title">Summary</h2>

      {status === 'loading' && (
        <div className="skeleton" role="status" aria-label="Summarising your queue">
          <span className="skeleton__line" />
          <span className="skeleton__line skeleton__line--short" />
          <span className="skeleton__line" />
          <p className="sr-only">Summarising your queue…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="errorbox" role="alert">
          <p>{error ?? 'Could not load the summary.'}</p>
          <button type="button" className="btn btn--small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {status === 'done' && data && (
        <>
          {data.source === 'fallback' && (
            <p className="banner" role="status">
              The AI assistant is unavailable, so this is a rule-based summary.
            </p>
          )}
          <p className="summary__headline">{data.headline}</p>
          <p className="summary__meta">
            {data.pendingCount} pending · overall urgency{' '}
            <span className={`badge badge--${data.overallUrgency}`}>{LABEL[data.overallUrgency]}</span>
          </p>
          {data.items.length === 0 ? (
            <p className="empty">Nothing to review right now.</p>
          ) : (
            <ol className="summary__list">
              {data.items.map((item) => (
                <li key={item.id} className="summary__item">
                  <div className="summary__row">
                    <strong>{item.title}</strong>
                    <span className={`badge badge--${item.priority}`}>{LABEL[item.priority]}</span>
                  </div>
                  <p className="summary__sub">
                    {item.type} · {item.submittedBy}
                  </p>
                  <p>{item.reason}</p>
                  <p className="summary__action">→ {item.suggestedAction}</p>
                </li>
              ))}
            </ol>
          )}
          <button type="button" className="btn btn--small" onClick={() => void load()}>
            Refresh summary
          </button>
        </>
      )}
    </section>
  );
}
