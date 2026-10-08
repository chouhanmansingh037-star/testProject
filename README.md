# Approvals Assistant (Crystal Ball, Sr. Fullstack MERN + AI, Wave 2)

A rebuild of the OomniEye "Approvals" assistant panel. Five actions, each backed by a server-side LLM call with a validated contract, a timeout, and a non-AI fallback.

**Stack:** Next.js 16 (React 19) · Zustand · Express 5 · TypeScript strict · Zod 4 · Anthropic SDK (Claude) · Jest + Supertest · Vitest + Testing Library.

## Run it

```bash
npm install
cp .env.example .env     # optional: defaults already work
npm run dev              # API on :4000, web on :3000 -> open http://localhost:3000
npm test                 # 107 server tests + 38 client tests
npm run typecheck
```

**No API key is needed.** `LLM_PROVIDER=mock` (the default) is a deterministic stand-in for the model. To use Claude, set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env` (server-side only; never `NEXT_PUBLIC_`). The Anthropic adapter is unit-tested against a fake SDK client only. I had no key to test it live, so a real-key smoke test is the first thing to do.

### Failure drills (for reviewers)
Set in `.env`, restart the API, use the UI. Nothing should freeze or show a raw 500.

| Setting | What it simulates | Expected |
|---|---|---|
| `MOCK_MODE=timeout` `LLM_TIMEOUT_MS=2000` | provider hangs | fallback after ~2s |
| `MOCK_MODE=error` / `auth` / `rate_limited` | provider failures | fallback |
| `MOCK_MODE=malformed` / `hallucinated` / `empty` | bad JSON, unknown ids, no output | retry once, then fallback |
| `MOCK_MODE=partial` | stream dies after 3 tokens | partial text kept + "interrupted" |
| `LLM_PROVIDER=anthropic` + empty key | "killed API key" | every action falls back |

## Architecture

```
Browser -> Next.js (:3000)  --/api rewrite-->  Express (:4000) -> LlmProvider (mock | Anthropic)
 Zustand store                                  Zod validate -> rate limit -> prompt -> guard(timeout) -> Zod validate output -> SSE
```

- `shared/schemas.ts`: the contract (requests, model outputs, SSE events). Server and browser both import it, and the server validates every event it sends, so the two cannot drift.
- `prompts/*.v1.ts`: versioned prompt exports; the version is logged and returned in the SSE `meta` event.
- `server/llm/guard.ts`: first-token, idle and total timeouts; works even if a provider ignores `AbortSignal`.
- `server/llm/structured.ts`: strict-Zod JSON parse + semantic checks (ids exist, each exactly once, urgency consistent, greeting states the true count), one retry, then fallback.
- `server/domain/`: deterministic ranking, TF-IDF retrieval over 5 policy chunks, sanitising, fallbacks.
- The browser only talks to its own origin; the API and key are never reachable from client code.

## The five actions: AI-necessary or not?

| Action | LLM? | Why / non-AI fallback |
|---|---|---|
| Present me Summary | **Yes**, structured JSON | Judgment and prose over the queue. Counts, titles and ordering guarantees are computed by us. Fallback: rule-based summary, same schema. Empty queue skips the LLM. |
| Talk to me | **Yes**, streamed | Open-ended questions. Fallback: queue listed in priority order. |
| Help me | **Yes**, grounded (RAG) | Retrieval picks chunks; if none match, we refuse **without calling the model**. Fallback: best policy chunk verbatim. |
| Teach me | **Mostly no** | The steps are static content. Only follow-up questions use the LLM. Fallback: the step text. |
| Replay Greeting | **Barely** | A template with the live count would do. The LLM only varies tone, and its output is rejected if it states the wrong count. |

## README note (AI-necessary vs not, fallback, one thing I'd change)

AI is necessary where the input is open-ended: summarising/prioritising, free-form chat, and answering policy questions in natural language. It is unnecessary for ordering, counts and the greeting's facts, so those are computed deterministically and the model only explains them. Teach-me steps are static content. Every call has an 8s timeout (first-token and idle for streams); on failure before any output the server sends a deterministic fallback, and mid-stream failures keep the partial text and flag it as interrupted. Model JSON is validated with strict Zod plus checks against our own data; invalid output is retried once, then replaced by the rule-based result, so the UI never renders unvalidated model text. With more time I would replace keyword retrieval with embeddings (pgvector), add a shared rate-limit store (Redis), stream the summary's narrative field, and run an eval set that scores real-model answers against the policy.

## Security

- **Key handling:** server-only env, validated at boot; blank key degrades gracefully, never crashes.
- **Prompt injection:** untrusted text (titles, names, user messages) goes into delimited, escaped data blocks (`<`, `>`, `&` escaped; control/zero-width/bidi characters stripped); system rules mark all of it as data. A test feeds a hostile title that tries to close the block.
- **Output safety:** React renders text only (no `dangerouslySetInnerHTML`); a test streams `<img onerror>` and asserts it stays inert. Responses are schema-checked before use; extra keys are rejected.
- **Input validation:** strict Zod on every route, 16 KB body cap, JSON-only content type, message ≤1000 chars, history ≤20, malformed session ids rejected, and errors never echo submitted values.
- **Rate limiting:** per-session (20/min) *and* per-IP (60/min), because a client can mint session ids but not IPs. 429 includes `Retry-After`. In-memory, so single-process only.
- **Error hygiene:** fixed user-facing messages; provider errors, stack traces and keys never reach the client; logs are metadata only (no message content).
- **Headers:** helmet on the API; CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` on the web app; no CORS; API binds to `127.0.0.1` by default.
- **Dependencies:** `npm audit --omit=dev` reports 0 vulnerabilities. `npm audit` reports advisories in the **dev-only** Jest toolchain; they don't ship.
- **Known limits:** conversation history is client-supplied, so a user can forge assistant turns (they only affect their own session and are length-capped); there is no auth because the assignment has none, and a real deployment needs it before exposing this.

## Testing

- **Jest (unit):** ranking, sanitiser, retriever, fallbacks, timeout guard, structured-output parser, provider adapters (LLM mocked).
- **Supertest (integration):** every AI endpoint, success + fallback + timeout + malformed output + client disconnect + validation + rate limit + injection.
- **Vitest + Testing Library:** panel loading/streaming/error/fallback states, Stop, view switching mid-stream, XSS, SSE parser edge cases (1-byte chunks, bad events).
- I also ran the production build and exercised it with curl and a headless browser (streaming arrives incrementally through the proxy).

## Assumptions

- English only (as agreed). "Present me summary… out loud" is text only.
- Summary and greeting are structured, so they arrive as one validated `result` event; Talk/Help/Teach stream token by token.
- "Overdue" = pending more than 7 calendar days, defined in the policy note I wrote and mirrored in code.

## AI tools used

Built with Claude Code (Claude). It wrote most of the code and tests under my direction; I reviewed the design decisions and failure behaviour.

## Process note

Server core modules (domain, guard, structured output, API) were written test-first. The UI tests were written after the components. No git history was created by the assistant.
