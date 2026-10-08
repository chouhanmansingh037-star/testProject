import { z } from 'zod';

/**
 * API contract (schema-first). Server routes and the browser both import from here,
 * so the request, response and SSE event shapes cannot drift apart.
 */

// ---------- Domain ----------
export const ApprovalTypeSchema = z.enum(['folder', 'video', 'pdf', 'image']);
export const PrioritySchema = z.enum(['high', 'medium', 'low']);
export type Priority = z.infer<typeof PrioritySchema>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ItemIdSchema = z.string().regex(/^apr-\d{3}$/);

export const ApprovalItemSchema = z.strictObject({
  id: ItemIdSchema,
  title: z.string().min(1).max(200),
  type: ApprovalTypeSchema,
  path: z.string().min(1).max(200),
  submittedBy: z.string().min(1).max(100),
  submittedOn: IsoDateSchema,
  status: z.enum(['pending_review', 'approved', 'rejected']),
  description: z.string().max(500),
  safetyCritical: z.boolean(),
  blocksOthers: z.boolean(),
});
export type ApprovalItem = z.infer<typeof ApprovalItemSchema>;

export const ApprovalsDatasetSchema = z.strictObject({
  referenceDate: IsoDateSchema,
  items: z.array(ApprovalItemSchema),
});

export const ApprovalsResponseSchema = z.strictObject({
  items: z.array(ApprovalItemSchema),
  pendingCount: z.number().int().nonnegative(),
});
export type ApprovalsResponse = z.infer<typeof ApprovalsResponseSchema>;

// ---------- Limits ----------
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_HISTORY_MESSAGES = 20;

// ---------- Requests ----------
const UserTextSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'Message cannot be empty').max(MAX_MESSAGE_CHARS));

export const ChatMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS * 4),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

const HistorySchema = z.array(ChatMessageSchema).max(MAX_HISTORY_MESSAGES).default([]);

export const SummaryRequestSchema = z.strictObject({});
export const GreetingRequestSchema = z.strictObject({
  /** Lets the client ask for a different wording on "Replay Greeting". */
  variation: z.number().int().min(0).max(1000).optional(),
});
export const ChatRequestSchema = z.strictObject({
  message: UserTextSchema,
  history: HistorySchema,
});
export const HelpRequestSchema = z.strictObject({
  question: UserTextSchema,
});
export const TeachRequestSchema = z.strictObject({
  step: z.number().int().min(0).max(20),
  question: UserTextSchema,
  history: HistorySchema,
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type HelpRequest = z.infer<typeof HelpRequestSchema>;
export type TeachRequest = z.infer<typeof TeachRequestSchema>;

// ---------- LLM output (what the model is allowed to return) ----------
export const SummaryModelOutputSchema = z.strictObject({
  headline: z.string().trim().min(1).max(240),
  overallUrgency: PrioritySchema,
  items: z
    .array(
      z.strictObject({
        id: ItemIdSchema,
        priority: PrioritySchema,
        reason: z.string().trim().min(1).max(300),
        suggestedAction: z.string().trim().min(1).max(200),
      }),
    )
    .max(50),
});
export type SummaryModelOutput = z.infer<typeof SummaryModelOutputSchema>;

export const GreetingModelOutputSchema = z.strictObject({
  greeting: z.string().trim().min(1).max(240),
});

// ---------- Responses delivered to the UI ----------
export const SummaryItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  type: ApprovalTypeSchema,
  submittedBy: z.string(),
  priority: PrioritySchema,
  reason: z.string(),
  suggestedAction: z.string(),
});
export const SummaryResultSchema = z.strictObject({
  kind: z.literal('summary'),
  source: z.enum(['ai', 'fallback', 'static']),
  pendingCount: z.number().int().nonnegative(),
  headline: z.string(),
  overallUrgency: PrioritySchema,
  items: z.array(SummaryItemSchema),
});
export const GreetingResultSchema = z.strictObject({
  kind: z.literal('greeting'),
  source: z.enum(['ai', 'fallback', 'static']),
  pendingCount: z.number().int().nonnegative(),
  greeting: z.string(),
});
export type SummaryResult = z.infer<typeof SummaryResultSchema>;
export type GreetingResult = z.infer<typeof GreetingResultSchema>;

export const SourceRefSchema = z.strictObject({ id: z.string(), heading: z.string() });
export type SourceRef = z.infer<typeof SourceRefSchema>;

// ---------- SSE events (the only thing the browser parses from AI routes) ----------
export const ErrorCodeSchema = z.enum([
  'timeout',
  'upstream',
  'auth',
  'rate_limited',
  'invalid_output',
  'interrupted',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const SseEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('meta'),
    promptVersion: z.string(),
    grounded: z.boolean().optional(),
    sources: z.array(SourceRefSchema).optional(),
  }),
  z.strictObject({ type: z.literal('token'), text: z.string() }),
  z.strictObject({ type: z.literal('result'), data: z.union([SummaryResultSchema, GreetingResultSchema]) }),
  /** Deterministic (non-AI) answer used when the model failed before producing anything. */
  z.strictObject({ type: z.literal('fallback'), text: z.string(), reason: ErrorCodeSchema }),
  z.strictObject({ type: z.literal('error'), code: ErrorCodeSchema, message: z.string() }),
  z.strictObject({ type: z.literal('done') }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(['bad_request', 'unsupported_media_type', 'payload_too_large', 'rate_limited', 'not_found', 'internal']),
    message: z.string(),
    requestId: z.string().optional(),
    retryAfterSec: z.number().optional(),
    issues: z.array(z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const SESSION_HEADER = 'x-session-id';
export const SessionIdSchema = z.uuid();
