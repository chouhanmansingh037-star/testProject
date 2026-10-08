import type { ApprovalItem } from '../../shared/schemas';
import type { Retrieved } from '../domain/retriever';

export type LlmTask = 'summary' | 'greeting' | 'chat' | 'help' | 'teach';

export type LlmErrorCode = 'timeout' | 'upstream' | 'auth' | 'rate_limited' | 'invalid_output' | 'aborted' | 'internal';

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = 'LlmError';
  }
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Structured copy of what the prompt was built from. Real providers ignore it; the mock uses it. */
export interface MockContext {
  pending: ApprovalItem[];
  now: Date;
  question?: string;
  chunks?: Retrieved[];
  step?: number;
  variation?: number;
}

export interface LlmRequest {
  task: LlmTask;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  temperature?: number;
  signal: AbortSignal;
  mockContext: MockContext;
}

export type LlmRequestInput = Omit<LlmRequest, 'signal'>;

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<string>;
  stream(req: LlmRequest): AsyncIterable<string>;
}
