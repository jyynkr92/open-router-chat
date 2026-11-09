import { expect, test } from '@playwright/test';

test('edits a chat title with keyboard save and keeps the updated name', async ({ page }) => {
  const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let title = '새 채팅';
  const chat = {
    id: chatId,
    title_source: 'default',
    title_status: 'idle',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: [{ ...chat, title }], next_cursor: null } }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat: { ...chat, title },
          messages: [],
          active_generation: null,
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatId}`, async (route) => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({ title: '내 대화' });
    title = '내 대화';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: { chat_id: chatId, title, title_source: 'manual', title_status: 'idle' },
      }),
    });
  });

  await page.goto('/');
  const chatList = page.locator('nav[aria-label="채팅 목록"]');
  await chatList.getByRole('button', { name: '새 채팅', exact: true }).click();
  await chatList.getByRole('button', { name: '채팅 메뉴' }).click();
  const editItem = page.getByRole('menuitem', { name: '채팅 이름 수정' });
  await expect(editItem).toBeFocused();
  await editItem.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '채팅 삭제' })).toBeFocused();
  await page.getByRole('menuitem', { name: '채팅 삭제' }).press('ArrowUp');
  await expect(editItem).toBeFocused();
  await editItem.press('Enter');
  const input = page.getByRole('dialog').getByRole('textbox', { name: '채팅 이름 수정' });
  await expect(input).toBeFocused();
  await input.fill('내 대화');
  await input.press('Enter');
  await expect(chatList.getByRole('button', { name: '내 대화', exact: true })).toBeVisible();
  await expect(chatList.getByRole('button', { name: '채팅 메뉴' })).toBeFocused();
});

test('confirms chat deletion and clears the selected chat', async ({ page }) => {
  const deletedChatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const remainingChatId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const chats = [
    {
      id: deletedChatId,
      title: '삭제할 채팅',
      title_source: 'default',
      title_status: 'idle',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: remainingChatId,
      title: '남길 채팅',
      title_source: 'default',
      title_status: 'idle',
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
  ];
  let deleted = false;
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: { items: deleted ? [chats[1]] : chats, next_cursor: null },
      }),
    }),
  );
  for (const chat of chats) {
    await page.route(`**/api/chats/${chat.id}/messages`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { chat, messages: [], active_generation: null },
        }),
      }),
    );
  }
  await page.route(`**/api/chats/${deletedChatId}`, async (route) => {
    expect(route.request().method()).toBe('DELETE');
    deleted = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/');
  const chatList = page.locator('nav[aria-label="채팅 목록"]');
  await chatList.getByRole('button', { name: '삭제할 채팅', exact: true }).click();
  await chatList.getByRole('button', { name: '채팅 메뉴' }).first().click();
  await page.getByRole('menuitem', { name: '채팅 삭제' }).click();
  await expect(page.getByRole('dialog')).toContainText('채팅을 삭제하시겠습니까?');
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect(chatList.getByRole('button', { name: '삭제할 채팅', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '무엇이든 물어보세요' })).toBeVisible();
});

test('renders Markdown safely while preserving the original answer for copying', async ({
  page,
}) => {
  const chatId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const chat = {
    id: chatId,
    title: 'Markdown 채팅',
    title_source: 'manual',
    title_status: 'idle',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const answer = [
    '# 답변 제목',
    '',
    '> 인용문',
    '',
    '| 항목 | 값 |',
    '| --- | --- |',
    '| A | B |',
    '',
    '- [x] 완료',
    '- `inline`',
    '',
    '```ts',
    'const value = 1',
    '```',
    '',
    '<script>alert("x")</script>',
    '![이미지](https://example.com/image.png)',
    '[안전한 링크](https://example.com)',
    '[위험한 링크](javascript:alert(1))',
  ].join('\n');
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: [chat], next_cursor: null } }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat,
          messages: [
            {
              id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              chat_id: chatId,
              role: 'user',
              content: '<b>질문 원문</b>',
              status: 'completed',
              sequence_no: 1,
              generation_id: null,
              error_code: null,
              created_at: chat.created_at,
              updated_at: chat.updated_at,
            },
            {
              id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              chat_id: chatId,
              role: 'assistant',
              content: answer,
              status: 'completed',
              sequence_no: 2,
              generation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              error_code: null,
              created_at: chat.created_at,
              updated_at: chat.updated_at,
            },
          ],
          active_generation: null,
        },
      }),
    }),
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Markdown 채팅', exact: true }).click();
  await expect(page.getByRole('heading', { name: '답변 제목' })).toBeVisible();
  await expect(page.getByRole('blockquote')).toContainText('인용문');
  await expect(page.locator('table')).toBeVisible();
  await expect(page.locator('pre code')).toContainText('const value = 1');
  await expect(page.locator('.markdown-answer img')).toHaveCount(0);
  await expect(page.locator('.markdown-answer script')).toHaveCount(0);
  await expect(page.getByText('<b>질문 원문</b>', { exact: true })).toBeVisible();
  const safeLink = page.getByRole('link', { name: '안전한 링크' });
  await expect(safeLink).toHaveAttribute('href', 'https://example.com');
  await expect(safeLink).toHaveAttribute('rel', 'noopener noreferrer');
  const unsafeLink = page.getByRole('link', { name: '위험한 링크' });
  await expect(unsafeLink).not.toHaveAttribute('href', 'javascript:alert(1)');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const copyButton = page.getByRole('button', { name: '복사' });
  await copyButton.click();
  await expect(page.getByRole('button', { name: '복사됨' })).toBeVisible();
  await expect(copyButton).toBeVisible({ timeout: 5_000 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(answer);
});

