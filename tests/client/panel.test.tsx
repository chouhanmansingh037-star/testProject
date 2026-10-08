import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsPanel } from '../../components/ApprovalsPanel';
import { resetAssistant } from '../../store/assistant';
import { controlledSse, done, greetingResult, jsonResponse, meta, mockApi, sseOf, summaryResult, token } from './helpers';

const GREETING = '/api/ai/greeting';
const SUMMARY = '/api/ai/summary';
const CHAT = '/api/ai/chat';
const HELP = '/api/ai/help';
const TEACH = '/api/ai/teach';

const okGreeting = (greeting?: string) => ({ [GREETING]: () => sseOf([meta(), greetingResult(greeting), done]) });

async function openPanel(user = userEvent.setup()) {
  render(<ApprovalsPanel itemCount={4} />);
  await user.click(screen.getByRole('button', { name: /open approvals assistant/i }));
  return user;
}

beforeEach(() => {
  resetAssistant();
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  resetAssistant();
  vi.unstubAllGlobals();
});

describe('panel shell + greeting', () => {
  it('renders the header, four action cards, Replay Greeting and the close affordance', async () => {
    mockApi(okGreeting());
    await openPanel();
    const dialog = screen.getByRole('dialog', { name: /approvals assistant/i });
    expect(within(dialog).getByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
    for (const name of ['Present me Summary', 'Talk to me', 'Help me', 'Teach me']) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('button', { name: 'Replay Greeting' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /close assistant/i })).toBeInTheDocument();
    expect(within(dialog).getByText('4 folders / items')).toBeInTheDocument();
  });

  it('shows a loading indicator, then the AI greeting', async () => {
    const c = controlledSse();
    mockApi({ [GREETING]: () => c.response });
    await openPanel();
    expect(screen.getByRole('status', { name: /loading greeting/i })).toBeInTheDocument();
    act(() => {
      c.push(meta());
      c.push(greetingResult('Welcome back! 4 approvals await.'));
      c.push(done);
      c.close();
    });
    expect(await screen.findByText('Welcome back! 4 approvals await.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading greeting/i })).not.toBeInTheDocument();
  });

  it('Replay Greeting regenerates it with a new variation seed', async () => {
    let n = 0;
    const api = mockApi({ [GREETING]: () => sseOf([meta(), greetingResult(`Greeting number ${++n} with 4 items`), done]) });
    const user = await openPanel();
    expect(await screen.findByText(/Greeting number 1/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replay Greeting' }));
    expect(await screen.findByText(/Greeting number 2/)).toBeInTheDocument();
    expect(api.to(GREETING).map((c) => c.body.variation)).toEqual([0, 1]);
  });

  it('tells the user when the greeting came from the non-AI fallback', async () => {
    mockApi({ [GREETING]: () => sseOf([meta(), greetingResult('Hello! You have 4 approvals waiting for review.', 'fallback'), done]) });
    await openPanel();
    expect(await screen.findByText(/AI is unavailable, using a standard greeting/i)).toBeInTheDocument();
  });

  it('shows an error with Try again when the network is down, and recovers on retry', async () => {
    let fail = true;
    mockApi({
      [GREETING]: () => {
        if (fail) throw new TypeError('Failed to fetch');
        return sseOf([meta(), greetingResult('Back online! 4 approvals.'), done]);
      },
    });
    const user = await openPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back online! 4 approvals.')).toBeInTheDocument();
  });

  it('shows the retry delay on HTTP 429', async () => {
    mockApi({
      [GREETING]: () => jsonResponse(429, { error: { code: 'rate_limited', message: 'Too many requests.', retryAfterSec: 17 } }, { 'Retry-After': '17' }),
    });
    await openPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent(/try again in 17s/i);
  });

  it('closes with the button and with Escape, and Close does not crash an in-flight request', async () => {
    const c = controlledSse();
    mockApi({ [GREETING]: (call) => (call.signal?.addEventListener('abort', () => undefined), c.response) });
    const user = await openPanel();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close assistant' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open approvals assistant/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('expands and shrinks', async () => {
    mockApi(okGreeting());
    const user = await openPanel();
    const btn = screen.getByRole('button', { name: 'Expand panel' });
    await user.click(btn);
    expect(screen.getByRole('dialog')).toHaveClass('panel--expanded');
    expect(screen.getByRole('button', { name: 'Shrink panel' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Present me Summary', () => {
  it('shows a loading state, then prioritised items from validated data', async () => {
    const c = controlledSse();
    mockApi({ ...okGreeting(), [SUMMARY]: () => c.response });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Present me Summary' }));
    expect(screen.getByRole('status', { name: /summarising your queue/i })).toBeInTheDocument();
    act(() => {
      c.push(meta());
      c.push(summaryResult('ai'));
      c.push(done);
      c.close();
    });
    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Safety Equipment & Sensor Specs');
    expect(rows[0]).toHaveTextContent('High');
    expect(rows[1]).toHaveTextContent('Low');
    expect(screen.queryByText(/rule-based summary/i)).not.toBeInTheDocument();
  });

  it('flags a rule-based (fallback) summary so users know it is not AI', async () => {
    mockApi({ ...okGreeting(), [SUMMARY]: () => sseOf([meta(), summaryResult('fallback'), done]) });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Present me Summary' }));
    expect(await screen.findByText(/unavailable, so this is a rule-based summary/i)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an error with retry on a server error (never a blank panel)', async () => {
    let fail = true;
    mockApi({
      ...okGreeting(),
      [SUMMARY]: () => (fail ? jsonResponse(500, 'oops') : sseOf([meta(), summaryResult(), done])),
    });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Present me Summary' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
  });

  it('refuses a response that violates the contract instead of rendering it', async () => {
    const bad = { type: 'result', data: { kind: 'summary', source: 'ai', pendingCount: 1, headline: '<img src=x onerror=alert(1)>', overallUrgency: 'critical', items: [] } };
    mockApi({ ...okGreeting(), [SUMMARY]: () => sseOf([meta(), bad, done]) });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Present me Summary' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unexpected response shape/i);
    expect(screen.queryByText(/onerror/)).not.toBeInTheDocument();
  });

  it('shows the empty state for an empty queue', async () => {
    const empty = { type: 'result', data: { kind: 'summary', source: 'static', pendingCount: 0, headline: 'There are no pending approvals right now.', overallUrgency: 'low', items: [] } };
    mockApi({ ...okGreeting(), [SUMMARY]: () => sseOf([meta(), empty, done]) });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Present me Summary' }));
    expect(await screen.findByText(/nothing to review right now/i)).toBeInTheDocument();
  });
});

describe('Talk to me (streaming)', () => {
  async function openTalk() {
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Talk to me' }));
    return user;
  }

  it('shows thinking dots, streams tokens incrementally, then re-enables input', async () => {
    const c = controlledSse();
    const api = mockApi({ ...okGreeting(), [CHAT]: () => c.response });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'Which first?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText('Which first?')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /assistant is thinking/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();

    act(() => c.push(meta()));
    act(() => c.push(token('Start with ')));
    expect(await screen.findByText(/Start with/)).toBeInTheDocument();
    expect(screen.queryByText(/the PDF/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /assistant is thinking/i })).not.toBeInTheDocument();

    act(() => c.push(token('the PDF.')));
    expect(await screen.findByText(/Start with the PDF\./)).toBeInTheDocument();

    act(() => {
      c.push(done);
      c.close();
    });
    expect(await screen.findByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(api.to(CHAT)[0]?.body).toEqual({ message: 'Which first?', history: [] });
    expect(screen.getByLabelText('Your message')).toHaveValue('');
  });

  it('sends prior turns as history on the second question', async () => {
    const api = mockApi({ ...okGreeting(), [CHAT]: () => sseOf([meta(), token('Answer.'), done]) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'one{Enter}');
    await screen.findByText('Answer.');
    await user.type(screen.getByLabelText('Your message'), 'two{Enter}');
    await waitFor(() => expect(api.to(CHAT)).toHaveLength(2));
    expect(api.to(CHAT)[1]?.body.history).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'Answer.' },
    ]);
  });

  it('Stop aborts the request and keeps what was already streamed', async () => {
    const c = controlledSse();
    const api = mockApi({ ...okGreeting(), [CHAT]: (call) => controlledWith(c, call.signal) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hi{Enter}');
    act(() => c.push(token('Partial answer')));
    await screen.findByText(/Partial answer/);
    await user.click(screen.getByRole('button', { name: /stop generating/i }));
    expect(api.to(CHAT)[0]?.signal?.aborted).toBe(true);
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(screen.getByText(/Partial answer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled(); // empty input, but not stuck "busy"
  });

  it('shows the built-in answer and a notice when the server sends a fallback', async () => {
    mockApi({ ...okGreeting(), [CHAT]: () => sseOf([meta(), { type: 'fallback', text: 'Queue in priority order:\n1. Safety Equipment', reason: 'timeout' }, done]) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hi{Enter}');
    expect(await screen.findByText(/1\. Safety Equipment/)).toBeInTheDocument();
    expect(screen.getByText(/AI assistant is unavailable, so this is a built-in answer/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps partial text and warns when the stream breaks mid-answer', async () => {
    mockApi({
      ...okGreeting(),
      [CHAT]: () => sseOf([meta(), token('Half an '), { type: 'error', code: 'interrupted', message: 'The response was interrupted.' }, done]),
    });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hi{Enter}');
    expect(await screen.findByText(/Half an/)).toBeInTheDocument();
    expect(screen.getByText('The response was interrupted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('treats a connection that closes without `done` as interrupted', async () => {
    mockApi({ ...okGreeting(), [CHAT]: () => sseOf([meta(), token('Cut o')]) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hi{Enter}');
    expect(await screen.findByText(/Cut o/)).toBeInTheDocument();
    expect(await screen.findByText(/connection closed before the answer finished/i)).toBeInTheDocument();
  });

  it('shows an error bubble with Try again on HTTP 500, and the retry replaces the failed turn', async () => {
    let fail = true;
    mockApi({ ...okGreeting(), [CHAT]: () => (fail ? jsonResponse(500, { oops: true }) : sseOf([meta(), token('Recovered.'), done])) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered.')).toBeInTheDocument();
    expect(screen.getAllByText('hello')).toHaveLength(1);
  });

  it('shows a friendly message on network failure', async () => {
    mockApi({ ...okGreeting(), [CHAT]: () => { throw new TypeError('Failed to fetch'); } });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  it('renders model output as inert text (no HTML injection)', async () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    mockApi({ ...okGreeting(), [CHAT]: () => sseOf([meta(), token(evil), done]) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hi{Enter}');
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.log script')).toBeNull();
  });

  it('never shows raw text from an event that violates the schema', async () => {
    mockApi({ ...okGreeting(), [CHAT]: () => sseOf([meta(), token('fine '), { type: 'token', text: 5 }, token('SECRET'), done]) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hi{Enter}');
    expect(await screen.findByText(/unexpected response shape/i)).toBeInTheDocument();
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
  });

  it('does not send empty or whitespace-only messages, and enforces the length cap', async () => {
    const api = mockApi({ ...okGreeting(), [CHAT]: () => sseOf([meta(), token('x'), done]) });
    const user = await openTalk();
    const box = screen.getByLabelText('Your message');
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    await user.type(box, '   ');
    expect(send).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(api.to(CHAT)).toHaveLength(0);
    expect(box).toHaveAttribute('maxlength', '1000');
  });

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const api = mockApi({ ...okGreeting(), [CHAT]: () => sseOf([meta(), token('x'), done]) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'a{Shift>}{Enter}{/Shift}b');
    expect(screen.getByLabelText('Your message')).toHaveValue('a\nb');
    expect(api.to(CHAT)).toHaveLength(0);
  });

  it('cancels the in-flight request when the user switches views and never leaks its tokens', async () => {
    const c = controlledSse();
    const api = mockApi({ ...okGreeting(), [CHAT]: (call) => controlledWith(c, call.signal) });
    const user = await openTalk();
    await user.type(screen.getByLabelText('Your message'), 'hi{Enter}');
    act(() => c.push(token('first ')));
    await screen.findByText(/first/);
    await user.click(screen.getByRole('button', { name: /^approvals$/i }));
    expect(api.to(CHAT)[0]?.signal?.aborted).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Help me' }));
    act(() => {
      try {
        c.push(token('LEAKED'));
      } catch {
        /* stream already errored by abort: expected */
      }
    });
    expect(screen.queryByText(/LEAKED/)).not.toBeInTheDocument();
  });
});

describe('Help me (grounded)', () => {
  it('shows the policy sources that were used', async () => {
    const api = mockApi({
      ...okGreeting(),
      [HELP]: () =>
        sseOf([meta({ grounded: true, sources: [{ id: 'policy-4', heading: 'Rejecting or returning an item' }] }), token('Write a reason of at least one sentence.'), done]),
    });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Help me' }));
    await user.type(screen.getByLabelText('Your message'), 'What do I write when I reject?{Enter}');
    expect(await screen.findByText(/at least one sentence/)).toBeInTheDocument();
    expect(screen.getByText('Rejecting or returning an item')).toBeInTheDocument();
    expect(api.to(HELP)[0]?.body).toEqual({ question: 'What do I write when I reject?' });
  });

  it('says so when the policy does not cover the question', async () => {
    mockApi({ ...okGreeting(), [HELP]: () => sseOf([meta({ grounded: false, sources: [] }), token('That is not covered by the approval policy note, so I cannot answer it.'), done]) });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Help me' }));
    await user.click(screen.getByRole('button', { name: /who must sign off/i }));
    expect(await screen.findByText(/not covered by the approval policy note, so I cannot/i)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/not covered/i);
  });
});

describe('Teach me', () => {
  it('walks through static steps without any AI call', async () => {
    const api = mockApi(okGreeting());
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Teach me' }));
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
    expect(api.to(TEACH)).toHaveLength(0);
  });

  it('sends the current step with a follow-up question', async () => {
    const api = mockApi({ ...okGreeting(), [TEACH]: () => sseOf([meta(), token('Because safety first.'), done]) });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Teach me' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    await user.type(screen.getByLabelText('Your message'), 'why?{Enter}');
    expect(await screen.findByText('Because safety first.')).toBeInTheDocument();
    expect(api.to(TEACH)[0]?.body).toMatchObject({ step: 2, question: 'why?', history: [] });
  });

  it('keeps the steps usable when the follow-up fails', async () => {
    mockApi({ ...okGreeting(), [TEACH]: () => jsonResponse(503, {}) });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Teach me' }));
    await user.type(screen.getByLabelText('Your message'), 'why?{Enter}');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next step' })).toBeEnabled();
  });
});

/** Same as `c.response` but errors the stream when the request is aborted, like a real fetch. */
function controlledWith(c: ReturnType<typeof controlledSse>, signal: AbortSignal | null | undefined): Response {
  signal?.addEventListener('abort', () => {
    try {
      c.fail();
    } catch {
      /* closed */
    }
  });
  return c.response;
}
