// Control chars (except \t \n), zero-width chars, and bidi overrides/isolates.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Removes invisible/control characters only (safe to apply to individual streamed tokens). */
export function stripInvisible(input: string): string {
  return input.replace(INVISIBLE, '');
}

/** Normalises and strips characters that have no business in prompt data or UI text. */
export function sanitizeText(input: string, maxChars: number): string {
  const cleaned = input.normalize('NFKC').replace(INVISIBLE, '');
  return Array.from(cleaned).slice(0, maxChars).join('');
}

/**
 * For untrusted text placed inside a prompt's delimited data block. Escaping `<`, `>` and `&`
 * means the text cannot close the block or inject pseudo-tags.
 */
export function toPromptData(input: string, maxChars = 300): string {
  return sanitizeText(input, maxChars).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
