import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { PrismaClient } from '../generated/prisma/client';

export type ClaimedGeneration = {
  generationId: string;
  chatId: string;
  assistantMessageId: string;
  workerId: string;
};

export type GenerationProcessor = (
  generation: ClaimedGeneration,
  signal: AbortSignal,
) => Promise<void>;

export type WorkerSettings = {
  pollIntervalMs: number;
  controlIntervalMs: number;
  heartbeatIntervalMs: number;
  leaseDurationMs: number;
  generationTimeoutMs: number;
  processorAbortGraceMs: number;
};

export const defaultWorkerSettings: WorkerSettings = {
  pollIntervalMs: 500,
  controlIntervalMs: 500,
  heartbeatIntervalMs: 10_000,
  leaseDurationMs: 60_000,
  generationTimeoutMs: 120_000,
  processorAbortGraceMs: 5_000,
};

const MAX_RECOVERY_BATCH_SIZE = 100;

export class UnresponsiveGenerationProcessorError extends Error {
  constructor() {
    super('Generation processor did not stop after cancellation');
    this.name = 'UnresponsiveGenerationProcessorError';
  }
}

type ClaimRow = {
  id: string;
  chat_id: string;
  assistant_message_id: string;
};

type ExpiredGenerationRow = {
  id: string;
  assistant_message_id: string | null;
  content: string | null;
  last_event_seq: bigint;
  cancel_requested_at: Date | null;
};

type ControlState = {
  isOwned: boolean;
  isCancellationRequested: boolean;
};

export const claimNextGeneration = async (
  client: PrismaClient,
  workerId: string,
  leaseDurationMs: number = defaultWorkerSettings.leaseDurationMs,
  generationId?: string,
): Promise<ClaimedGeneration | null> =>
  client.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<ClaimRow[]>`
      WITH candidate AS (
        SELECT id
        FROM generation_requests
        WHERE status = 'pending'
          AND worker_id IS NULL
          AND cancel_requested_at IS NULL
          AND chat_id IS NOT NULL
          AND assistant_message_id IS NOT NULL
          AND (${generationId ?? null}::uuid IS NULL OR id = ${generationId ?? null}::uuid)
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE generation_requests AS request
      SET status = 'streaming',
          worker_id = ${workerId}::uuid,
          lease_expires_at = now() + ${leaseDurationMs} * interval '1 millisecond',
          updated_at = now()
      FROM candidate
      WHERE request.id = candidate.id
      RETURNING request.id, request.chat_id, request.assistant_message_id
    `;
    const row = rows[0];
    if (!row) return null;

    const updated = await transaction.message.updateMany({
      where: {
        id: row.assistant_message_id,
        chatId: row.chat_id,
        role: 'assistant',
        status: 'pending',
        generationId: row.id,
      },
      data: { status: 'streaming', lastActivityAt: new Date() },
    });
    if (updated.count !== 1) throw new Error('Generation message is not claimable');

    return {
      generationId: row.id,
      chatId: row.chat_id,
      assistantMessageId: row.assistant_message_id,
      workerId,
    };
  });

export const renewGenerationLease = async (
  client: PrismaClient,
  generation: ClaimedGeneration,
  leaseDurationMs: number = defaultWorkerSettings.leaseDurationMs,
): Promise<ControlState> => {
  const rows = await client.$queryRaw<{ cancel_requested_at: Date | null }[]>`
    UPDATE generation_requests
    SET lease_expires_at = now() + ${leaseDurationMs} * interval '1 millisecond',
        updated_at = now()
    WHERE id = ${generation.generationId}::uuid
      AND worker_id = ${generation.workerId}::uuid
      AND status = 'streaming'
      AND lease_expires_at > now()
    RETURNING cancel_requested_at
  `;
  return {
    isOwned: rows.length === 1,
    isCancellationRequested: rows[0]?.cancel_requested_at !== null && rows.length === 1,
  };
};

export const readGenerationControl = async (
  client: PrismaClient,
  generation: ClaimedGeneration,
): Promise<ControlState> => {
  const rows = await client.$queryRaw<{ is_owned: boolean; cancel_requested_at: Date | null }[]>`
    SELECT worker_id = ${generation.workerId}::uuid
        AND status = 'streaming'
        AND lease_expires_at > now() AS is_owned,
      cancel_requested_at
    FROM generation_requests
    WHERE id = ${generation.generationId}::uuid
  `;
  return {
    isOwned: rows[0]?.is_owned ?? false,
    isCancellationRequested: rows[0]?.cancel_requested_at !== null && rows.length === 1,
  };
};

