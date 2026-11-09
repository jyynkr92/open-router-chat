import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma/client';
import type { GenerationStopResult } from '@/types/chat/generation-stop';
import {
  createGenerationWriter,
  GenerationWriteRejectedError,
} from '@/worker/generation-persistence';
import { createOpenRouterGenerationProcessor } from '@/worker/openrouter-generation';

import { createClaimedGeneration } from '../helpers/generation-fixture';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('generation persistence', () => {
  let client: PrismaClient;
  let stopGeneration: (generationId: string) => Promise<GenerationStopResult>;
  const generationIds: string[] = [];
  const chatIds: string[] = [];

  const createTestGeneration = async () => {
    const generation = await createClaimedGeneration(client);
    generationIds.push(generation.generationId);
    chatIds.push(generation.chatId);
    return generation;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
    await client.$connect();
    ({ stopGeneration } = await import('@/lib/server/generation-stop'));
  });

  afterAll(async () => {
    if (!client) return;
    await client.generationRequest.deleteMany({ where: { id: { in: generationIds } } });
    await client.chat.deleteMany({ where: { id: { in: chatIds } } });
    await client.$disconnect();
  });

  it('persists checkpoint and terminal event with ordered cursors', async () => {
    const generation = await createTestGeneration();
    const writer = createGenerationWriter({ client, generation });

    await writer.append('안녕');
    await writer.complete();

    const request = await client.generationRequest.findUniqueOrThrow({
      where: { id: generation.generationId },
    });
    const message = await client.message.findUniqueOrThrow({
      where: { id: generation.assistantMessageId },
    });
    const events = await client.generationEvent.findMany({
      where: { generationId: generation.generationId },
      orderBy: { eventSeq: 'asc' },
    });

    expect(request.status).toBe('completed');
    expect(request.lastEventSeq).toBe(2n);
    expect(message).toMatchObject({ content: '안녕', status: 'completed' });
    expect(events.map((event) => [event.eventSeq, event.eventType])).toEqual([
      [1n, 'delta'],
      [2n, 'completed'],
    ]);
    expect(events[1]?.payload).toMatchObject({ content: '안녕', status: 'completed' });
  });

  it('rejects a write after worker ownership changes', async () => {
    const generation = await createTestGeneration();
    const writer = createGenerationWriter({ client, generation });
    await client.generationRequest.update({
      where: { id: generation.generationId },
      data: { workerId: randomUUID() },
    });

    await expect(writer.complete()).rejects.toBeInstanceOf(GenerationWriteRejectedError);
    expect(
      (await client.generationRequest.findUniqueOrThrow({ where: { id: generation.generationId } }))
        .status,
    ).toBe('streaming');
  });

  it('keeps a completed generation when event delivery fails', async () => {
    const generation = await createTestGeneration();
    const processor = createOpenRouterGenerationProcessor({
      client,
      openRouter: {
        stream: async function* () {
          yield { type: 'delta', text: '응답' } as const;
          yield { type: 'done' } as const;
        },
      },
      onEvent: () => {
        throw new Error('client disconnected');
      },
    });

    await processor(generation, new AbortController().signal);

    expect(
      (await client.generationRequest.findUniqueOrThrow({ where: { id: generation.generationId } }))
        .status,
    ).toBe('completed');
  });

  it('stores failed generation status as an error event', async () => {
    const generation = await createTestGeneration();
    const writer = createGenerationWriter({ client, generation });

    await writer.append('부분 응답');
    await writer.fail('upstream_disconnected');

    const message = await client.message.findUniqueOrThrow({
      where: { id: generation.assistantMessageId },
    });
    const event = await client.generationEvent.findFirstOrThrow({
      where: { generationId: generation.generationId },
      orderBy: { eventSeq: 'desc' },
    });

    expect(message).toMatchObject({
      content: '부분 응답',
      status: 'failed',
      errorCode: 'upstream_disconnected',
    });
    expect(event.eventType).toBe('error');
    expect(event.payload).toMatchObject({
      content: '부분 응답',
      status: 'failed',
      error_code: 'upstream_disconnected',
    });
  });

  it('stores partial content and interrupted status after cancellation', async () => {
    const generation = await createTestGeneration();
    let releaseDelta: (() => void) | undefined;
    const deltaYielded = new Promise<void>((resolve) => {
      releaseDelta = resolve;
    });
    const processor = createOpenRouterGenerationProcessor({
      client,
      openRouter: {
        stream: async function* (_context, signal) {
          yield { type: 'delta', text: '부분 응답' } as const;
          releaseDelta?.();
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('upstream aborted')), {
              once: true,
            });
          });
        },
      },
    });
    const controller = new AbortController();
    const processing = processor(generation, controller.signal);
    await deltaYielded;
    controller.abort('cancel');
    await processing;

    const message = await client.message.findUniqueOrThrow({
      where: { id: generation.assistantMessageId },
    });
    const request = await client.generationRequest.findUniqueOrThrow({
      where: { id: generation.generationId },
    });
    const event = await client.generationEvent.findFirstOrThrow({
      where: { generationId: generation.generationId },
      orderBy: { eventSeq: 'desc' },
    });

    expect(message).toMatchObject({ content: '부분 응답', status: 'interrupted' });
    expect(request.status).toBe('interrupted');
    expect(event.eventType).toBe('interrupted');
  });

  it('gives an earlier stop request precedence over a late completion', async () => {
    const generation = await createTestGeneration();
    const writer = createGenerationWriter({ client, generation });

    await writer.append('부분 응답');
    await expect(stopGeneration(generation.generationId)).resolves.toMatchObject({
      status: 'streaming',
      stop_requested: true,
    });
    await writer.complete();

    const request = await client.generationRequest.findUniqueOrThrow({
      where: { id: generation.generationId },
    });
    const message = await client.message.findUniqueOrThrow({
      where: { id: generation.assistantMessageId },
    });
    const event = await client.generationEvent.findFirstOrThrow({
      where: { generationId: generation.generationId },
      orderBy: { eventSeq: 'desc' },
    });

    expect(request.status).toBe('interrupted');
    expect(message.status).toBe('interrupted');
    expect(event.eventType).toBe('interrupted');
  });
});
