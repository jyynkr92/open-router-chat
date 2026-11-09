import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@/generated/prisma/client';
import { claimNextGeneration, type ClaimedGeneration } from '@/worker/generation-worker';

export type PendingGenerationFixture = {
  chatId: string;
  generationId: string;
  assistantMessageId: string;
};

export const createPendingGeneration = async (
  client: PrismaClient,
  userContent = '테스트 질문',
): Promise<PendingGenerationFixture> => {
  const chatId = randomUUID();
  const generationId = randomUUID();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  await client.chat.create({ data: { id: chatId } });
  await client.message.create({
    data: {
      id: userMessageId,
      chatId,
      role: 'user',
      content: userContent,
      status: 'completed',
      sequenceNo: 1,
    },
  });
  await client.message.create({
    data: {
      id: assistantMessageId,
      chatId,
      role: 'assistant',
      content: '',
      status: 'pending',
      sequenceNo: 2,
      generationId,
    },
  });
  await client.generationRequest.create({
    data: {
      id: generationId,
      clientRequestId: randomUUID(),
      requestFingerprint: randomUUID(),
      chatId,
      userMessageId,
      assistantMessageId,
      operation: 'send',
    },
  });
  return { chatId, generationId, assistantMessageId };
};

export const claimGeneration = async (
  client: PrismaClient,
  pending: PendingGenerationFixture,
  workerId = randomUUID(),
): Promise<ClaimedGeneration> => {
  const claimed = await claimNextGeneration(client, workerId, undefined, pending.generationId);
  if (!claimed || claimed.generationId !== pending.generationId)
    throw new Error('Test generation was not claimed');
  return claimed;
};

export const createClaimedGeneration = async (client: PrismaClient): Promise<ClaimedGeneration> => {
  const pending = await createPendingGeneration(client, '질문');
  return claimGeneration(client, pending);
};
