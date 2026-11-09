import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { Prisma } from '@/generated/prisma/client';
import { database } from '@/lib/server/database';
import type { CreateGenerationInput } from '@/types/chat/generation';

export const MAX_USER_CONTENT_LENGTH = 20_000;

type GenerationRegistration = {
  chat_id: string;
  user_message_id: string;
  assistant_message_id: string;
  generation_id: string;
  status: string;
};

export class GenerationRegistrationError extends Error {
  constructor(
    public readonly code:
      | 'chat_not_found'
      | 'deleted_request'
      | 'generation_in_progress'
      | 'idempotency_conflict',
  ) {
    super(code);
  }
}

const fingerprintFor = (input: CreateGenerationInput) =>
  createHash('sha256')
    .update(JSON.stringify({ chat_id: input.chatId, content: input.content, operation: 'send' }))
    .digest('hex');

const toRegistration = (request: {
  chatId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  id: string;
  status: string;
}): GenerationRegistration => {
  if (!request.chatId || !request.userMessageId || !request.assistantMessageId)
    throw new GenerationRegistrationError('deleted_request');
  return {
    chat_id: request.chatId,
    user_message_id: request.userMessageId,
    assistant_message_id: request.assistantMessageId,
    generation_id: request.id,
    status: request.status,
  };
};

const getExistingRegistration = async (
  clientRequestId: string,
  fingerprint: string,
  requestClient: typeof database,
) => {
  const existing = await requestClient.generationRequest.findUnique({
    where: { clientRequestId },
    select: {
      chatId: true,
      userMessageId: true,
      assistantMessageId: true,
      id: true,
      status: true,
      requestFingerprint: true,
    },
  });
  if (!existing) return null;
  if (existing.requestFingerprint !== fingerprint)
    throw new GenerationRegistrationError('idempotency_conflict');
  return toRegistration(existing);
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const registerGenerationTransaction = async (
  tx: Prisma.TransactionClient,
  input: CreateGenerationInput,
  fingerprint: string,
) => {
  const transactionExisting = await tx.generationRequest.findUnique({
    where: { clientRequestId: input.clientRequestId },
    select: {
      chatId: true,
      userMessageId: true,
      assistantMessageId: true,
      id: true,
      status: true,
      requestFingerprint: true,
    },
  });
  if (transactionExisting) {
    if (transactionExisting.requestFingerprint !== fingerprint)
      throw new GenerationRegistrationError('idempotency_conflict');
    return { data: toRegistration(transactionExisting), isDuplicate: true };
  }

  const chatId = input.chatId ?? randomUUID();
  if (input.chatId) {
    const lockedChat = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM chats WHERE id = ${input.chatId}::uuid FOR UPDATE
    `;
    if (lockedChat.length === 0) throw new GenerationRegistrationError('chat_not_found');
  } else {
    await tx.chat.create({ data: { id: chatId } });
    await tx.$queryRaw`SELECT id FROM chats WHERE id = ${chatId}::uuid FOR UPDATE`;
  }

  const activeRequest = await tx.generationRequest.findFirst({
    where: { chatId, status: { in: ['pending', 'streaming'] } },
    select: { id: true },
  });
  if (activeRequest) throw new GenerationRegistrationError('generation_in_progress');

  const sequenceRows = await tx.$queryRaw<{ next_sequence_no: number }[]>`
    SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence_no
    FROM messages
    WHERE chat_id = ${chatId}::uuid
  `;
  const firstSequence = sequenceRows[0]?.next_sequence_no ?? 1;
  const generationId = randomUUID();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();

  await tx.message.create({
    data: {
      id: userMessageId,
      chatId,
      role: 'user',
      content: input.content,
      status: 'completed',
      sequenceNo: firstSequence,
    },
  });
  await tx.message.create({
    data: {
      id: assistantMessageId,
      chatId,
      role: 'assistant',
      content: '',
      status: 'pending',
      sequenceNo: firstSequence + 1,
      generationId,
    },
  });
  await tx.generationRequest.create({
    data: {
      id: generationId,
      clientRequestId: input.clientRequestId,
      requestFingerprint: fingerprint,
      chatId,
      userMessageId,
      assistantMessageId,
      operation: 'send',
      status: 'pending',
    },
  });
  return {
    data: {
      chat_id: chatId,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
      generation_id: generationId,
      status: 'pending',
    },
    isDuplicate: false,
  };
};

export const createGeneration = async (
  input: CreateGenerationInput,
): Promise<{ data: GenerationRegistration; isDuplicate: boolean }> => {
  const fingerprint = fingerprintFor(input);
  const existing = await getExistingRegistration(input.clientRequestId, fingerprint, database);
  if (existing) return { data: existing, isDuplicate: true };

  try {
    const data = await database.$transaction((tx) =>
      registerGenerationTransaction(tx, input, fingerprint),
    );
    return data;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrent = await getExistingRegistration(input.clientRequestId, fingerprint, database);
    if (concurrent) return { data: concurrent, isDuplicate: true };
    throw error;
  }
};
