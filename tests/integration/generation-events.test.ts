import { setTimeout as delay } from 'node:timers/promises';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@/generated/prisma/client';
import type { GenerationRouteContext } from '@/types/chat/generation-events';

import { createClaimedGeneration } from '../helpers/generation-fixture';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('generation event APIs', () => {
  let client: PrismaClient;
  let getSnapshot: (request: Request, context: GenerationRouteContext) => Promise<Response>;
  let getEvents: (request: Request, context: GenerationRouteContext) => Promise<Response>;
  let createGenerationWriter: typeof import('@/worker/generation-persistence')['createGenerationWriter'];
  const generationIds: string[] = [];
  const chatIds: string[] = [];

  const createTestGeneration = async () => {
    const generation = await createClaimedGeneration(client);
    generationIds.push(generation.generationId);
    chatIds.push(generation.chatId);
    return generation;
  };

  const routeContext = (generationId: string) => ({
    params: Promise.resolve({ 'generation-id': generationId }),
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ GET: getSnapshot } = await import('@/app/api/generations/[generation-id]/route'));
    ({ GET: getEvents } = await import('@/app/api/generations/[generation-id]/events/route'));
    ({ createGenerationWriter } = await import('@/worker/generation-persistence'));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
    await client.$connect();
  });

  afterAll(async () => {
    if (!client) return;
    await client.generationRequest.deleteMany({ where: { id: { in: generationIds } } });
    await client.chat.deleteMany({ where: { id: { in: chatIds } } });
    await client.$disconnect();
  });

  it('returns a consistent completed snapshot', async () => {
    const generation = await createTestGeneration();
    const writer = createGenerationWriter({ client, generation });
    await writer.append('완료 응답');
    await writer.complete();

    const response = await getSnapshot(
      new Request(`http://localhost/api/generations/${generation.generationId}`),
      routeContext(generation.generationId),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        generation_id: generation.generationId,
        assistant_message_id: generation.assistantMessageId,
        content: '완료 응답',
        status: 'completed',
        last_event_seq: '2',
      },
    });
  });

  it('replays ordered events and hides internal payload fields', async () => {
    const generation = await createTestGeneration();
    const writer = createGenerationWriter({ client, generation });
    await writer.append('재생 응답');
    await writer.complete();

    const response = await getEvents(
      new Request(`http://localhost/api/generations/${generation.generationId}/events`),
      routeContext(generation.generationId),
    );
    const body = await response.text();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('id: 1\nevent: delta');
    expect(body).toContain('id: 2\nevent: completed');
    expect(body).toContain('"text":"재생 응답"');
    expect(body).not.toContain('write_id');
  });

  it('streams events written after the subscription starts', async () => {
    const generation = await createTestGeneration();
    const writer = createGenerationWriter({ client, generation });
    const response = await getEvents(
      new Request(
        `http://localhost/api/generations/${generation.generationId}/events?after_event_seq=0`,
      ),
      routeContext(generation.generationId),
    );
    const bodyPromise = response.text();
    await delay(20);
    await writer.append('실시간 응답');
    await writer.complete();

    const body = await bodyPromise;
    expect(body).toContain('event: delta');
    expect(body).toContain('event: completed');
  });

  it('rejects invalid and ahead cursors', async () => {
    const generation = await createTestGeneration();
    const invalid = await getEvents(
      new Request(
        `http://localhost/api/generations/${generation.generationId}/events?after_event_seq=-1`,
      ),
      routeContext(generation.generationId),
    );
    expect(invalid.status).toBe(400);

    const ahead = await getEvents(
      new Request(
        `http://localhost/api/generations/${generation.generationId}/events?after_event_seq=1`,
      ),
      routeContext(generation.generationId),
    );
    expect(ahead.status).toBe(400);
  });

  it('returns gone after the referenced chat is deleted', async () => {
    const generation = await createTestGeneration();
    await client.chat.delete({ where: { id: generation.chatId } });

    const snapshot = await getSnapshot(
      new Request(`http://localhost/api/generations/${generation.generationId}`),
      routeContext(generation.generationId),
    );
    const events = await getEvents(
      new Request(`http://localhost/api/generations/${generation.generationId}/events`),
      routeContext(generation.generationId),
    );
    expect(snapshot.status).toBe(410);
    expect(events.status).toBe(410);
  });
});
