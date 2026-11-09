import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { isGenerationStatus } from '@/lib/generation-status';
import { database } from '@/lib/server/database';
import type { GenerationEvent, GenerationSnapshot } from '@/types/chat/generation-events';
import type { GenerationStatus } from '@/types/chat/generation';

const EVENT_TYPES = new Set(['delta', 'completed', 'interrupted', 'error']);

export class GenerationReadError extends Error {
  constructor(public readonly code: 'generation_not_found' | 'deleted_request') {
    super(code);
  }
}

export class GenerationCursorError extends Error {
  constructor() {
    super('Generation event cursor is ahead of the stored cursor');
  }
}

export class GenerationDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationDataIntegrityError';
  }
}

type GenerationReadState = {
  generationId: string;
  assistantMessageId: string;
  status: GenerationStatus;
  lastEventSeq: bigint;
  content: string;
};

type StoredEvent = {
  generationId: string;
  assistantMessageId: string;
  eventSeq: bigint;
  eventType: string;
  payload: unknown;
};

const readGenerationState = async (
  transaction: Prisma.TransactionClient,
  generationId: string,
): Promise<GenerationReadState> => {
  const request = await transaction.generationRequest.findUnique({
    where: { id: generationId },
    select: {
      id: true,
      chatId: true,
      assistantMessageId: true,
      status: true,
      lastEventSeq: true,
      assistantMessage: { select: { id: true, content: true, generationId: true } },
    },
  });
  if (!request) throw new GenerationReadError('generation_not_found');
  if (
    !request.chatId ||
    !request.assistantMessageId ||
    !request.assistantMessage ||
    request.assistantMessage.id !== request.assistantMessageId ||
    request.assistantMessage.generationId !== request.id
  )
    throw new GenerationReadError('deleted_request');
  if (!isGenerationStatus(request.status))
    throw new GenerationDataIntegrityError('Generation status is invalid');
  return {
    generationId: request.id,
    assistantMessageId: request.assistantMessageId,
    status: request.status,
    lastEventSeq: request.lastEventSeq,
    content: request.assistantMessage.content,
  };
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GenerationDataIntegrityError('Generation event payload is invalid');
  return value as Record<string, unknown>;
};

const requiredString = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  if (typeof value !== 'string')
    throw new GenerationDataIntegrityError('Generation event payload is invalid');
  return value;
};

const requiredGenerationStatus = (
  record: Record<string, unknown>,
  key: string,
): GenerationStatus => {
  const value = requiredString(record, key);
  if (!isGenerationStatus(value))
    throw new GenerationDataIntegrityError('Generation event status is invalid');
  return value;
};

const toGenerationEvent = (event: StoredEvent): GenerationEvent => {
  if (!EVENT_TYPES.has(event.eventType))
    throw new GenerationDataIntegrityError('Generation event type is invalid');
  const payload = asRecord(event.payload);
  const base = {
    generation_id: event.generationId,
    assistant_message_id: event.assistantMessageId,
    event_seq: event.eventSeq.toString(),
  };
  if (event.eventType === 'delta') {
    return { ...base, event_type: 'delta', text: requiredString(payload, 'text') };
  }
  const result: GenerationEvent = {
    ...base,
    event_type: event.eventType as GenerationEvent['event_type'],
    status: requiredGenerationStatus(payload, 'status'),
    content: requiredString(payload, 'content'),
  };
  if (typeof payload.error_code === 'string') result.error_code = payload.error_code;
  return result;
};

const readGenerationEvents = async (
  transaction: Prisma.TransactionClient,
  generationId: string,
  assistantMessageId: string,
  afterEventSeq: bigint,
) => {
  const rows = await transaction.generationEvent.findMany({
    where: { generationId, eventSeq: { gt: afterEventSeq } },
    orderBy: { eventSeq: 'asc' },
    select: {
      generationId: true,
      eventSeq: true,
      eventType: true,
      payload: true,
    },
  });
  return rows.map((event) =>
    toGenerationEvent({
      generationId: event.generationId,
      assistantMessageId,
      eventSeq: event.eventSeq,
      eventType: event.eventType,
      payload: event.payload,
    }),
  );
};

export const getGenerationSnapshot = async (generationId: string): Promise<GenerationSnapshot> =>
  database.$transaction(
    async (transaction) => {
      const state = await readGenerationState(transaction, generationId);
      return {
        generation_id: state.generationId,
        assistant_message_id: state.assistantMessageId,
        content: state.content,
        status: state.status,
        last_event_seq: state.lastEventSeq.toString(),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

export const getGenerationEventState = async (generationId: string, afterEventSeq: bigint) =>
  database.$transaction(
    async (transaction) => {
      const state = await readGenerationState(transaction, generationId);
      if (afterEventSeq > state.lastEventSeq) throw new GenerationCursorError();
      return {
        status: state.status,
        lastEventSeq: state.lastEventSeq,
        events: await readGenerationEvents(
          transaction,
          generationId,
          state.assistantMessageId,
          afterEventSeq,
        ),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