export const recoverExpiredGenerations = async (client: PrismaClient): Promise<number> =>
  client.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<ExpiredGenerationRow[]>`
      SELECT request.id,
             request.assistant_message_id,
             message.content,
             request.last_event_seq,
             request.cancel_requested_at
      FROM generation_requests AS request
      LEFT JOIN messages AS message ON message.id = request.assistant_message_id
      WHERE request.status = 'streaming'
        AND request.lease_expires_at IS NOT NULL
        AND request.lease_expires_at <= now()
      ORDER BY request.lease_expires_at, request.id
      LIMIT ${MAX_RECOVERY_BATCH_SIZE}
      FOR UPDATE OF request SKIP LOCKED
    `;

    for (const row of rows) {
      const status = row.cancel_requested_at ? 'interrupted' : 'failed';
      const errorCode = status === 'failed' ? 'worker_lease_expired' : null;
      const eventSeq = row.last_event_seq + 1n;
      if (row.assistant_message_id) {
        await transaction.message.update({
          where: { id: row.assistant_message_id },
          data: {
            status,
            errorCode,
            errorMessage: errorCode,
            lastActivityAt: new Date(),
          },
        });
      }
      await transaction.generationRequest.update({
        where: { id: row.id },
        data: {
          status,
          workerId: null,
          leaseExpiresAt: null,
          lastEventSeq: eventSeq,
        },
      });
      if (row.assistant_message_id) {
        await transaction.generationEvent.create({
          data: {
            generationId: row.id,
            eventSeq,
            eventType: status === 'failed' ? 'error' : status,
            payload: {
              generation_id: row.id,
              assistant_message_id: row.assistant_message_id,
              status,
              content: row.content ?? '',
              ...(errorCode ? { error_code: errorCode } : {}),
            },
          },
        });
      }
    }
    return rows.length;
  });

export const processClaimedGeneration = async (input: {
  client: PrismaClient;
  generation: ClaimedGeneration;
  processor: GenerationProcessor;
  shutdownSignal: AbortSignal;
  settings?: WorkerSettings;
}): Promise<void> => {
  const settings = input.settings ?? defaultWorkerSettings;
  const controller = new AbortController();
  const monitorController = new AbortController();
  const handleShutdown = () => controller.abort('shutdown');
  input.shutdownSignal.addEventListener('abort', handleShutdown, { once: true });
  if (input.shutdownSignal.aborted) handleShutdown();

  const timeout = setTimeout(() => controller.abort('timeout'), settings.generationTimeoutMs);
  let nextHeartbeatAt = Date.now() + settings.heartbeatIntervalMs;
  const monitor = async () => {
    while (!monitorController.signal.aborted && !controller.signal.aborted) {
      try {
        await delay(settings.controlIntervalMs, undefined, {
          signal: monitorController.signal,
        });
      } catch {
        return;
      }
      if (monitorController.signal.aborted || controller.signal.aborted) return;

      try {
        const shouldHeartbeat = Date.now() >= nextHeartbeatAt;
        const control = shouldHeartbeat
          ? await renewGenerationLease(input.client, input.generation, settings.leaseDurationMs)
          : await readGenerationControl(input.client, input.generation);
        if (shouldHeartbeat) nextHeartbeatAt = Date.now() + settings.heartbeatIntervalMs;
        if (!control.isOwned) controller.abort('lost_lease');
        else if (control.isCancellationRequested) controller.abort('cancel');
      } catch {
        controller.abort('storage_error');
      }
    }
  };
  const monitorPromise = monitor();
  let abortDeadline: ReturnType<typeof setTimeout> | undefined;
  const { promise: abortedProcessor, reject: rejectAbortDeadline } = Promise.withResolvers<never>();
  const handleProcessorAbort = () => {
    abortDeadline = setTimeout(
      () => rejectAbortDeadline(new UnresponsiveGenerationProcessorError()),
      settings.processorAbortGraceMs,
    );
  };
  controller.signal.addEventListener('abort', handleProcessorAbort, { once: true });
  if (controller.signal.aborted) handleProcessorAbort();

  try {
    await Promise.race([input.processor(input.generation, controller.signal), abortedProcessor]);
  } finally {
    clearTimeout(abortDeadline);
    clearTimeout(timeout);
    monitorController.abort();
    controller.signal.removeEventListener('abort', handleProcessorAbort);
    input.shutdownSignal.removeEventListener('abort', handleShutdown);
    await monitorPromise;
  }
};

export const runGenerationWorker = async (input: {
  client: PrismaClient;
  processor?: GenerationProcessor;
  signal: AbortSignal;
  settings?: WorkerSettings;
  onError: (error: unknown) => void;
}): Promise<void> => {
  if (!input.processor) {
    while (!input.signal.aborted) {
      try {
        await recoverExpiredGenerations(input.client);
        await delay(30_000, undefined, { signal: input.signal });
      } catch (error) {
        if (input.signal.aborted) return;
        input.onError(error);
        try {
          await delay(30_000, undefined, { signal: input.signal });
        } catch {
          return;
        }
      }
      if (input.signal.aborted) return;
    }
    return;
  }

  const settings = input.settings ?? defaultWorkerSettings;
  const workerId = randomUUID();
  while (!input.signal.aborted) {
    let generation: ClaimedGeneration | null = null;
    try {
      await recoverExpiredGenerations(input.client);
      generation = await claimNextGeneration(input.client, workerId, settings.leaseDurationMs);
      if (generation) {
        await processClaimedGeneration({
          client: input.client,
          generation,
          processor: input.processor,
          shutdownSignal: input.signal,
          settings,
        });
        continue;
      }
    } catch (error) {
      input.onError(error);
      if (generation) throw error;
    }

    try {
      await delay(settings.pollIntervalMs, undefined, { signal: input.signal });
    } catch {
      return;
    }
  }
};
