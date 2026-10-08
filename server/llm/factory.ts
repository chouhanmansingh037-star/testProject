import type { Config } from '../config';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import type { LlmProvider } from './types';

export function createProvider(config: Config): LlmProvider {
  if (config.provider === 'anthropic') {
    // Missing key is NOT fatal: every call fails with `auth` and the app degrades to fallbacks.
    return new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
  }
  return new MockProvider({ mode: config.mockMode, delayMs: config.mockDelayMs });
}
