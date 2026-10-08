import { create } from 'zustand';
import {
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  type GreetingResult,
  type SourceRef,
  type SummaryResult,
} from '../shared/schemas';
import { ApiRequestError, streamEvents } from '../lib/sse';

export type ThreadView = 'talk' | 'help' | 'teach';
export type View = 'home' | 'summary' | ThreadView;
export type LoadStatus = 'idle' | 'loading' | 'done' | 'error';

export interface LoadState<T> {
  status: LoadStatus;
  data?: T;
  error?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'streaming' | 'done' | 'interrupted' | 'error';
  /** Deterministic (non-AI) answer shown because the model failed. */
  fallback?: boolean;
  /** For Help: false means the policy note does not cover the question. */
  grounded?: boolean;
  sources?: SourceRef[];
  notice?: string;
}

interface AssistantState {
  open: boolean;
  expanded: boolean;
  view: View;
  greeting: LoadState<GreetingResult>;
  greetingVariation: number;
  summary: LoadState<SummaryResult>;
  threads: Record<ThreadView, Message[]>;
  teachStep: number;

  openPanel: () => void;
  closePanel: () => void;
  toggleExpanded: () => void;
  goTo: (view: View) => void;
  loadGreeting: (replay?: boolean) => Promise<void>;
  loadSummary: () => Promise<void>;
  send: (view: ThreadView, text: string) => Promise<void>;
  stop: () => void;
  /** Re-asks the last question after a failed (no-text) answer, replacing the failed pair. */
  retry: (view: ThreadView) => Promise<void>;
  setTeachStep: (step: number) => void;
}

// One request at a time. Starting anything new (or switching views) cancels the previous one,
// and `isCurrent` stops a cancelled request from writing stale tokens into the UI.
let current: { id: number; ctl: AbortController; onCancel: () => void } | null = null;
let counter = 0;
let msgCounter = 0;

function begin(onCancel: () => void) {
  cancelInflight();
  const id = ++counter;
  const ctl = new AbortController();
  current = { id, ctl, onCancel };
  return { signal: ctl.signal, isCurrent: () => current?.id === id, finish: () => { if (current?.id === id) current = null; } };
}

function cancelInflight(): void {
  const c = current;
  current = null;
  if (c) {
    c.ctl.abort();
    c.onCancel();
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.kind === 'rate_limited') return `You're going a bit fast. Try again in ${e.retryAfterSec ?? 30}s.`;
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}

function buildHistory(messages: readonly Message[]) {
  return messages
    .filter((m) => m.status !== 'error' && m.text.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.text.slice(0, MAX_MESSAGE_CHARS * 4) }));
}

const emptyThreads = (): Record<ThreadView, Message[]> => ({ talk: [], help: [], teach: [] });

