import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
const fixtureTest = databaseUrl ? test : test.skip;

fixtureTest(
  'lists chats with a stable cursor and reads an isolated generation snapshot',
  async ({ request, page, context }) => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const chatIds = Array.from({ length: 31 }, () => randomUUID()).sort();
    const userId = randomUUID();
    const assistantId = randomUUID();
    const requestId = randomUUID();
    try {
      const empty = await request.get('/api/chats');
      expect((await empty.json()).data).toEqual({ items: [], next_cursor: null });
      for (let index = 0; index < chatIds.length; index += 1) {
        const updatedAt =
          index < 29
            ? '2026-01-01T00:00:00.000900Z'
            : index === 29
              ? '2026-01-01T00:00:00.000500Z'
              : '2026-01-01T00:00:00.000400Z';
        await client.query('INSERT INTO chats (id, title, updated_at) VALUES ($1, $2, $3)', [
          chatIds[index],
          `기록 ${index + 1}`,
          updatedAt,
        ]);
      }
      await client.query(
        'INSERT INTO messages (id, chat_id, role, content, status, sequence_no) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, chatIds[0], 'user', 'fixture 질문', 'completed', 1],
      );
      await client.query(
        'INSERT INTO messages (id, chat_id, role, content, status, sequence_no, generation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [assistantId, chatIds[0], 'assistant', '저장된 답변', 'streaming', 2, requestId],
      );
      await client.query(
        'INSERT INTO generation_requests (id, client_request_id, request_fingerprint, chat_id, user_message_id, assistant_message_id, operation, status, last_event_seq) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          requestId,
          randomUUID(),
          'fixture-hash',
          chatIds[0],
          userId,
          assistantId,
          'send',
          'streaming',
          3,
        ],
      );
      for (const [index, text] of ['저', '장된 ', '답변'].entries()) {
        await client.query(
          'INSERT INTO generation_events (id, generation_id, event_seq, event_type, payload) VALUES ($1,$2,$3,$4,$5)',
          [randomUUID(), requestId, index + 1, 'delta', { text }],
        );
      }
      await client.query(
        'INSERT INTO messages (id, chat_id, role, content, status, sequence_no) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), chatIds[1], 'user', '**다른 채팅**', 'completed', 1],
      );
      await client.query(
        'INSERT INTO messages (id, chat_id, role, content, status, sequence_no) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), chatIds[1], 'assistant', '**굵게** 답변', 'completed', 2],
      );

      const first = await request.get('/api/chats');
      expect(first.status()).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.data.items).toHaveLength(30);
      expect(firstBody.data.items.map((item: { id: string }) => item.id)).toEqual(
        chatIds.slice(0, 30),
      );
      const cursor = JSON.parse(Buffer.from(firstBody.data.next_cursor, 'base64url').toString());
      expect(cursor.updated_at).toBe('2026-01-01T00:00:00.000500Z');
      const second = await request.get(
        `/api/chats?cursor=${encodeURIComponent(firstBody.data.next_cursor)}`,
      );
      expect((await second.json()).data.items.map((item: { id: string }) => item.id)).toEqual([
        chatIds[30],
      ]);
      expect((await second.json()).data.next_cursor).toBeNull();
      expect((await request.get('/api/chats?cursor=bad')).status()).toBe(400);

      const detail = await request.get(`/api/chats/${chatIds[0]}/messages`);
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      expect(
        body.data.messages.map((message: { sequence_no: number }) => message.sequence_no),
      ).toEqual([1, 2]);
      expect(body.data.messages[0].content).toBe('fixture 질문');
      expect(body.data.messages[1].content).toBe('저장된 답변');
      expect(body.data.active_generation).toMatchObject({
        generation_id: requestId,
        assistant_message_id: assistantId,
        content: '저장된 답변',
        last_event_seq: '3',
      });
      const events = await client.query<{ content: string; last_seq: string }>(
        "SELECT string_agg(payload->>'text', '' ORDER BY event_seq) AS content, max(event_seq)::text AS last_seq FROM generation_events WHERE generation_id = $1",
        [requestId],
      );
      expect(body.data.active_generation.content).toBe(events.rows[0].content);
      expect(body.data.active_generation.last_event_seq).toBe(events.rows[0].last_seq);
      expect((await request.get(`/api/chats/${randomUUID()}/messages`)).status()).toBe(404);
      expect(
        (await request.get(`/api/chats/${chatIds[1]}/messages`).then((response) => response.json()))
          .data.messages,
      ).toHaveLength(2);

      await page.route(`**/api/chats/${chatIds[0]}/messages`, (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":{"code":"storage_error"}}',
        }),
      );
      await page.goto('/');
      await page.getByRole('button', { name: '기록 1', exact: true }).click();
      await expect(page.getByText('메시지를 불러오지 못했어요')).toBeVisible();
      await page.unroute(`**/api/chats/${chatIds[0]}/messages`);
      await page.getByRole('button', { name: '다시 불러오기' }).click();
      await expect(page.getByText('저장된 답변')).toBeVisible();
      await expect(page.getByText('**다른 채팅**')).not.toBeVisible();
      await expect(page.getByRole('button', { name: '응답 중단' })).toBeInViewport();
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: '기록 2', exact: true }).click();
      await expect(page.getByText('**다른 채팅**')).toBeVisible();
      await expect(page.locator('strong').getByText('굵게')).toBeVisible();
      await page.getByRole('button', { name: '복사' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('**굵게** 답변');
      await page.screenshot({ path: 'test-results/chat-read.png', fullPage: true });
    } finally {
      await client.query('DELETE FROM generation_requests WHERE id = $1', [requestId]);
      await client.query('DELETE FROM chats WHERE id = ANY($1::uuid[])', [chatIds]);
      await client.end();
    }
  },
);
