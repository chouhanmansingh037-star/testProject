import { z } from 'zod';
import { MOCK_MODES } from './llm/mock';

const intFromEnv = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const EnvSchema = z.object({
  PORT: intFromEnv(4000, 1, 65535),
  LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  MOCK_MODE: z.enum(MOCK_MODES).default('ok'),
  MOCK_DELAY_MS: intFromEnv(15, 0, 2000),
  LLM_TIMEOUT_MS: intFromEnv(8000, 20, 30000),
  RATE_LIMIT_SESSION_MAX: intFromEnv(20, 1, 10000),
  RATE_LIMIT_IP_MAX: intFromEnv(60, 1, 100000),
  RATE_LIMIT_WINDOW_MS: intFromEnv(60_000, 100, 3_600_000),
  NODE_ENV: z.string().optional(),
});

export interface Config {
  port: number;
  provider: 'mock' | 'anthropic';
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  mockMode: (typeof MOCK_MODES)[number];
  mockDelayMs: number;
  llmTimeoutMs: number;
  rateLimit: { sessionMax: number; ipMax: number; windowMs: number };
  isProduction: boolean;
}

/** Validates env once at boot: a typo in config fails loudly instead of silently changing behaviour. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  return {
    port: e.PORT,
    provider: e.LLM_PROVIDER,
    anthropicApiKey: e.ANTHROPIC_API_KEY?.trim() || undefined,
    anthropicModel: e.ANTHROPIC_MODEL,
    mockMode: e.MOCK_MODE,
    mockDelayMs: e.MOCK_DELAY_MS,
    llmTimeoutMs: e.LLM_TIMEOUT_MS,
    rateLimit: { sessionMax: e.RATE_LIMIT_SESSION_MAX, ipMax: e.RATE_LIMIT_IP_MAX, windowMs: e.RATE_LIMIT_WINDOW_MS },
    isProduction: e.NODE_ENV === 'production',
  };
}
