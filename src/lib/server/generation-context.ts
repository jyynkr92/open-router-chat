import type { PrismaClient } from '@/generated/prisma/client';
import type { GenerationContextMessage } from '@/types/chat/generation-context';

const toContextRole = (role: string): GenerationContextMessage['role'] => {
  if (role === 'user' || role === 'assistant') return role;
  throw new Error('Generation context contains an invalid message role');
};

export const loadGenerationContext = async (
  client: PrismaClient,
  generationId: string,
): Promise<GenerationContextMessage[]> => {
  const request = await client.generationRequest.findUnique({
    where: { id: generationId },
    select: { chatId: true },
  });
  if (!request?.chatId) throw new Error('Generation chat is unavailable');

  const messages = await client.message.findMany({
    where: {
      chatId: request.chatId,
      role: { in: ['user', 'assistant'] },
      status: 'completed',
    },
    orderBy: { sequenceNo: 'asc' },
    select: { role: true, content: true },
  });

  return messages.map((message) => ({
    role: toContextRole(message.role),
    content: message.content,
  }));
};
