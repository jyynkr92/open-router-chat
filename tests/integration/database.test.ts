import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite('PostgreSQL migration invariants', () => {
  let client: Client;
  let chatId: string;
  beforeEach(async () => {
    client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
    await client.query('BEGIN');
    chatId = randomUUID();
    await client.query('INSERT INTO chats (id) VALUES ($1)', [chatId]);
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('rejects a second active assistant in the same chat', async () => {
    await client.query(
      'INSERT INTO messages (id, chat_id, role, sequence_no) VALUES ($1,$2,$3,$4)',
      [randomUUID(), chatId, 'assistant', 1],
    );
    await expect(
      client.query('INSERT INTO messages (id, chat_id, role, sequence_no) VALUES ($1,$2,$3,$4)', [
        randomUUID(),
        chatId,
        'assistant',
        2,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('rejects unsaved user message states', async () => {
    await expect(
      client.query('INSERT INTO messages (id, chat_id, role, sequence_no) VALUES ($1,$2,$3,$4)', [
        randomUUID(),
        chatId,
        'user',
        1,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('preserves idempotency records while clearing deleted chat references', async () => {
    const requestId = randomUUID();
    await client.query(
      'INSERT INTO generation_requests (id, client_request_id, request_fingerprint, chat_id, operation) VALUES ($1,$2,$3,$4,$5)',
      [requestId, randomUUID(), 'test-hash', chatId, 'send'],
    );
    await client.query('DELETE FROM chats WHERE id = $1', [chatId]);
    const result = await client.query<{ chat_id: string | null }>(
      'SELECT chat_id FROM generation_requests WHERE id = $1',
      [requestId],
    );
    expect(result.rows[0].chat_id).toBeNull();
  });
});
