import type { PrismaClient } from '../generated/prisma/client';
import { loadGenerationContext } from '../lib/server/generation-context';
import {
  OpenRouterError,
  type OpenRouterClient,
  type OpenRouterStreamEvent,
} from '../lib/server/openrouter';
import { createGenerationWriter } from './generation-persistence';
import type { GenerationProcessor } from './generation-worker';

export const createOpenRouterGenerationProcessor =
  (input: {
    client: PrismaClient;
    openRouter: Pick<OpenRouterClient, 'stream'>;
    onEvent?: (event: OpenRouterStreamEvent) => void | Promise<void>;
  }): GenerationProcessor =>
  async (generation, signal) => {
    const context = await loadGenerationContext(input.client, generation.generationId);
    const writer = createGenerationWriter({ client: input.client, generation });
    const stream = input.openRouter.stream(context, signal);
    const notify = async (event: OpenRouterStreamEvent) => {
      try {
        await input.onEvent?.(event);
      } catch {
        // Delivery failures must not turn a persisted generation into a failed one.
      }
    };
    try {
      for await (const event of stream) {
        if (event.type === 'delta') {
          const persistedDelta = await writer.append(event.text);
          if (persistedDelta) await notify({ type: 'delta', text: persistedDelta });
        }
        if (event.type === 'done') {
          const persistedDelta = await writer.complete();
          if (persistedDelta) await notify({ type: 'delta', text: persistedDelta });
          await notify(event);
        }
      }
    } catch (error) {
      if (signal.aborted && signal.reason === 'cancel') {
        const persistedDelta = await writer.interrupt();
        if (persistedDelta) await notify({ type: 'delta', text: persistedDelta });
        return;
      }
      const errorCode =
        error instanceof OpenRouterError
          ? error.code
          : signal.reason === 'timeout'
            ? 'generation_timeout'
            : 'upstream_disconnected';
      const persistedDelta = await writer.fail(errorCode);
      if (persistedDelta) await notify({ type: 'delta', text: persistedDelta });
      throw error;
    }
  };