test('keeps copy unavailable for streaming answers and reports clipboard failure', async ({
  page,
}) => {
  const chatId = '99999999-9999-4999-8999-999999999999';
  const timestamp = '2026-01-01T00:00:00.000Z';
  const chat = {
    id: chatId,
    title: '복사 상태 채팅',
    title_source: 'manual',
    title_status: 'idle',
    created_at: timestamp,
    updated_at: timestamp,
  };
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: [chat], next_cursor: null } }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat,
          messages: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              chat_id: chatId,
              role: 'user',
              content: '질문',
              status: 'completed',
              sequence_no: 1,
              generation_id: null,
              error_code: null,
              created_at: timestamp,
              updated_at: timestamp,
            },
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              chat_id: chatId,
              role: 'assistant',
              content: '실패한 답변',
              status: 'failed',
              sequence_no: 2,
              generation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              error_code: 'upstream_unavailable',
              created_at: timestamp,
              updated_at: timestamp,
            },
            {
              id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              chat_id: chatId,
              role: 'assistant',
              content: '아직 생성 중인 답변',
              status: 'streaming',
              sequence_no: 3,
              generation_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              error_code: null,
              created_at: timestamp,
              updated_at: timestamp,
            },
          ],
          active_generation: null,
        },
      }),
    }),
  );

  await page.goto('/');
  await page.getByRole('button', { name: '복사 상태 채팅', exact: true }).click();
  await expect(page.getByRole('button', { name: '복사', exact: true })).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => Promise.reject(new Error('clipboard denied')),
    });
  });
  await page.getByRole('button', { name: '복사', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '복사하지 못했어요' })).toContainText(
    '복사하지 못했어요. 텍스트를 선택해 복사해 주세요.',
  );
});

