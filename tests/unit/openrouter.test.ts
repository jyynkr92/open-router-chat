import { describe, expect, it } from 'vitest';

import { createOpenRouterClient, OPENROUTER_MODEL } from '@/lib/server/openrouter';

const responseFor = (parts: Uint8Array[], status = 200) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
    { status, headers: { 'content-type': 'text/event-stream' } },
  );

describe('OpenRouter client', () => {
  it('parses fragmented UTF-8 SSE data and ignores comments and usage', async () => {
    const encoder = new TextEncoder();
    const source =
      ': heartbeat\n\n' +
      'data: {"choices":[{"delta":{"content":"안"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"녕"}}]}\n\n' +
      'data: {"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n' +
      'data: [DONE]\n\n';
    const bytes = encoder.encode(source);
    const splitAt = bytes.findIndex((byte, index) => byte > 127 && index > 0);
    const fetchImplementation = async () =>
      responseFor([bytes.slice(0, splitAt + 1), bytes.slice(splitAt + 1)]);
    const client = createOpenRouterClient({ apiKey: 'test-key', fetchImplementation });

    const events = [];
    for await (const event of client.stream(
      [{ role: 'user', content: '질문' }],
      new AbortController().signal,
    ))
      events.push(event);

    expect(events).toEqual([
      { type: 'delta', text: '안' },
      { type: 'delta', text: '녕' },
      { type: 'usage', inputTokens: 2, outputTokens: 3 },
      { type: 'done' },
    ]);
  });

  it('sends the fixed model and forwards the abort signal', async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = async (_input: string | URL | Request, init?: RequestInit) => {
      request = init;
      return responseFor([new TextEncoder().encode('data: [DONE]\n\n')]);
    };
    const client = createOpenRouterClient({ apiKey: 'test-key', fetchImplementation });
    const controller = new AbortController();

    for await (const _event of client.stream(
      [{ role: 'user', content: '질문' }],
      controller.signal,
    )) {
      controller.abort('cancel');
    }

    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: OPENROUTER_MODEL,
      stream: true,
    });
    expect((request?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      'Bearer test-key',
    );
    expect(request?.signal?.aborted).toBe(true);
  });

  it('requests a non-streaming completion for title generation', async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = async (_input: string | URL | Request, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: '첫 질문 요약' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createOpenRouterClient({ apiKey: 'test-key', fetchImplementation });

    await expect(
      client.complete(
        [
          { role: 'system', content: '제목만 출력' },
          { role: 'user', content: '질문' },
        ],
        new AbortController().signal,
      ),
    ).resolves.toBe('첫 질문 요약');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: OPENROUTER_MODEL,
      stream: false,
    });
  });

  it('distinguishes a non-success response', async () => {
    const fetchImplementation = async () =>
      new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 });
    const client = createOpenRouterClient({ apiKey: 'test-key', fetchImplementation });

    await expect(async () => {
      for await (const _event of client.stream([], new AbortController().signal)) return;
    }).rejects.toMatchObject({ code: 'upstream_auth_error' });
  });

  it('rejects an HTTP 200 stream without a normal [DONE] terminator', async () => {
    const fetchImplementation = async () =>
      responseFor([new TextEncoder().encode('data: {"choices":[]}\n\n')]);
    const client = createOpenRouterClient({ apiKey: 'test-key', fetchImplementation });

    await expect(async () => {
      for await (const _event of client.stream([], new AbortController().signal)) {
        // Consume the stream so the missing [DONE] error is observed.
      }
    }).rejects.toMatchObject({ code: 'upstream_disconnected' });
  });

  it('treats an error payload inside an HTTP 200 stream as an upstream failure', async () => {
    const fetchImplementation = async () =>
      responseFor([new TextEncoder().encode('data: {"error":{"message":"overloaded"}}\n\n')]);
    const client = createOpenRouterClient({ apiKey: 'test-key', fetchImplementation });

    await expect(async () => {
      for await (const _event of client.stream([], new AbortController().signal)) {
        // Consume the stream so the provider error is observed.
      }
    }).rejects.toMatchObject({ code: 'upstream_unavailable' });
  });

  it('maps an upstream abort caused by the timeout to generation_timeout', async () => {
    const fetchImplementation = async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('timed out', 'AbortError')),
          { once: true },
        );
      });
    const client = createOpenRouterClient({
      apiKey: 'test-key',
      fetchImplementation,
      timeoutMs: 1,
    });

    await expect(async () => {
      for await (const _event of client.stream([], new AbortController().signal)) {
        // Consume the stream so the timeout is observed.
      }
    }).rejects.toMatchObject({ code: 'generation_timeout' });
  });
});
