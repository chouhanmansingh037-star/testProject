import type { ApiError, ErrorCode } from '../../shared/schemas';
import type { LlmErrorCode } from '../llm/types';

export type ApiErrorCode = ApiError['error']['code'];

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly issues?: string[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorBody(
  code: ApiErrorCode,
  message: string,
  extra: { requestId?: string; retryAfterSec?: number; issues?: string[] } = {},
): ApiError {
  return { error: { code, message, ...extra } };
}

/** Fixed, user-safe wording. Provider messages are never forwarded. */
export const USER_MESSAGES: Record<ErrorCode, string> = {
  timeout: 'The assistant took too long to respond.',
  upstream: 'The assistant is temporarily unavailable.',
  auth: 'The assistant is not configured correctly.',
  rate_limited: 'The assistant is busy right now. Please try again shortly.',
  invalid_output: 'The assistant returned an unusable answer.',
  interrupted: 'The response was interrupted.',
  internal: 'Something went wrong.',
};

export function toErrorCode(code: LlmErrorCode): ErrorCode {
  return code === 'aborted' ? 'interrupted' : code;
}
