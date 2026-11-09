import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('failed generation retry', () => {
  let client: Client;
  let retryGeneration: (input: {
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
    ({ retryGeneration } = await import('@/lib/server/chat-retry'));
    client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
  });

  afterEach(async () => {
    await client.query('DELETE FROM generation_events');
    await client.query('DELETE FROM generation_requests');
    await client.query('DELETE FROM chats');
  });

  const createFailedConversation = async (status: 'failed' | 'interrupted') => {
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const generationId = randomUUID();
    await client.query('INSERT INTO chats (id) VALUES ($1)', [chatId]);
    await client.query(
      `INSERT INTO messages (id, chat_id, role, content, status, sequence_no, generation_id)
       VALUES ($1, $2, 'user', '질문', 'completed', 1, NULL),
              ($3, $2, 'assistant', '부분 답변', $4, 2, $5)`,
      [userMessageId, chatId, assistantMessageId, status, generationId],
    );
    await client.query(
      `INSERT INTO generation_requests
       (id, client_request_id, request_fingerprint, chat_id, user_message_id, assistant_message_id, operation, status)
       VALUES ($1, $2, 'old-fingerprint', $3, $4, $5, 'send', $6)`,
      [generationId, randomUUID(), chatId, userMessageId, assistantMessageId, status],
    );
    await client.query(
      `INSERT INTO generation_events (id, generation_id, event_seq, event_type, payload)
       VALUES ($1, $2, 1, 'delta', '{"text":"부분 답변"}')`,
      [randomUUID(), generationId],
    );
    return { chatId, userMessageId, assistantMessageId, generationId };
  };

  it('reuses the user, removes the failed branch, and creates a new generation', async () => {
    const fixture = await createFailedConversation('failed');
    const result = await retryGeneration({
      clientRequestId: randomUUID(),
      chatId: fixture.chatId,
      messageId: fixture.assistantMessageId,
    });

    const messages = await client.query<{ id: string; role: string; sequence_no: number }>(
      'SELECT id, role, sequence_no FROM messages WHERE chat_id = $1 ORDER BY sequence_no',
      [fixture.chatId],
    );
    const oldRequest = await client.query<{ assistant_message_id: string | null }>(
      'SELECT assistant_message_id FROM generation_requests WHERE id = $1',
      [fixture.generationId],
    );
    const events = await client.query('SELECT id FROM generation_events WHERE generation_id = $1', [
      fixture.generationId,
    ]);

    expect(result.isDuplicate).toBe(false);
    expect(messages.rows).toEqual([
      { id: fixture.userMessageId, role: 'user', sequence_no: 1 },
      { id: result.data.assistant_message_id, role: 'assistant', sequence_no: 2 },
    ]);
    expect(oldRequest.rows[0].assistant_message_id).toBeNull();
    expect(events.rows).toHaveLength(0);
  });

  it('supports interrupted retry idempotently and rejects completed messages', async () => {
    const fixture = await createFailedConversation('interrupted');
    const clientRequestId = randomUUID();
    const [first, duplicate] = await Promise.all([
      retryGeneration({
        clientRequestId,
        chatId: fixture.chatId,
        messageId: fixture.assistantMessageId,
      }),
      retryGeneration({
        clientRequestId,
        chatId: fixture.chatId,
        messageId: fixture.assistantMessageId,
      }),
    ]);
    expect([first.isDuplicate, duplicate.isDuplicate].sort()).toEqual([false, true]);

    await client.query("UPDATE messages SET status = 'completed' WHERE id = $1", [
      first.data.assistant_message_id,
    ]);
    await expect(
      retryGeneration({
        clientRequestId: randomUUID(),
        chatId: fixture.chatId,
        messageId: first.data.assistant_message_id,
      }),
    ).rejects.toMatchObject({ code: 'retry_not_allowed' });
  });
});
