import 'server-only';

import type { PrismaClient } from '@/generated/prisma/client';

export const deleteChat = async (client: PrismaClient, chatId: string): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    const chats = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id FROM chats WHERE id = ${chatId}::uuid FOR UPDATE
    `;
    if (chats.length === 0) return false;

    const requests = await transaction.generationRequest.findMany({
      where: { chatId },
      select: { id: true, status: true },
    });
    const requestIds = requests.map((request) => request.id);
    const activeRequestIds = requests
      .filter((request) => request.status === 'pending' || request.status === 'streaming')
      .map((request) => request.id);

    if (activeRequestIds.length > 0) {
      await transaction.generationRequest.updateMany({
        where: { id: { in: activeRequestIds }, status: { in: ['pending', 'streaming'] } },
        data: {
          status: 'interrupted',
          cancelRequestedAt: new Date(),
          workerId: null,
          leaseExpiresAt: null,
        },
      });
    }

    if (requestIds.length > 0) {
      await transaction.generationEvent.deleteMany({
        where: { generationId: { in: requestIds } },
      });
    }
    await transaction.message.deleteMany({ where: { chatId } });
    await transaction.generationRequest.updateMany({
      where: { chatId },
      data: {
        chatId: null,
        userMessageId: null,
        assistantMessageId: null,
        workerId: null,
        leaseExpiresAt: null,
      },
    });
    await transaction.chat.delete({ where: { id: chatId } });
    return true;
  });