export const useAssistant = create<AssistantState>()((set, get) => {
  const patchMessage = (view: ThreadView, id: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [view]: s.threads[view].map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)),
      },
    }));

  return {
    open: false,
    expanded: false,
    view: 'home',
    greeting: { status: 'idle' },
    greetingVariation: 0,
    summary: { status: 'idle' },
    threads: emptyThreads(),
    teachStep: 0,

    openPanel: () => set({ open: true }),
    closePanel: () => {
      cancelInflight();
      set({ open: false });
    },
    toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
    setTeachStep: (step) => set({ teachStep: Math.max(0, step) }),

    goTo: (view) => {
      cancelInflight();
      set({ view });
      if (view === 'summary' && get().summary.status !== 'done') void get().loadSummary();
    },

    loadGreeting: async (replay = false) => {
      const variation = replay ? get().greetingVariation + 1 : get().greetingVariation;
      const req = begin(() => set((s) => (s.greeting.status === 'loading' ? { greeting: { status: s.greeting.data ? 'done' : 'idle', data: s.greeting.data } } : {})));
      set((s) => ({ greeting: { status: 'loading', data: s.greeting.data }, greetingVariation: variation }));
      try {
        for await (const ev of streamEvents('/api/ai/greeting', { variation }, req.signal)) {
          if (!req.isCurrent()) return;
          if (ev.type === 'result' && ev.data.kind === 'greeting') set({ greeting: { status: 'done', data: ev.data } });
          else if (ev.type === 'result') throw new ApiRequestError('protocol', 'The server sent an unexpected response.');
        }
        if (req.isCurrent() && get().greeting.status === 'loading') throw new ApiRequestError('protocol', 'No greeting was returned.');
      } catch (e) {
        if (req.isCurrent()) set({ greeting: { status: 'error', error: describe(e) } });
      } finally {
        req.finish();
      }
    },

    loadSummary: async () => {
      const req = begin(() => set((s) => (s.summary.status === 'loading' ? { summary: { status: 'idle' } } : {})));
      set({ summary: { status: 'loading' } });
      try {
        for await (const ev of streamEvents('/api/ai/summary', {}, req.signal)) {
          if (!req.isCurrent()) return;
          if (ev.type === 'result' && ev.data.kind === 'summary') set({ summary: { status: 'done', data: ev.data } });
          else if (ev.type === 'result') throw new ApiRequestError('protocol', 'The server sent an unexpected response.');
        }
        if (req.isCurrent() && get().summary.status === 'loading') throw new ApiRequestError('protocol', 'No summary was returned.');
      } catch (e) {
        if (req.isCurrent()) set({ summary: { status: 'error', error: describe(e) } });
      } finally {
        req.finish();
      }
    },

    send: async (view, raw) => {
      const text = raw.trim();
      if (!text || text.length > MAX_MESSAGE_CHARS) return;
      if (get().threads[view].some((m) => m.status === 'streaming')) return; // one answer at a time

      const history = buildHistory(get().threads[view]);
      const userId = `u${++msgCounter}`;
      const botId = `a${++msgCounter}`;
      const req = begin(() =>
        patchMessage(view, botId, (m) => (m.status === 'streaming' ? { status: 'interrupted', notice: m.text ? 'Stopped.' : 'Stopped before an answer arrived.' } : {})),
      );
      set((s) => ({
        threads: {
          ...s.threads,
          [view]: [...s.threads[view], { id: userId, role: 'user', text, status: 'done' }, { id: botId, role: 'assistant', text: '', status: 'streaming' }],
        },
      }));

      const [path, body] =
        view === 'talk'
          ? (['/api/ai/chat', { message: text, history }] as const)
          : view === 'help'
            ? (['/api/ai/help', { question: text }] as const)
            : (['/api/ai/teach', { step: get().teachStep, question: text, history }] as const);

      try {
        for await (const ev of streamEvents(path, body, req.signal)) {
          if (!req.isCurrent()) return;
          switch (ev.type) {
            case 'meta':
              patchMessage(view, botId, { grounded: ev.grounded, sources: ev.sources });
              break;
            case 'token':
              patchMessage(view, botId, (m) => ({ text: m.text + ev.text }));
              break;
            case 'fallback':
              patchMessage(view, botId, { text: ev.text, fallback: true, status: 'done', notice: 'The AI assistant is unavailable, so this is a built-in answer.' });
              break;
            case 'error':
              patchMessage(view, botId, { status: 'interrupted', notice: ev.message });
              break;
            case 'done':
              patchMessage(view, botId, (m) => (m.status === 'streaming' ? { status: 'done' } : {}));
              break;
            case 'result':
              throw new ApiRequestError('protocol', 'The server sent an unexpected response.');
          }
        }
      } catch (e) {
        if (req.isCurrent()) {
          patchMessage(view, botId, (m) => ({
            status: m.text ? 'interrupted' : 'error',
            notice: describe(e),
          }));
        }
      } finally {
        req.finish();
      }
    },

    stop: () => cancelInflight(),

    retry: async (view) => {
      const thread = get().threads[view];
      const last = thread.at(-1);
      const asked = thread.at(-2);
      if (!last || last.role !== 'assistant' || last.status !== 'error' || asked?.role !== 'user') return;
      set((s) => ({ threads: { ...s.threads, [view]: s.threads[view].slice(0, -2) } }));
      await get().send(view, asked.text);
    },
  };
});

/** Test helper: abort anything in flight and return to the initial state. */
export function resetAssistant(): void {
  cancelInflight();
  useAssistant.setState({
    open: false,
    expanded: false,
    view: 'home',
    greeting: { status: 'idle' },
    greetingVariation: 0,
    summary: { status: 'idle' },
    threads: emptyThreads(),
    teachStep: 0,
  });
}

export const selectBusy = (s: AssistantState): boolean =>
  s.greeting.status === 'loading' ||
  s.summary.status === 'loading' ||
  s.threads.talk.concat(s.threads.help, s.threads.teach).some((m) => m.status === 'streaming');
