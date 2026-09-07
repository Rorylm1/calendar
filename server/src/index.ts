import { readConfig } from './config.ts';
import { buildApp } from './app.ts';

process.umask(0o077);
try {
  const config = readConfig(); const { app } = buildApp(config);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
  await app.listen({ host: config.HOST, port: config.PORT });
  console.info(`Calendar service listening on ${config.HOST}:${config.PORT}`);
} catch (error) {
  // Configuration errors name missing fields only; provider errors and request bodies are never logged.
  console.error(error instanceof Error && error.message.startsWith('Invalid service configuration:') ? error.message : 'Calendar service could not start. Check the configuration, runtime version, and available port.');
  process.exitCode = 1;
}
