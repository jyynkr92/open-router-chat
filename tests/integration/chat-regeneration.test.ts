import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('assistant regeneration', () => {
  let client: Client;
  let regenerateGeneration: (input: {
    clientRequestId: string;
    chatId: string;
    messageId: string;
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

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ regenerateGeneration } = await import('@/lib/server/chat-regeneration'));
    client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
  });

  afterEach(async () => {
    await client.query('DELETE FROM generation_events');
    await client.query('DELETE FROM generation_requests');
    await client.query('DELETE FROM chats');
  });

  const createConversation = async () => {
    const chatId = randomUUID();
    const firstUserId = randomUUID();
    const firstAssistantId = randomUUID();
    const firstGenerationId = randomUUID();
    const secondUserId = randomUUID();
    const secondAssistantId = randomUUID();
    const secondGenerationId = randomUUID();
    await client.query('INSERT INTO chats (id) VALUES ($1)', [chatId]);
    await client.query(
      "UPDATE chats SET title = '보존할 이름', title_source = 'manual' WHERE id = $1",
      [chatId],
    );
    await client.query(
      `INSERT INTO messages (id, chat_id, role, content, status, sequence_no, generation_id)
       VALUES
         ($1, $7, 'user', '첫 질문', 'completed', 1, NULL),
         ($2, $7, 'assistant', '첫 답변', 'completed', 2, $3),
         ($4, $7, 'user', '두 번째 질문', 'completed', 3, NULL),
         ($5, $7, 'assistant', '두 번째 답변', 'completed', 4, $6)`,
      [
        firstUserId,
        firstAssistantId,
        firstGenerationId,
        secondUserId,
        secondAssistantId,
        secondGenerationId,
        chatId,
      ],
    );
    await client.query(
      `INSERT INTO generation_requests
       (id, client_request_id, request_fingerprint, chat_id, user_message_id, assistant_message_id, operation, status)
       VALUES
         ($1, $2, 'first', $7, $3, $4, 'send', 'completed'),
         ($5, $6, 'second', $7, $8, $9, 'send', 'completed')`,
      [
        firstGenerationId,
        randomUUID(),
        firstUserId,
        firstAssistantId,
        secondGenerationId,
        randomUUID(),
        chatId,
        secondUserId,
        secondAssistantId,
      ],
    );
    await client.query(
      `INSERT INTO generation_events (id, generation_id, event_seq, event_type, payload)
       VALUES ($1, $2, 1, 'completed', '{"content":"답변"}')`,
      [randomUUID(), firstGenerationId],
    );
    return {
      chatId,
      firstUserId,
      firstAssistantId,
      firstGenerationId,
      secondAssistantId,
      secondGenerationId,
    };
  };

  it('removes a middle answer and all later records while preserving the prior user context', async () => {
    const fixture = await createConversation();
    const result = await regenerateGeneration({
      clientRequestId: randomUUID(),
      chatId: fixture.chatId,
      messageId: fixture.firstAssistantId,
    });

    const messages = await client.query<{ id: string; role: string; sequence_no: number }>(
      'SELECT id, role, sequence_no FROM messages WHERE chat_id = $1 ORDER BY sequence_no',
      [fixture.chatId],
    );
    const chat = await client.query<{ title: string; title_source: string }>(
      'SELECT title, title_source FROM chats WHERE id = $1',
      [fixture.chatId],
    );
    const oldRequest = await client.query<{
      assistant_message_id: string | null;
      operation: string;
    }>('SELECT assistant_message_id, operation FROM generation_requests WHERE id = $1', [
      fixture.firstGenerationId,
    ]);
    const secondRequest = await client.query('SELECT id FROM generation_requests WHERE id = $1', [
      fixture.secondGenerationId,
    ]);
    const events = await client.query('SELECT id FROM generation_events WHERE generation_id = $1', [
      fixture.firstGenerationId,
    ]);

    expect(result.isDuplicate).toBe(false);
    expect(result.data.status).toBe('pending');
    expect(chat.rows[0]).toEqual({ title: '보존할 이름', title_source: 'manual' });
    expect(messages.rows).toEqual([
      { id: fixture.firstUserId, role: 'user', sequence_no: 1 },
      { id: result.data.assistant_message_id, role: 'assistant', sequence_no: 2 },
    ]);
    expect(oldRequest.rows[0].assistant_message_id).toBeNull();
    expect(oldRequest.rows[0].operation).toBe('send');
    expect(secondRequest.rows).toHaveLength(1);
    expect(events.rows).toHaveLength(0);
  });

  it('regenerates the last answer idempotently and rejects a concurrent generation', async () => {
    const fixture = await createConversation();
    const clientRequestId = randomUUID();
    const activeGenerationId = randomUUID();
    await client.query(
      `INSERT INTO generation_requests
       (id, client_request_id, request_fingerprint, chat_id, operation, status)
       VALUES ($1, $2, 'active', $3, 'send', 'pending')`,
      [activeGenerationId, randomUUID(), fixture.chatId],
    );
    await expect(
      regenerateGeneration({
        clientRequestId: randomUUID(),
        chatId: fixture.chatId,
        messageId: fixture.secondAssistantId,
      }),
    ).rejects.toMatchObject({ code: 'generation_in_progress' });
    await client.query('DELETE FROM generation_requests WHERE id = $1', [activeGenerationId]);

    const [first, duplicate] = await Promise.all([
      regenerateGeneration({
        clientRequestId,
        chatId: fixture.chatId,
        messageId: fixture.secondAssistantId,
      }),
      regenerateGeneration({
        clientRequestId,
        chatId: fixture.chatId,
        messageId: fixture.secondAssistantId,
      }),
    ]);
    expect([first.isDuplicate, duplicate.isDuplicate].sort()).toEqual([false, true]);
  });
});
