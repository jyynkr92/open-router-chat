import type { PrismaClient } from '@/generated/prisma/client';

export class ChatTitleUpdateError extends Error {
  constructor(public readonly code: 'chat_not_found' | 'invalid_title') {
    super(code);
    this.name = 'ChatTitleUpdateError';
  }
}

const normalizeTitle = (title: string) => {
  const normalized = title.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 100 ||
    normalized.includes('\n') ||
    normalized.includes('\r')
  )
    throw new ChatTitleUpdateError('invalid_title');
  return normalized;
};

export const updateChatTitle = async (input: {
  client: PrismaClient;
  chatId: string;
  title: string;
}) => {
  const title = normalizeTitle(input.title);
  const updated = await input.client.chat.updateMany({
    where: { id: input.chatId },
    data: {
      title,
      titleSource: 'manual',
      titleStatus: 'idle',
      titleVersion: { increment: 1 },
      titleStartedAt: null,
    },
  });
  if (updated.count !== 1) throw new ChatTitleUpdateError('chat_not_found');
  const chat = await input.client.chat.findUniqueOrThrow({
    where: { id: input.chatId },
    select: { id: true, title: true, titleSource: true, titleStatus: true },
  });
  return {
    chat_id: chat.id,
    title: chat.title,
    title_source: chat.titleSource,
    title_status: chat.titleStatus,
  };
};
