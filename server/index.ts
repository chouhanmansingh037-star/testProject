import { consoleLogger, createApp } from './app';
import { loadConfig } from './config';
import { getPendingItems, loadDataset } from './domain/approvals';
import { createProvider } from './llm/factory';

const config = loadConfig();
const provider = createProvider(config);

if (config.provider === 'anthropic' && !config.anthropicApiKey) {
  consoleLogger.warn({ msg: 'LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty: every AI call will use its fallback' });
}

const app = createApp({
  config,
  provider,
  now: () => new Date(),
  getQueue: () => getPendingItems(loadDataset().items),
  logger: consoleLogger,
});

// Bind to loopback by default so the API is not reachable from the network unless HOST says so.
const host = process.env.HOST ?? '127.0.0.1';
const server = app.listen(config.port, host, () => {
  consoleLogger.info({ msg: 'api listening', host, port: config.port, provider: provider.name, mockMode: provider.name === 'mock' ? config.mockMode : undefined });
});

process.on('unhandledRejection', (reason) => {
  consoleLogger.error({ msg: 'unhandledRejection', reason: reason instanceof Error ? reason.message : String(reason) });
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
