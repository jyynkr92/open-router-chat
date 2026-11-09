import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma/client';
import { deleteChat } from '@/lib/server/chat-delete';
import {
  GenerationWriteRejectedError,
  createGenerationWriter,
} from '@/worker/generation-persistence';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('chat deletion', () => {
  let client: PrismaClient;
  const requestIds: string[] = [];

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
    await client.$connect();
  });

  afterAll(async () => {
    if (!client) return;
    await client.generationRequest.deleteMany({ where: { id: { in: requestIds } } });
    await client.$disconnect();
  });

  const createRequest = async (status: 'pending' | 'streaming' | 'completed') => {
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const generationId = randomUUID();
    const clientRequestId = randomUUID();
    requestIds.push(generationId);
    await client.chat.create({ data: { id: chatId } });
    await client.message.createMany({
      data: [
        {
          id: userMessageId,
          chatId,
          role: 'user',
          content: '삭제할 질문',
          status: 'completed',
          sequenceNo: 1,
        },
        {
          id: assistantMessageId,
          chatId,
          role: 'assistant',
          content: '삭제할 답변',
          status:
            status === 'pending' ? 'pending' : status === 'streaming' ? 'streaming' : 'completed',
          sequenceNo: 2,
          generationId,
        },
      ],
    });
    await client.generationRequest.create({
      data: {
        id: generationId,
        clientRequestId,
        requestFingerprint: randomUUID(),
        chatId,
        userMessageId,
        assistantMessageId,
        operation: 'send',
        status,
        ...(status === 'streaming'
          ? { workerId: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) }
          : {}),
      },
    });
    await client.generationEvent.create({
      data: {
        generationId,
        eventSeq: 1n,
        eventType: status === 'completed' ? 'completed' : 'delta',
        payload: { generation_id: generationId, text: '삭제' },
      },
    });
    return { chatId, generationId, assistantMessageId };
  };

  it('terminates active work and deletes chat records while preserving request idempotency', async () => {
    const pending = await createRequest('pending');
    const streaming = await createRequest('streaming');
    const completed = await createRequest('completed');

    expect(await deleteChat(client, pending.chatId)).toBe(true);
    expect(await deleteChat(client, pending.chatId)).toBe(false);

    const deletedRequests = await client.generationRequest.findMany({
      where: { id: pending.generationId },
      select: {
        id: true,
        chatId: true,
        userMessageId: true,
        assistantMessageId: true,
        status: true,
      },
    });
    expect(deletedRequests).toHaveLength(1);
    expect(deletedRequests[0]).toMatchObject({
      id: pending.generationId,
      chatId: null,
      userMessageId: null,
      assistantMessageId: null,
      status: 'interrupted',
    });

    expect(await client.chat.count({ where: { id: pending.chatId } })).toBe(0);
    expect(await client.message.count({ where: { chatId: pending.chatId } })).toBe(0);
    expect(
      await client.generationEvent.count({ where: { generationId: pending.generationId } }),
    ).toBe(0);

    await deleteChat(client, streaming.chatId);
    await deleteChat(client, completed.chatId);
    const remainingRequests = await client.generationRequest.findMany({
      where: { id: { in: [streaming.generationId, completed.generationId] } },
      select: { id: true, chatId: true, status: true },
    });
    expect(remainingRequests).toEqual(
      expect.arrayContaining([
        { id: streaming.generationId, chatId: null, status: 'interrupted' },
        { id: completed.generationId, chatId: null, status: 'completed' },
      ]),
    );
  });

  it('rejects a late worker write after deletion', async () => {
    const fixture = await createRequest('streaming');
    const workerId = randomUUID();
    const writer = createGenerationWriter({
      client,
      generation: {
        generationId: fixture.generationId,
        chatId: fixture.chatId,
        assistantMessageId: fixture.assistantMessageId,
        workerId,
      },
    });
    await client.generationRequest.update({
      where: { id: fixture.generationId },
      data: { workerId },
    });
    await deleteChat(client, fixture.chatId);

    await expect(writer.append('늦은 응답')).resolves.toBeNull();
    await expect(writer.complete()).rejects.toBeInstanceOf(GenerationWriteRejectedError);
  });
});
