import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { Prisma } from '@/generated/prisma/client';
import { generationStatusSchema } from '@/lib/generation-schema';
import { database } from '@/lib/server/database';
import type {
  GenerationRegistration,
  GenerationTerminalStatus,
  GenerationStatus,
} from '@/types/chat/generation';

export type GenerationBranchOperation = 'retry' | 'regenerate';

export type GenerationBranchInput = {
  clientRequestId: string;
  chatId: string;
  messageId: string;
  operation: GenerationBranchOperation;
  allowedTargetStatuses: GenerationTerminalStatus[];
};

export class GenerationBranchError extends Error {
  constructor(
    public readonly code:
      | 'chat_not_found'
      | 'message_not_found'
      | 'deleted_request'
      | 'operation_not_allowed'
      | 'generation_in_progress'
      | 'idempotency_conflict',
  ) {
    super(code);
  }
}

const branchRequestSelect = {
  chatId: true,
  userMessageId: true,
  assistantMessageId: true,
  id: true,
  status: true,
  requestFingerprint: true,
} as const;

const fingerprintFor = (input: GenerationBranchInput) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        chat_id: input.chatId,
        message_id: input.messageId,
        operation: input.operation,
      }),
    )
    .digest('hex');

const toRegistration = (request: {
  chatId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  id: string;
  status: string;
}): GenerationRegistration => {
  if (!request.chatId || !request.userMessageId || !request.assistantMessageId)
    throw new GenerationBranchError('deleted_request');
  const status = generationStatusSchema.safeParse(request.status);
  if (!status.success) throw new GenerationBranchError('deleted_request');
  return {
    chat_id: request.chatId,
    user_message_id: request.userMessageId,
    assistant_message_id: request.assistantMessageId,
    generation_id: request.id,
    status: status.data,
  };
};

const getExistingBranch = async (clientRequestId: string, fingerprint: string) => {
  const existing = await database.generationRequest.findUnique({
    where: { clientRequestId },
    select: branchRequestSelect,
  });
  if (!existing) return null;
  if (existing.requestFingerprint !== fingerprint)
    throw new GenerationBranchError('idempotency_conflict');
  return toRegistration(existing);
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const createGenerationBranchTransaction = async (
  tx: Prisma.TransactionClient,
  input: GenerationBranchInput,
  fingerprint: string,
) => {
  const existing = await tx.generationRequest.findUnique({
    where: { clientRequestId: input.clientRequestId },
    select: branchRequestSelect,
  });
  if (existing) {
    if (existing.requestFingerprint !== fingerprint)
      throw new GenerationBranchError('idempotency_conflict');
    return { data: toRegistration(existing), isDuplicate: true };
  }

  const chats = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM chats WHERE id = ${input.chatId}::uuid FOR UPDATE
  `;
  if (chats.length === 0) throw new GenerationBranchError('chat_not_found');

  const lockedExisting = await tx.generationRequest.findUnique({
    where: { clientRequestId: input.clientRequestId },
    select: branchRequestSelect,
  });
  if (lockedExisting) {
    if (lockedExisting.requestFingerprint !== fingerprint)
      throw new GenerationBranchError('idempotency_conflict');
    return { data: toRegistration(lockedExisting), isDuplicate: true };
  }

  const targetRows = await tx.$queryRaw<
    { id: string; sequence_no: number; generation_id: string | null; status: string }[]
  >`
    SELECT id, sequence_no, generation_id, status
    FROM messages
    WHERE id = ${input.messageId}::uuid
      AND chat_id = ${input.chatId}::uuid
      AND role = 'assistant'
    FOR UPDATE
  `;
  const target = targetRows[0];
  if (!target) throw new GenerationBranchError('message_not_found');
  const targetStatus = generationStatusSchema.safeParse(target.status);
  if (
    !targetStatus.success ||
    !input.allowedTargetStatuses.includes(targetStatus.data as GenerationTerminalStatus)
  )
    throw new GenerationBranchError('operation_not_allowed');
  if (!target.generation_id) throw new GenerationBranchError('deleted_request');

  const targetRequest = await tx.generationRequest.findUnique({
    where: { id: target.generation_id },
    select: { chatId: true, assistantMessageId: true, userMessageId: true, status: true },
  });
  if (
    !targetRequest ||
    targetRequest.chatId !== input.chatId ||
    targetRequest.assistantMessageId !== target.id ||
    !targetRequest.userMessageId
  )
    throw new GenerationBranchError('deleted_request');
  if (targetRequest.status !== targetStatus.data)
    throw new GenerationBranchError('operation_not_allowed');

  const userRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM messages
    WHERE chat_id = ${input.chatId}::uuid
      AND role = 'user'
      AND sequence_no = ${target.sequence_no - 1}
      AND status = 'completed'
    FOR UPDATE
  `;
  const user = userRows[0];
  if (!user || user.id !== targetRequest.userMessageId)
    throw new GenerationBranchError('operation_not_allowed');

  const activeRequest = await tx.generationRequest.findFirst({
    where: { chatId: input.chatId, status: { in: ['pending', 'streaming'] } },
    select: { id: true },
  });
  if (activeRequest) throw new GenerationBranchError('generation_in_progress');

  const deletedRequestRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM generation_requests
    WHERE chat_id = ${input.chatId}::uuid
      AND (
        assistant_message_id IN (
          SELECT id FROM messages
          WHERE chat_id = ${input.chatId}::uuid AND sequence_no >= ${target.sequence_no}
        )
        OR user_message_id IN (
          SELECT id FROM messages
          WHERE chat_id = ${input.chatId}::uuid AND sequence_no >= ${target.sequence_no}
        )
      )
  `;
  const deletedRequestIds = deletedRequestRows.map((row) => row.id);
  if (deletedRequestIds.length > 0)
    await tx.generationEvent.deleteMany({ where: { generationId: { in: deletedRequestIds } } });

  await tx.message.deleteMany({
    where: { chatId: input.chatId, sequenceNo: { gte: target.sequence_no } },
  });

  const assistantMessageId = randomUUID();
  const generationId = randomUUID();
  await tx.message.create({
    data: {
      id: assistantMessageId,
      chatId: input.chatId,
      role: 'assistant',
      content: '',
      status: 'pending',
      sequenceNo: target.sequence_no,
      generationId,
    },
  });
  await tx.generationRequest.create({
    data: {
      id: generationId,
      clientRequestId: input.clientRequestId,
      requestFingerprint: fingerprint,
      chatId: input.chatId,
      userMessageId: user.id,
      assistantMessageId,
      operation: input.operation,
      status: 'pending',
    },
  });
  return {
    data: {
      chat_id: input.chatId,
      user_message_id: user.id,
      assistant_message_id: assistantMessageId,
      generation_id: generationId,
      status: 'pending' as GenerationStatus,
    },
    isDuplicate: false,
  };
};

export const createGenerationBranch = async (
  input: GenerationBranchInput,
): Promise<{ data: GenerationRegistration; isDuplicate: boolean }> => {
  const fingerprint = fingerprintFor(input);
  const existing = await getExistingBranch(input.clientRequestId, fingerprint);
  if (existing) return { data: existing, isDuplicate: true };

  try {
    return await database.$transaction((tx) =>
      createGenerationBranchTransaction(tx, input, fingerprint),
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrent = await getExistingBranch(input.clientRequestId, fingerprint);
    if (concurrent) return { data: concurrent, isDuplicate: true };
    throw error;
  }
};
