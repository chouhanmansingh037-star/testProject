'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_MESSAGE_CHARS } from '../shared/schemas';
import { SendIcon, StopIcon } from './icons';

interface Props {
  placeholder: string;
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  autoFocusKey?: string;
}

export function Composer({ placeholder, busy, onSend, onStop, autoFocusKey }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const canSend = !busy && trimmed.length > 0 && text.length <= MAX_MESSAGE_CHARS;

  useEffect(() => {
    ref.current?.focus();
  }, [autoFocusKey]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="composer-input">
        Your message
      </label>
      <textarea
        id="composer-input"
        ref={ref}
        value={text}
        rows={2}
        maxLength={MAX_MESSAGE_CHARS}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby="composer-count"
      />
      <div className="composer__row">
        <span id="composer-count" className={text.length > MAX_MESSAGE_CHARS * 0.9 ? 'composer__count composer__count--warn' : 'composer__count'}>
          {text.length}/{MAX_MESSAGE_CHARS}
        </span>
        {busy ? (
          <button type="button" className="btn btn--ghost" onClick={onStop} aria-label="Stop generating">
            <StopIcon /> Stop
          </button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={!canSend} aria-label="Send message">
            <SendIcon /> Send
          </button>
        )}
      </div>
    </form>
  );
}
