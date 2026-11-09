import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma/client';
import {
  claimNextGeneration,
  processClaimedGeneration,
  recoverExpiredGenerations,
  readGenerationControl,
  renewGenerationLease,
  runGenerationWorker,
  UnresponsiveGenerationProcessorError,
  type ClaimedGeneration,
  type WorkerSettings,
} from '@/worker/generation-worker';

import { createPendingGeneration } from '../helpers/generation-fixture';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

const settings: WorkerSettings = {
  pollIntervalMs: 10,
  controlIntervalMs: 10,
  heartbeatIntervalMs: 25,
  leaseDurationMs: 250,
  generationTimeoutMs: 500,
  processorAbortGraceMs: 50,
};

suite('generation worker', () => {
  let client: PrismaClient;
  let otherClient: PrismaClient;
  const generationIds: string[] = [];
  const chatIds: string[] = [];

  const createPending = async () => {
    const pending = await createPendingGeneration(client);
    chatIds.push(pending.chatId);
    generationIds.push(pending.generationId);
    return pending;
  };

  beforeAll(async () => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
    });
    otherClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
    });
    await Promise.all([client.$connect(), otherClient.$connect()]);
  });

  afterAll(async () => {
    if (!client) return;
    await client.generationRequest.deleteMany({ where: { id: { in: generationIds } } });
    await client.chat.deleteMany({ where: { id: { in: chatIds } } });
    await Promise.all([client.$disconnect(), otherClient.$disconnect()]);
  });

  afterEach(async () => {
    await client.generationRequest.deleteMany({ where: { id: { in: generationIds } } });
    await client.chat.deleteMany({ where: { id: { in: chatIds } } });
    generationIds.length = 0;
    chatIds.length = 0;
  });

  it('atomically claims one request across two worker connections', async () => {
    const pending = await createPending();
    const firstWorkerId = randomUUID();
    const secondWorkerId = randomUUID();
    const claims = await Promise.all([
      claimNextGeneration(client, firstWorkerId),
      claimNextGeneration(otherClient, secondWorkerId),
    ]);
    const claimed = claims.filter((claim): claim is ClaimedGeneration => claim !== null);
    const request = await client.generationRequest.findUniqueOrThrow({
      where: { id: pending.generationId },
    });
    const message = await client.message.findUniqueOrThrow({
      where: { id: pending.assistantMessageId },
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.generationId).toBe(pending.generationId);
    expect(request.status).toBe('streaming');
    expect(request.workerId).toBe(claimed[0]?.workerId);
    expect(message.status).toBe('streaming');
  });

  it('renews only a live lease owned by the claiming worker', async () => {
    await createPending();
    const claimed = await claimNextGeneration(client, randomUUID(), 500);
    expect(claimed).not.toBeNull();
    if (!claimed) return;

    expect(await renewGenerationLease(client, claimed, 500)).toEqual({
      isOwned: true,
      isCancellationRequested: false,
    });
    expect(await renewGenerationLease(client, { ...claimed, workerId: randomUUID() }, 500)).toEqual(
      {
        isOwned: false,
        isCancellationRequested: false,
      },
    );
    await client.generationRequest.update({
      where: { id: claimed.generationId },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect(await readGenerationControl(client, claimed)).toEqual({
      isOwned: false,
      isCancellationRequested: false,
    });
    expect(await renewGenerationLease(client, claimed, 500)).toEqual({
      isOwned: false,
      isCancellationRequested: false,
    });
    await client.generationRequest.update({
      where: { id: claimed.generationId },
      data: { leaseExpiresAt: new Date(Date.now() + 500) },
    });
  });

  it('recovers expired streaming work without replaying the generation', async () => {
    const pending = await createPending();
    const claimed = await claimNextGeneration(
      client,
      randomUUID(),
      undefined,
      pending.generationId,
    );
    expect(claimed).not.toBeNull();
    if (!claimed) return;
    await client.message.update({
      where: { id: claimed.assistantMessageId },
      data: { content: '저장된 부분 응답' },
    });
    await client.generationRequest.update({
      where: { id: claimed.generationId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const untouched = await createPending();

    await expect(recoverExpiredGenerations(client)).resolves.toBe(1);

    const request = await client.generationRequest.findUniqueOrThrow({
      where: { id: claimed.generationId },
    });
    const message = await client.message.findUniqueOrThrow({
      where: { id: claimed.assistantMessageId },
    });
    const event = await client.generationEvent.findFirstOrThrow({
      where: { generationId: claimed.generationId },
    });
    expect(request).toMatchObject({
      status: 'failed',
      workerId: null,
      leaseExpiresAt: null,
      lastEventSeq: 1n,
    });
    expect(message).toMatchObject({
      content: '저장된 부분 응답',
      status: 'failed',
      errorCode: 'worker_lease_expired',
    });
    expect(event).toMatchObject({ eventSeq: 1n, eventType: 'error' });
    await expect(
      client.generationRequest.findUniqueOrThrow({ where: { id: untouched.generationId } }),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(recoverExpiredGenerations(client)).resolves.toBe(0);
    await client.generationRequest.delete({ where: { id: untouched.generationId } });
    await client.chat.delete({ where: { id: untouched.chatId } });
  });

  it('keeps a quiet processor alive with heartbeats', async () => {
    await createPending();
    const claimed = await claimNextGeneration(client, randomUUID(), settings.leaseDurationMs);
    expect(claimed).not.toBeNull();
    if (!claimed) return;
    const initialRequest = await client.generationRequest.findUniqueOrThrow({
      where: { id: claimed.generationId },
    });

    let wasAborted = false;
    await processClaimedGeneration({
      client,
      generation: claimed,
      shutdownSignal: new AbortController().signal,
      settings,
      processor: async (_generation, signal) => {
        await delay(110);
        wasAborted = signal.aborted;
      },
    });

    expect(wasAborted).toBe(false);
    expect((await readGenerationControl(client, claimed)).isOwned).toBe(true);
    const renewedRequest = await client.generationRequest.findUniqueOrThrow({
      where: { id: claimed.generationId },
    });
    expect(renewedRequest.leaseExpiresAt?.getTime()).toBeGreaterThan(
      initialRequest.leaseExpiresAt?.getTime() ?? 0,
    );
  });

  it('forwards cancellation, timeout, and shutdown signals', async () => {
    const abortReasons: unknown[] = [];
    const waitForAbort = async (_generation: ClaimedGeneration, signal: AbortSignal) => {
      abortReasons.push(
        await new Promise<unknown>((resolve) => {
          if (signal.aborted) resolve(signal.reason);
          else signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
        }),
      );
    };

    await createPending();
    const cancelled = await claimNextGeneration(client, randomUUID());
    expect(cancelled).not.toBeNull();
    if (!cancelled) return;
    const cancellation = processClaimedGeneration({
      client,
      generation: cancelled,
      shutdownSignal: new AbortController().signal,
      settings,
      processor: waitForAbort,
    });
    await client.generationRequest.update({
      where: { id: cancelled.generationId },
      data: { cancelRequestedAt: new Date() },
    });
    await cancellation;

    await createPending();
    const timedOut = await claimNextGeneration(client, randomUUID());
    expect(timedOut).not.toBeNull();
    if (!timedOut) return;
    await processClaimedGeneration({
      client,
      generation: timedOut,
      shutdownSignal: new AbortController().signal,
      settings: { ...settings, generationTimeoutMs: 30 },
      processor: waitForAbort,
    });

    await createPending();
    const stopped = await claimNextGeneration(client, randomUUID());
    expect(stopped).not.toBeNull();
    if (!stopped) return;
    const shutdown = new AbortController();
    const processing = processClaimedGeneration({
      client,
      generation: stopped,
      shutdownSignal: shutdown.signal,
      settings,
      processor: waitForAbort,
    });
    shutdown.abort();
    await processing;

    expect(abortReasons).toEqual(['cancel', 'timeout', 'shutdown']);
  });

  it('reports processor errors and stops claiming more work', async () => {
    const pending = await createPending();
    const error = new Error('Fake processor failed');
    const reportedErrors: unknown[] = [];
    const running = runGenerationWorker({
      client,
      signal: new AbortController().signal,
      settings,
      processor: async () => {
        throw error;
      },
      onError: (reportedError) => reportedErrors.push(reportedError),
    });

    await expect(running).rejects.toBe(error);
    expect(reportedErrors).toEqual([error]);
    expect(
      (await client.generationRequest.findUniqueOrThrow({ where: { id: pending.generationId } }))
        .status,
    ).toBe('streaming');
  });

  it('stops waiting after an unresponsive processor times out', async () => {
    await createPending();
    const claimed = await claimNextGeneration(client, randomUUID());
    expect(claimed).not.toBeNull();
    if (!claimed) return;

    await expect(
      processClaimedGeneration({
        client,
        generation: claimed,
        shutdownSignal: new AbortController().signal,
        settings: { ...settings, generationTimeoutMs: 20 },
        processor: async () => new Promise<void>(() => {}),
      }),
    ).rejects.toBeInstanceOf(UnresponsiveGenerationProcessorError);
  });

  it('leaves pending jobs untouched until a processor is connected', async () => {
    const pending = await createPending();
    const shutdown = new AbortController();
    const running = runGenerationWorker({
      client,
      signal: shutdown.signal,
      settings,
      onError: () => {},
    });
    await delay(30);
    shutdown.abort();
    await running;

    expect(
      (await client.generationRequest.findUniqueOrThrow({ where: { id: pending.generationId } }))
        .status,
    ).toBe('pending');
    await client.generationRequest.delete({ where: { id: pending.generationId } });
  });

  it('stops an active fake processor before shutting down', async () => {
    const pending = await createPending();
    const shutdown = new AbortController();
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let abortReason: unknown;
    const running = runGenerationWorker({
      client,
      signal: shutdown.signal,
      settings,
      onError: (error) => {
        throw error;
      },
      processor: async (generation, signal) => {
        expect(generation.generationId).toBe(pending.generationId);
        notifyStarted?.();
        abortReason = await new Promise<unknown>((resolve) => {
          signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
        });
      },
    });
    await started;
    shutdown.abort();
    await running;

    expect(abortReason).toBe('shutdown');
  });

  it('reports an unresponsive processor during shutdown', async () => {
    const pending = await createPending();
    const shutdown = new AbortController();
    const reportedErrors: unknown[] = [];
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const running = runGenerationWorker({
      client,
      signal: shutdown.signal,
      settings,
      processor: async (generation) => {
        expect(generation.generationId).toBe(pending.generationId);
        notifyStarted?.();
        return new Promise<void>(() => {});
      },
      onError: (error) => reportedErrors.push(error),
    });

    await started;
    shutdown.abort();
    await expect(running).rejects.toBeInstanceOf(UnresponsiveGenerationProcessorError);
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]).toBeInstanceOf(UnresponsiveGenerationProcessorError);
  });

  it('keeps the standalone worker alive until SIGTERM', async () => {
    const child = spawn('node_modules/.bin/tsx', ['src/worker/index.ts'], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl, OPENROUTER_API_KEY: 'test-key' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker did not start')), 5_000);
      child.stdout.on('data', (chunk: Buffer) => {
        if (!String(chunk).includes('Worker ready')) return;
        clearTimeout(timeout);
        resolve();
      });
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Worker exited before shutdown'));
      });
    });

    try {
      await ready;
      await delay(100);
      expect(child.exitCode).toBeNull();
      child.kill('SIGTERM');
      const exitCode = await new Promise<number | null>((resolve) => {
        child.once('exit', resolve);
      });
      expect(exitCode).toBe(0);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
