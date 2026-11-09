import { randomUUID } from 'node:crypto';

import type { PrismaClient, Prisma } from '../generated/prisma/client';
import type { GenerationTerminalStatus } from '../types/chat/generation';
import type { ClaimedGeneration } from './generation-worker';

const CHECKPOINT_INTERVAL_MS = 100;
const MAX_STORAGE_RETRIES = 3;

export class GenerationWriteRejectedError extends Error {
  constructor() {
    super('Generation write was rejected by fencing conditions');
    this.name = 'GenerationWriteRejectedError';
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const withStorageRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_STORAGE_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof GenerationWriteRejectedError) throw error;
      lastError = error;
      if (attempt < MAX_STORAGE_RETRIES - 1) await wait(50 * 2 ** attempt);
    }
  }
  throw lastError;
};

type GenerationRow = {
  worker_id: string | null;
  status: string;
  cancel_requested_at: Date | null;
  lease_expires_at: Date | null;
  last_event_seq: bigint;
  chat_id: string | null;
  assistant_message_id: string | null;
};

type ExistingWriteRow = {
  event_seq: bigint;
};

type GenerationWriterInput = {
  client: PrismaClient;
  generation: ClaimedGeneration;
};

const readOwnedGeneration = async (
  transaction: Prisma.TransactionClient,
  generation: ClaimedGeneration,
): Promise<GenerationRow> => {
  const rows = await transaction.$queryRaw<GenerationRow[]>`
    SELECT worker_id, status, cancel_requested_at, lease_expires_at,
           last_event_seq, chat_id, assistant_message_id
    FROM generation_requests
    WHERE id = ${generation.generationId}::uuid
      AND lease_expires_at > now()
    FOR UPDATE
  `;
  const row = rows[0];
  if (
    !row ||
    row.worker_id !== generation.workerId ||
    row.status !== 'streaming' ||
    !row.lease_expires_at ||
    row.chat_id !== generation.chatId ||
    row.assistant_message_id !== generation.assistantMessageId
  )
    throw new GenerationWriteRejectedError();
  return row;
};

const persistCheckpoint = async (input: {
  client: PrismaClient;
  generation: ClaimedGeneration;
  content: string;
  delta: string;
  writeId: string;
}) =>
  withStorageRetry(() =>
    input.client.$transaction(async (transaction) => {
      const existingWrite = await transaction.$queryRaw<ExistingWriteRow[]>`
        SELECT event_seq
        FROM generation_events
        WHERE generation_id = ${input.generation.generationId}::uuid
          AND payload ->> 'write_id' = ${input.writeId}
        LIMIT 1
      `;
      if (existingWrite[0]) return;

      const row = await readOwnedGeneration(transaction, input.generation);
      const eventSeq = row.last_event_seq + 1n;
      await transaction.message.update({
        where: { id: input.generation.assistantMessageId },
        data: {
          content: input.content,
          status: 'streaming',
          lastActivityAt: new Date(),
        },
      });
      await transaction.generationRequest.update({
        where: { id: input.generation.generationId },
        data: { lastEventSeq: eventSeq },
      });
      await transaction.generationEvent.create({
        data: {
          generationId: input.generation.generationId,
          eventSeq,
          eventType: 'delta',
          payload: {
            generation_id: input.generation.generationId,
            assistant_message_id: input.generation.assistantMessageId,
            text: input.delta,
            write_id: input.writeId,
          },
        },
      });
    }),
  );

const persistTerminal = async (input: {
  client: PrismaClient;
  generation: ClaimedGeneration;
  content: string;
  status: GenerationTerminalStatus;
  errorCode: string | null;
  writeId: string;
}) =>
  withStorageRetry(() =>
    input.client.$transaction(async (transaction) => {
      const existingWrite = await transaction.$queryRaw<ExistingWriteRow[]>`
        SELECT event_seq
        FROM generation_events
        WHERE generation_id = ${input.generation.generationId}::uuid
          AND payload ->> 'write_id' = ${input.writeId}
        LIMIT 1
      `;
      if (existingWrite[0]) return;

      const row = await readOwnedGeneration(transaction, input.generation);
      const eventSeq = row.last_event_seq + 1n;
      const status = row.cancel_requested_at ? 'interrupted' : input.status;
      const errorCode = status === 'interrupted' ? null : input.errorCode;
      const payload = {
        generation_id: input.generation.generationId,
        assistant_message_id: input.generation.assistantMessageId,
        status,
        content: input.content,
        write_id: input.writeId,
        ...(errorCode ? { error_code: errorCode } : {}),
      };
      await transaction.message.update({
        where: { id: input.generation.assistantMessageId },
        data: {
          content: input.content,
          status,
          errorCode,
          errorMessage: errorCode,
          lastActivityAt: new Date(),
        },
      });
      await transaction.generationRequest.update({
        where: { id: input.generation.generationId },
        data: {
          status,
          lastEventSeq: eventSeq,
          leaseExpiresAt: null,
        },
      });
      await transaction.generationEvent.create({
        data: {
          generationId: input.generation.generationId,
          eventSeq,
          eventType: status === 'failed' ? 'error' : status,
          payload,
        },
      });
    }),
  );

export const createGenerationWriter = (input: GenerationWriterInput) => {
  let content = '';
  let pendingDelta = '';
  let lastCheckpointAt = Date.now();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<string | null> | null = null;
  let flushError: unknown;

  const flush = (): Promise<string | null> => {
    if (flushPromise) return flushPromise;
    if (!pendingDelta) return Promise.resolve(null);
    const delta = pendingDelta;
    const checkpointContent = content;
    const writeId = randomUUID();
    flushPromise = (async () => {
      await persistCheckpoint({
        client: input.client,
        generation: input.generation,
        content: checkpointContent,
        delta,
        writeId,
      });
      pendingDelta = pendingDelta.slice(delta.length);
      lastCheckpointAt = Date.now();
      return delta;
    })().finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  };

  const scheduleFlush = () => {
    if (flushTimer || !pendingDelta) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flush().catch((error: unknown) => {
        flushError = error;
      });
    }, CHECKPOINT_INTERVAL_MS);
  };

  const flushAll = async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (flushError) throw flushError;
    let persistedDelta: string | null = null;
    while (pendingDelta || flushPromise) {
      const delta = await flush();
      if (persistedDelta === null && delta !== null) persistedDelta = delta;
      if (flushError) throw flushError;
    }
    return persistedDelta;
  };

  const append = async (text: string): Promise<string | null> => {
    if (flushError) throw flushError;
    content += text;
    pendingDelta += text;
    if (Date.now() - lastCheckpointAt < CHECKPOINT_INTERVAL_MS) {
      scheduleFlush();
      return null;
    }
    return flush();
  };

  const finish = async (
    status: GenerationTerminalStatus,
    errorCode: string | null,
  ): Promise<string | null> => {
    const delta = await flushAll();
    await persistTerminal({
      client: input.client,
      generation: input.generation,
      content,
      status,
      errorCode,
      writeId: randomUUID(),
    });
    return delta;
  };

  return {
    append,
    complete: () => finish('completed', null),
    fail: (code: string) => finish('failed', code),
    interrupt: () => finish('interrupted', null),
  };
};
