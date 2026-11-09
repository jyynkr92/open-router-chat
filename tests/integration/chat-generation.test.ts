import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('chat generation registration', () => {
  let client: Client;
  let createGeneration: (input: {
    clientRequestId: string;
    chatId: string | null;
    content: string;
  }) => Promise<{
    data: {
      chat_id: string;
      user_message_id: string;
      assistant_message_id: string;
      generation_id: string;
      status: string;
    };
    isDuplicate: boolean;
  }>;
  let postGeneration: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ createGeneration } = await import('@/lib/server/chat-generation'));
    ({ POST: postGeneration } = await import('@/app/api/chat/generations/route'));
    client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('DELETE FROM generation_requests');
    await client.query('DELETE FROM chats');
    await client.end();
  });

  it('atomically creates a new chat, messages, and generation request', async () => {
    const result = await createGeneration({
      clientRequestId: randomUUID(),
      chatId: null,
      content: '첫 질문',
    });
    const counts = await client.query<{ chats: string; messages: string; requests: string }>(
      `SELECT
        (SELECT count(*) FROM chats WHERE id = $1) AS chats,
        (SELECT count(*) FROM messages WHERE chat_id = $1) AS messages,
        (SELECT count(*) FROM generation_requests WHERE id = $2) AS requests`,
      [result.data.chat_id, result.data.generation_id],
    );
    const rows = await client.query<{ role: string; status: string; sequence_no: number }>(
      'SELECT role, status, sequence_no FROM messages WHERE chat_id = $1 ORDER BY sequence_no',
      [result.data.chat_id],
    );

    expect(result.isDuplicate).toBe(false);
    expect(counts.rows[0]).toEqual({ chats: '1', messages: '2', requests: '1' });
    expect(rows.rows).toEqual([
      { role: 'user', status: 'completed', sequence_no: 1 },
      { role: 'assistant', status: 'pending', sequence_no: 2 },
    ]);
  });

  it('returns the existing request for an idempotent retry and rejects a changed payload', async () => {
    const clientRequestId = randomUUID();
    const input = { clientRequestId, chatId: null, content: '같은 요청' };
    const first = await createGeneration(input);
    const duplicate = await createGeneration(input);

    expect(duplicate).toEqual({ data: first.data, isDuplicate: true });
    await expect(createGeneration({ ...input, content: '바뀐 요청' })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });

  it('rejects a second generation and allows only one concurrent registration per chat', async () => {
    const first = await createGeneration({
      clientRequestId: randomUUID(),
      chatId: null,
      content: '진행 중인 요청',
    });
    await expect(
      createGeneration({
        clientRequestId: randomUUID(),
        chatId: first.data.chat_id,
        content: '두 번째 요청',
      }),
    ).rejects.toMatchObject({ code: 'generation_in_progress' });

    const concurrentChatId = randomUUID();
    await client.query('INSERT INTO chats (id) VALUES ($1)', [concurrentChatId]);
    const results = await Promise.allSettled([
      createGeneration({
        clientRequestId: randomUUID(),
        chatId: concurrentChatId,
        content: '동시 요청 A',
      }),
      createGeneration({
        clientRequestId: randomUUID(),
        chatId: concurrentChatId,
        content: '동시 요청 B',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason.code).toBe(
      'generation_in_progress',
    );
  });

  it('returns gone for an idempotent retry after the chat was deleted', async () => {
    const clientRequestId = randomUUID();
    const result = await createGeneration({
      clientRequestId,
      chatId: null,
      content: '삭제 대상',
    });
    await client.query('DELETE FROM chats WHERE id = $1', [result.data.chat_id]);

    await expect(
      createGeneration({ clientRequestId, chatId: null, content: '삭제 대상' }),
    ).rejects.toMatchObject({ code: 'deleted_request' });
  });

  it('rejects empty and overlong content before accessing the database', async () => {
    const request = (content: string) =>
      new Request('http://localhost/api/chat/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_request_id: randomUUID(), chat_id: null, content }),
      });

    expect((await postGeneration(request('   '))).status).toBe(400);
    expect((await postGeneration(request('a'.repeat(20_001)))).status).toBe(400);
  });
});
