'use client';

import type { Message } from '../store/assistant';

interface Props {
  message: Message;
  onRetry?: () => void;
}

/** Renders model output as plain text only (React escapes it); there is no HTML/markdown path. */
export function MessageBubble({ message, onRetry }: Props) {
  const isUser = message.role === 'user';
  const waiting = message.status === 'streaming' && message.text === '';
  const failed = message.status === 'error';

  return (
    <div className={`bubble bubble--${isUser ? 'user' : 'bot'}${failed ? ' bubble--error' : ''}`}>
      {waiting && (
        <span className="typing" role="status" aria-label="Assistant is thinking">
          <span /> <span /> <span />
        </span>
      )}
      {message.text !== '' && (
        <p className="bubble__text">
          {message.text}
          {message.status === 'streaming' && <span className="caret" aria-hidden />}
        </p>
      )}
      {message.sources && message.sources.length > 0 && (
        <p className="bubble__sources">
          Sources:{' '}
          {message.sources.map((s) => (
            <span key={s.id} className="chip">
              {s.heading}
            </span>
          ))}
        </p>
      )}
      {message.grounded === false && (
        <p className="bubble__note" role="note">
          Not covered by the approval policy note.
        </p>
      )}
      {message.notice && (
        <p className={failed || message.status === 'interrupted' ? 'bubble__notice bubble__notice--warn' : 'bubble__notice'} role={failed ? 'alert' : 'status'}>
          {message.notice}
        </p>
      )}
      {failed && onRetry && (
        <button type="button" className="btn btn--small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
