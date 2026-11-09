import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma/client';
import { createClaimedGeneration, createPendingGeneration } from '../helpers/generation-fixture';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('generation stop', () => {
  let client: PrismaClient;
  let stopGeneration: (generationId: string) => Promise<{
    generation_id: string;
    status: string;
    stop_requested: boolean;
  }>;
  const generationIds: string[] = [];
  const chatIds: string[] = [];

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

  it('interrupts a pending generation and writes the terminal event', async () => {
    const pending = await createPendingGeneration(client);
    generationIds.push(pending.generationId);
    chatIds.push(pending.chatId);

    await expect(stopGeneration(pending.generationId)).resolves.toMatchObject({
      generation_id: pending.generationId,
      status: 'interrupted',
      stop_requested: false,
    });
    const request = await client.generationRequest.findUniqueOrThrow({
      where: { id: pending.generationId },
    });
    const message = await client.message.findUniqueOrThrow({
      where: { id: pending.assistantMessageId },
    });
    const event = await client.generationEvent.findFirstOrThrow({
      where: { generationId: pending.generationId },
    });

    expect(request.status).toBe('interrupted');
    expect(message.status).toBe('interrupted');
    expect(event.eventType).toBe('interrupted');
  });

  it('requests cancellation for streaming and remains idempotent', async () => {
    const generation = await createClaimedGeneration(client);
    generationIds.push(generation.generationId);
    chatIds.push(generation.chatId);

    await expect(stopGeneration(generation.generationId)).resolves.toMatchObject({
      generation_id: generation.generationId,
      status: 'streaming',
      stop_requested: true,
    });
    await expect(stopGeneration(generation.generationId)).resolves.toMatchObject({
      generation_id: generation.generationId,
      status: 'streaming',
      stop_requested: true,
    });
    expect(
      (await client.generationRequest.findUniqueOrThrow({ where: { id: generation.generationId } }))
        .cancelRequestedAt,
    ).not.toBeNull();
  });

  it('does not overwrite an already completed generation', async () => {
    const generation = await createClaimedGeneration(client);
    generationIds.push(generation.generationId);
    chatIds.push(generation.chatId);
    await client.generationRequest.update({
      where: { id: generation.generationId },
      data: { status: 'completed', leaseExpiresAt: null },
    });
    await client.message.update({
      where: { id: generation.assistantMessageId },
      data: { status: 'completed', content: '완료 응답' },
    });

    await expect(stopGeneration(generation.generationId)).resolves.toMatchObject({
      generation_id: generation.generationId,
      status: 'completed',
      stop_requested: false,
    });
    expect(
      (await client.generationRequest.findMany({ where: { id: generation.generationId } })).length,
    ).toBe(1);
    expect(
      (await client.generationEvent.findMany({ where: { generationId: generation.generationId } }))
        .length,
    ).toBe(0);
  });
});
