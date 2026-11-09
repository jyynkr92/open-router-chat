import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';
import { createOpenRouterClient, OpenRouterError } from '../lib/server/openrouter';
import { runGenerationWorker, UnresponsiveGenerationProcessorError } from './generation-worker';
import { createOpenRouterGenerationProcessor } from './openrouter-generation';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const startWorker = async () => {
  const shutdownController = new AbortController();
  const handleShutdown = () => shutdownController.abort();
  process.once('SIGINT', handleShutdown);
  process.once('SIGTERM', handleShutdown);
  try {
    await database.$connect();
    const processor = process.env.OPENROUTER_API_KEY
      ? createOpenRouterGenerationProcessor({
          client: database,
          openRouter: createOpenRouterClient(),
        })
      : undefined;
    console.info(
      processor
        ? 'Worker ready. OpenRouter generation processor connected.'
        : 'Worker ready. OPENROUTER_API_KEY is not set; pending jobs are waiting.',
    );
    await runGenerationWorker({
      client: database,
      signal: shutdownController.signal,
      processor,
      onError: (error) => {
        if (error instanceof OpenRouterError) console.error(`Generation failed: ${error.code}`);
        else console.error('Generation worker iteration failed');
      },
    });
  } finally {
    process.removeListener('SIGINT', handleShutdown);
    process.removeListener('SIGTERM', handleShutdown);
    await database.$disconnect();
  }
};
startWorker().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Worker startup failed');
  if (error instanceof UnresponsiveGenerationProcessorError) process.exit(1);
  process.exitCode = 1;
});