test('sends a message and renders the streamed answer', async ({ page }) => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userMessageId = '22222222-2222-4222-8222-222222222222';
  const assistantMessageId = '33333333-3333-4333-8333-333333333333';
  const generationId = '44444444-4444-4444-8444-444444444444';
  let generationRequestCount = 0;
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: '{"data":{"items":[],"next_cursor":null}}',
    }),
  );
  await page.route('**/api/chat/generations', (route) => {
    generationRequestCount += 1;
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat_id: chatId,
          user_message_id: userMessageId,
          assistant_message_id: assistantMessageId,
          generation_id: generationId,
          status: 'pending',
        },
      }),
    });
  });
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat: {
            id: chatId,
            title: '새 채팅',
            title_source: 'default',
            title_status: 'idle',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          messages: [],
          active_generation: null,
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${generationId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generation_id: generationId,
          assistant_message_id: assistantMessageId,
          content: '',
          status: 'pending',
          last_event_seq: '0',
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${generationId}/events*`, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: [
        `id: 1\nevent: delta\ndata: ${JSON.stringify({ generation_id: generationId, assistant_message_id: assistantMessageId, event_seq: '1', event_type: 'delta', text: '반가워요' })}\n\n`,
        `id: 2\nevent: completed\ndata: ${JSON.stringify({ generation_id: generationId, assistant_message_id: assistantMessageId, event_seq: '2', event_type: 'completed', status: 'completed', content: '반가워요' })}\n\n`,
      ].join(''),
    }),
  );
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (/A tree hydrated|Hydration failed/i.test(message.text()))
      hydrationErrors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '무엇이든 물어보세요' })).toBeVisible();
  const input = page.getByRole('textbox');
  await input.fill('안녕하세요');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  expect(generationRequestCount).toBe(0);
  await expect(page.getByRole('button', { name: '보내기' })).toBeEnabled();
  await input.press('Enter');
  expect(generationRequestCount).toBe(1);
  await expect(page.getByText('안녕하세요')).toBeVisible();
  await expect(page.getByText('반가워요')).toBeVisible();
  await expect(page.getByRole('button', { name: '복사', exact: true })).toBeVisible();
  expect(hydrationErrors).toEqual([]);
  await page.screenshot({ path: 'test-results/workspace.png', fullPage: true });
});

test('opens a long conversation at the latest message', async ({ page }) => {
  const chatId = '12121212-1212-4121-8121-121212121212';
  const timestamp = '2026-01-01T00:00:00.000Z';
  const chat = {
    id: chatId,
    title: '긴 대화',
    title_source: 'manual',
    title_status: 'idle',
    created_at: timestamp,
    updated_at: timestamp,
  };
  const messages = Array.from({ length: 24 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, '0')}-1212-4121-8121-121212121212`,
    chat_id: chatId,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index + 1}번째 메시지\n`.repeat(8),
    status: 'completed',
    sequence_no: index + 1,
    generation_id: null,
    error_code: null,
    created_at: timestamp,
    updated_at: timestamp,
  }));
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: [chat], next_cursor: null } }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { chat, messages, active_generation: null } }),
    }),
  );

  await page.goto(`/chats/${chatId}`);
  await expect(page).toHaveURL(new RegExp(`/chats/${chatId}$`));
  const messageRegion = page.getByRole('region', { name: '메시지' });
  await expect(messageRegion.getByText('24번째 메시지', { exact: false })).toBeVisible();
  await expect
    .poll(async () =>
      messageRegion.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test('shows and retries a chat list read error', async ({ page }) => {
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":{"code":"storage_error"}}',
    }),
  );
  await page.goto('/');
  await expect(page.getByText('채팅 목록을 불러오지 못했어요')).toBeVisible();
  await page.unroute('**/api/chats');
  await page.getByRole('button', { name: '다시 불러오기' }).click();
  await expect(page.getByText('채팅 목록을 불러오지 못했어요')).toHaveCount(0);
});

test('shows an SSE stream error without marking the answer complete', async ({ page }) => {
  const chatId = '55555555-5555-4555-8555-555555555555';
  const assistantMessageId = '66666666-6666-4666-8666-666666666666';
  const generationId = '77777777-7777-4777-8777-777777777777';
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: '{"data":{"items":[],"next_cursor":null}}',
    }),
  );
  await page.route('**/api/chat/generations', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat_id: chatId,
          user_message_id: '88888888-8888-4888-8888-888888888888',
          assistant_message_id: assistantMessageId,
          generation_id: generationId,
          status: 'pending',
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat: {
            id: chatId,
            title: '새 채팅',
            title_source: 'default',
            title_status: 'idle',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          messages: [],
          active_generation: null,
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${generationId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generation_id: generationId,
          assistant_message_id: assistantMessageId,
          content: '',
          status: 'pending',
          last_event_seq: '0',
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${generationId}/events*`, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: error\ndata: ${JSON.stringify({ error: { code: 'storage_error' } })}\n\n`,
    }),
  );
  await page.goto('/');
  await page.getByRole('textbox').fill('연결 테스트');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(
    page.getByRole('alert').filter({
      hasText: '응답 연결이 끊겼어요. 자동으로 다시 연결하는 중이에요.',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: '메시지' }).getByText('완료', { exact: true }),
  ).toHaveCount(0);
});

test('reconnects after an EOF and applies each event only once', async ({ page }) => {
  const chatId = 'abababab-abab-4aba-8aba-abababababab';
  const userMessageId = 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc';
  const assistantMessageId = 'cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd';
  const generationId = 'dededede-dede-4ded-8ded-dededededede';
  let eventAttempts = 0;
  let snapshotAttempts = 0;
  const chat = {
    id: chatId,
    title: '재접속 테스트',
    title_source: 'default',
    title_status: 'idle',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: '{"data":{"items":[],"next_cursor":null}}',
    }),
  );
  await page.route('**/api/chat/generations', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat_id: chatId,
          user_message_id: userMessageId,
          assistant_message_id: assistantMessageId,
          generation_id: generationId,
          status: 'pending',
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { chat, messages: [], active_generation: null } }),
    }),
  );
  await page.route(`**/api/generations/${generationId}`, (route) =>
    (() => {
      snapshotAttempts += 1;
      const recovered = snapshotAttempts >= 3;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            generation_id: generationId,
            assistant_message_id: assistantMessageId,
            content: recovered ? '재접속 답변' : '',
            status: recovered ? 'streaming' : 'pending',
            last_event_seq: recovered ? '1' : '0',
          },
        }),
      });
    })(),
  );
  await page.route(`**/api/generations/${generationId}/events*`, (route) => {
    eventAttempts += 1;
    const body =
      eventAttempts === 1
        ? ''
        : eventAttempts === 2
          ? 'event: delta\ndata: ' +
            JSON.stringify({
              generation_id: generationId,
              assistant_message_id: assistantMessageId,
              event_seq: '2',
              event_type: 'delta',
              text: '재접속 답변',
            }) +
            '\n\n'
          : 'event: completed\ndata: ' +
            JSON.stringify({
              generation_id: generationId,
              assistant_message_id: assistantMessageId,
              event_seq: '2',
              event_type: 'completed',
              status: 'completed',
              content: '재접속 답변',
            }) +
            '\n\n';
    return route.fulfill({ contentType: 'text/event-stream', body });
  });

  await page.goto('/');
  await page.getByRole('textbox').fill('재접속 테스트');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByRole('button', { name: '다시 연결' })).toBeVisible();
  await page.getByRole('button', { name: '다시 연결' }).click();
  await expect(page.getByText('재접속 답변')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('재접속 답변')).toHaveCount(1);
  expect(eventAttempts).toBeGreaterThanOrEqual(2);
});

test('stops an active generation and renders the interrupted state', async ({ page }) => {
  const chatId = '99999999-9999-4999-8999-999999999999';
  const assistantMessageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const generationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let releaseEvents!: () => void;
  const eventsReady = new Promise<void>((resolve) => {
    releaseEvents = resolve;
  });
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: '{"data":{"items":[],"next_cursor":null}}',
    }),
  );
  await page.route('**/api/chat/generations', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat_id: chatId,
          user_message_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          assistant_message_id: assistantMessageId,
          generation_id: generationId,
          status: 'pending',
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat: {
            id: chatId,
            title: '새 채팅',
            title_source: 'default',
            title_status: 'idle',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          messages: [],
          active_generation: null,
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${generationId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generation_id: generationId,
          assistant_message_id: assistantMessageId,
          content: '',
          status: 'pending',
          last_event_seq: '0',
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${generationId}/events*`, async (route) => {
    await eventsReady;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `event: interrupted\ndata: ${JSON.stringify({ generation_id: generationId, assistant_message_id: assistantMessageId, event_seq: '1', event_type: 'interrupted', status: 'interrupted', content: '' })}\n\n`,
    });
  });
  await page.route(`**/api/generations/${generationId}/stop`, async (route) => {
    releaseEvents();
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { generation_id: generationId, status: 'streaming', stop_requested: true },
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('textbox').fill('중단 테스트');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByRole('button', { name: '응답 중단' })).toBeVisible();
  await expect(page.getByRole('status', { name: '답변을 기다리는 중이에요' })).toBeVisible();
  await page.getByRole('button', { name: '응답 중단' }).click();
  await expect(page.getByRole('status', { name: '답변을 기다리는 중이에요' })).toHaveCount(0);
  await expect(page.getByText('중단 테스트')).toBeVisible();
});

