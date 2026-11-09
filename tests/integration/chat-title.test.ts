import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma/client';
import { generateChatTitle } from '@/lib/server/chat-title';
import type { OpenRouterClient } from '@/lib/server/openrouter';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('chat title generation', () => {
  let client: PrismaClient;
  const chatIds: string[] = [];
  const createChat = async (titleSource = 'default') => {
    const chatId = randomUUID();
    chatIds.push(chatId);
    await client.chat.create({ data: { id: chatId, titleSource } });
    await client.message.create({
      data: {
        id: randomUUID(),
        chatId,
        role: 'user',
        content: 'PostgreSQL 장애를 안전하게 복구하는 방법을 알려줘',
        status: 'completed',
        sequenceNo: 1,
      },
    });
    return chatId;
  };
  const openRouter = (complete: OpenRouterClient['complete']): OpenRouterClient => ({
    complete,
    stream: async function* () {},
  });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
    await client.$connect();
  });

  afterAll(async () => {
    if (!client) return;
    await client.chat.deleteMany({ where: { id: { in: chatIds } } });
    await client.$disconnect();
  });

  it('summarizes the first user question and stores an automatic title', async () => {
    const chatId = await createChat();
    const result = await generateChatTitle({
      client,
      chatId,
      openRouter: openRouter(async (messages) => {
        expect(messages).toHaveLength(2);
        expect(messages[0]?.role).toBe('system');
        expect(messages[1]).toMatchObject({ role: 'user' });
        return 'PostgreSQL 복구 방법';
      }),
    });

    expect(result).toMatchObject({
      chat_id: chatId,
      title: 'PostgreSQL 복구 방법',
      title_source: 'auto',
      title_status: 'completed',
    });
  });

  it('does not call the model twice for concurrent title requests', async () => {
    const chatId = await createChat();
    let calls = 0;
    const openRouter = openRouterForTest(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return '동시 요청 제목';
    });

    const results = await Promise.all([
      generateChatTitle({ client, chatId, openRouter }),
      generateChatTitle({ client, chatId, openRouter }),
    ]);

    expect(calls).toBe(1);
    expect(results.map((result) => result.title_status).sort()).toEqual([
      'completed',
      'generating',
    ]);
  });

  it('preserves a manual title and allows a failed attempt to retry', async () => {
    const manualChatId = await createChat('manual');
    let manualCalls = 0;
    const manualResult = await generateChatTitle({
      client,
      chatId: manualChatId,
      openRouter: openRouter(async () => {
        manualCalls += 1;
        return '덮어쓰면 안 됨';
      }),
    });
    expect(manualCalls).toBe(0);
    expect(manualResult.title_source).toBe('manual');

    const retryChatId = await createChat();
    await expect(
      generateChatTitle({
        client,
        chatId: retryChatId,
        openRouter: openRouter(async () => {
          throw new Error('upstream failed');
        }),
      }),
    ).rejects.toMatchObject({ code: 'title_generation_failed' });
    const retryResult = await generateChatTitle({
      client,
      chatId: retryChatId,
      openRouter: openRouter(async () => '재시도 제목'),
    });
    expect(retryResult.title).toBe('재시도 제목');
  });
});

const openRouterForTest = (complete: OpenRouterClient['complete']): OpenRouterClient => ({
  complete,
  stream: async function* () {},
});
