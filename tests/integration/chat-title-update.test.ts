import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma/client';
import { ChatTitleUpdateError, updateChatTitle } from '@/lib/server/chat-title-update';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('manual chat title update', () => {
  let client: PrismaClient;
  const chatIds: string[] = [];

  const createChat = async () => {
    const id = randomUUID();
    chatIds.push(id);
    await client.chat.create({ data: { id } });
    return id;
  };

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
    await client.$connect();
  });

  afterAll(async () => {
    if (!client) return;
    await client.chat.deleteMany({ where: { id: { in: chatIds } } });
    await client.$disconnect();
  });

  it('trims and stores a manual title with an incremented version', async () => {
    const chatId = await createChat();
    await expect(
      updateChatTitle({ client, chatId, title: '  내가 정한 이름  ' }),
    ).resolves.toMatchObject({
      chat_id: chatId,
      title: '내가 정한 이름',
      title_source: 'manual',
      title_status: 'idle',
    });
    await expect(client.chat.findUniqueOrThrow({ where: { id: chatId } })).resolves.toMatchObject({
      titleVersion: 1,
      titleStartedAt: null,
    });
  });

  it('rejects empty, multiline, and overlong titles without changing the chat', async () => {
    const chatId = await createChat();
    for (const title of ['', '첫 줄\n둘째 줄', 'a'.repeat(101)]) {
      await expect(updateChatTitle({ client, chatId, title })).rejects.toMatchObject({
        code: 'invalid_title',
      });
    }
    await expect(client.chat.findUniqueOrThrow({ where: { id: chatId } })).resolves.toMatchObject({
      title: '새 채팅',
      titleVersion: 0,
      titleSource: 'default',
    });
  });

  it('fences a late automatic title result after a manual update', async () => {
    const chatId = await createChat();
    await client.chat.update({
      where: { id: chatId },
      data: { titleStatus: 'generating', titleVersion: 1, titleStartedAt: new Date() },
    });
    await updateChatTitle({ client, chatId, title: '수동 이름' });

    const lateAutomaticUpdate = await client.chat.updateMany({
      where: {
        id: chatId,
        titleSource: 'default',
        titleStatus: 'generating',
        titleVersion: 1,
      },
      data: { title: '늦은 자동 이름', titleSource: 'auto', titleStatus: 'completed' },
    });
    expect(lateAutomaticUpdate.count).toBe(0);
    await expect(client.chat.findUniqueOrThrow({ where: { id: chatId } })).resolves.toMatchObject({
      title: '수동 이름',
      titleSource: 'manual',
      titleStatus: 'idle',
      titleVersion: 2,
    });
  });

  it('rejects a missing chat', async () => {
    await expect(
      updateChatTitle({ client, chatId: randomUUID(), title: '없는 채팅' }),
    ).rejects.toBeInstanceOf(ChatTitleUpdateError);
  });
});