test('keeps generation controls scoped to the selected chat and clears a new draft', async ({
  page,
}) => {
  const chatAId = '51515151-5151-4515-8515-515151515151';
  const chatBId = '52525252-5252-4525-8525-525252525252';
  const generationId = '53535353-5353-4535-8535-535353535353';
  const assistantId = '54545454-5454-4545-8545-545454545454';
  const userId = '55555555-5555-4555-8555-555555555555';
  const timestamp = '2026-01-01T00:00:00.000Z';
  const chats = [
    {
      id: chatAId,
      title: '채팅 A',
      title_source: 'manual',
      title_status: 'idle',
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: chatBId,
      title: '채팅 B',
      title_source: 'manual',
      title_status: 'idle',
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: chats, next_cursor: null } }),
    }),
  );
  await page.route(`**/api/chats/${chatAId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat: chats[0],
          messages: [
            {
              id: userId,
              chat_id: chatAId,
              role: 'user',
              content: '질문 A',
              status: 'completed',
              sequence_no: 1,
              generation_id: null,
              error_code: null,
              created_at: timestamp,
              updated_at: timestamp,
            },
            {
              id: assistantId,
              chat_id: chatAId,
              role: 'assistant',
              content: '',
              status: 'pending',
              sequence_no: 2,
              generation_id: generationId,
              error_code: null,
              created_at: timestamp,
              updated_at: timestamp,
            },
          ],
          active_generation: {
            generation_id: generationId,
            assistant_message_id: assistantId,
            content: '',
            status: 'pending',
            last_event_seq: '0',
          },
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatBId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { chat: chats[1], messages: [], active_generation: null } }),
    }),
  );
  await page.route(`**/api/generations/${generationId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generation_id: generationId,
          assistant_message_id: assistantId,
          content: '',
          status: 'pending',
          last_event_seq: '0',
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${generationId}/events*`, (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }),
  );

  await page.goto(`/chats/${chatAId}`);
  await expect(page.getByRole('button', { name: '응답 중단' })).toBeVisible();
  await page.getByRole('button', { name: '채팅 B' }).click();
  await expect(page.getByRole('textbox')).toBeEnabled();
  await expect(page.getByRole('button', { name: '응답 중단' })).toHaveCount(0);
  await page.getByRole('button', { name: '채팅 A' }).click();
  await expect(page.getByRole('button', { name: '응답 중단' })).toBeVisible();
  await page.getByRole('button', { name: '채팅 B' }).click();
  await page.getByRole('textbox').fill('작성 중인 초안');
  await page.getByRole('button', { name: '새 채팅' }).click();
  await expect(page.getByRole('textbox')).toHaveValue('');
});

test('retries a failed answer with the existing user message', async ({ page }) => {
  const chatId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const userMessageId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const failedAssistantId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const retryAssistantId = '12121212-1212-4121-8121-121212121212';
  const retryGenerationId = '13131313-1313-4131-8131-131313131313';
  let retryCalled = false;
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [
            {
              id: chatId,
              title: '재시도 채팅',
              title_source: 'default',
              title_status: 'idle',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          next_cursor: null,
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat: {
            id: chatId,
            title: '재시도 채팅',
            title_source: 'default',
            title_status: 'idle',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          messages: retryCalled
            ? [
                {
                  id: userMessageId,
                  chat_id: chatId,
                  role: 'user',
                  content: '실패한 질문',
                  status: 'completed',
                  sequence_no: 1,
                  generation_id: null,
                  error_code: null,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
                {
                  id: retryAssistantId,
                  chat_id: chatId,
                  role: 'assistant',
                  content: '',
                  status: 'pending',
                  sequence_no: 2,
                  generation_id: retryGenerationId,
                  error_code: null,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
              ]
            : [
                {
                  id: userMessageId,
                  chat_id: chatId,
                  role: 'user',
                  content: '실패한 질문',
                  status: 'completed',
                  sequence_no: 1,
                  generation_id: null,
                  error_code: null,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
                {
                  id: failedAssistantId,
                  chat_id: chatId,
                  role: 'assistant',
                  content: '부분 답변',
                  status: 'failed',
                  sequence_no: 2,
                  generation_id: '14141414-1414-4141-8141-141414141414',
                  error_code: 'upstream_unavailable',
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
              ],
          active_generation: null,
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages/${failedAssistantId}/retry`, async (route) => {
    retryCalled = true;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat_id: chatId,
          user_message_id: userMessageId,
          assistant_message_id: retryAssistantId,
          generation_id: retryGenerationId,
          status: 'pending',
        },
      }),
    });
  });
  await page.route(`**/api/generations/${retryGenerationId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generation_id: retryGenerationId,
          assistant_message_id: retryAssistantId,
          content: '',
          status: 'pending',
          last_event_seq: '0',
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${retryGenerationId}/events*`, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: completed\ndata: ${JSON.stringify({ generation_id: retryGenerationId, assistant_message_id: retryAssistantId, event_seq: '1', event_type: 'completed', status: 'completed', content: '재시도 성공' })}\n\n`,
    }),
  );

  await page.goto('/');
  await page.getByRole('button', { name: '재시도 채팅' }).click();
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('재시도 성공')).toBeVisible();
});

test('regenerates a completed answer', async ({ page }) => {
  const chatId = '15151515-1515-4151-8151-151515151515';
  const userMessageId = '16161616-1616-4161-8161-161616161616';
  const assistantMessageId = '17171717-1717-4171-8171-171717171717';
  const generationId = '18181818-1818-4181-8181-181818181818';
  const nextAssistantMessageId = '19191919-1919-4191-8191-191919191919';
  const nextGenerationId = '20202020-2020-4202-8202-202020202020';
  let regenerateCalled = false;
  const chat = {
    id: chatId,
    title: '재생성 채팅',
    title_source: 'manual',
    title_status: 'idle',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const user = {
    id: userMessageId,
    chat_id: chatId,
    role: 'user',
    content: '같은 질문',
    status: 'completed',
    sequence_no: 1,
    generation_id: null,
    error_code: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  await page.route('**/api/chats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: [chat], next_cursor: null } }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat,
          messages: [
            user,
            regenerateCalled
              ? {
                  ...user,
                  id: nextAssistantMessageId,
                  role: 'assistant',
                  content: '',
                  sequence_no: 2,
                  generation_id: nextGenerationId,
                }
              : {
                  ...user,
                  id: assistantMessageId,
                  role: 'assistant',
                  content: '첫 답변',
                  sequence_no: 2,
                  generation_id: generationId,
                },
          ],
          active_generation: null,
        },
      }),
    }),
  );
  await page.route(`**/api/chats/${chatId}/messages/${assistantMessageId}/regenerate`, (route) => {
    regenerateCalled = true;
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          chat_id: chatId,
          user_message_id: userMessageId,
          assistant_message_id: nextAssistantMessageId,
          generation_id: nextGenerationId,
          status: 'pending',
        },
      }),
    });
  });
  await page.route(`**/api/generations/${nextGenerationId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generation_id: nextGenerationId,
          assistant_message_id: nextAssistantMessageId,
          content: '',
          status: 'pending',
          last_event_seq: '0',
        },
      }),
    }),
  );
  await page.route(`**/api/generations/${nextGenerationId}/events*`, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: completed\ndata: ${JSON.stringify({ generation_id: nextGenerationId, assistant_message_id: nextAssistantMessageId, event_seq: '1', event_type: 'completed', status: 'completed', content: '두 번째 답변' })}\n\n`,
    }),
  );

  await page.goto('/');
  await page.getByRole('button', { name: '재생성 채팅' }).click();
  await expect(page.getByRole('button', { name: '다시 생성' })).toBeVisible();
  await page.getByRole('button', { name: '다시 생성' }).click();
  await expect(page.getByText('두 번째 답변')).toBeVisible();
});

test('database health endpoint connects to the migrated database', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ data: { status: 'ok', database: 'connected' } });
});
