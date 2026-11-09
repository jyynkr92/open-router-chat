import { createParser } from 'eventsource-parser';

import type {
  GenerationContextMessage,
  OpenRouterPromptMessage,
} from '@/types/chat/generation-context';

export const OPENROUTER_MODEL = 'openai/gpt-4o-mini';
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export type OpenRouterErrorCode =
  | 'upstream_auth_error'
  | 'upstream_rate_limited'
  | 'upstream_unavailable'
  | 'upstream_disconnected'
  | 'generation_timeout';

export class OpenRouterError extends Error {
  constructor(
    public readonly code: OpenRouterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OpenRouterError';
  }
}

export type OpenRouterStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; inputTokens: number | null; outputTokens: number | null }
  | { type: 'done' };

type OpenRouterFetch = typeof fetch;

type OpenRouterChunk = {
  choices?: Array<{ delta?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { code?: unknown; message?: unknown };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readCompletionContent = (body: unknown): string => {
  if (!isRecord(body) || !Array.isArray(body.choices))
    throw new OpenRouterError('upstream_disconnected', 'OpenRouter response was invalid');
  const firstChoice = body.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message))
    throw new OpenRouterError('upstream_disconnected', 'OpenRouter response was invalid');
  const content = firstChoice.message.content;
  if (typeof content !== 'string')
    throw new OpenRouterError('upstream_disconnected', 'OpenRouter response was invalid');
  return content;
};

const asTokenCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const parseEvent = (data: string): OpenRouterStreamEvent | null => {
  if (data === '[DONE]') return { type: 'done' };
  let chunk: OpenRouterChunk;
  try {
    chunk = JSON.parse(data) as OpenRouterChunk;
  } catch (error) {
    throw new OpenRouterError('upstream_disconnected', 'OpenRouter returned invalid SSE data', {
      cause: error,
    });
  }

  if (chunk.error) {
    throw new OpenRouterError('upstream_unavailable', 'OpenRouter returned an upstream error');
  }

  const content = chunk.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content.length > 0) return { type: 'delta', text: content };

  if (chunk.usage) {
    return {
      type: 'usage',
      inputTokens: asTokenCount(chunk.usage.prompt_tokens),
      outputTokens: asTokenCount(chunk.usage.completion_tokens),
    };
  }

  return null;
};

const errorForStatus = (status: number): OpenRouterErrorCode => {
  if (status === 401 || status === 403) return 'upstream_auth_error';
  if (status === 429) return 'upstream_rate_limited';
  return 'upstream_unavailable';
};

const readErrorResponse = async (response: Response): Promise<OpenRouterError> => {
  try {
    const body = (await response.json()) as { error?: unknown };
    return new OpenRouterError(errorForStatus(response.status), 'OpenRouter request failed', {
      cause: body.error instanceof Error ? body.error : undefined,
    });
  } catch (error) {
    return new OpenRouterError(errorForStatus(response.status), 'OpenRouter request failed', {
      cause: error,
    });
  }
};

export type OpenRouterClient = {
  stream: (
    messages: GenerationContextMessage[],
    signal: AbortSignal,
  ) => AsyncGenerator<OpenRouterStreamEvent>;
  complete: (messages: OpenRouterPromptMessage[], signal: AbortSignal) => Promise<string>;
};

export const createOpenRouterClient = (input?: {
  apiKey?: string;
  endpoint?: string;
  fetchImplementation?: OpenRouterFetch;
  timeoutMs?: number;
}): OpenRouterClient => {
  const apiKey = input?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  const endpoint = input?.endpoint ?? OPENROUTER_ENDPOINT;
  const fetchImplementation = input?.fetchImplementation ?? fetch;
  const timeoutMs = input?.timeoutMs ?? 120_000;

  const stream = async function* (
    messages: GenerationContextMessage[],
    signal: AbortSignal,
  ): AsyncGenerator<OpenRouterStreamEvent> {
    const upstreamController = new AbortController();
    const handleAbort = () => upstreamController.abort(signal.reason);
    const timeout = setTimeout(() => upstreamController.abort('timeout'), timeoutMs);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();

    try {
      let response: Response;
      try {
        response = await fetchImplementation(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: OPENROUTER_MODEL, messages, stream: true }),
          signal: upstreamController.signal,
        });
      } catch (error) {
        if (upstreamController.signal.reason === 'timeout')
          throw new OpenRouterError('generation_timeout', 'OpenRouter request timed out', {
            cause: error,
          });
        if (signal.aborted) throw error;
        throw new OpenRouterError('upstream_unavailable', 'OpenRouter request could not start', {
          cause: error,
        });
      }

      if (!response.ok) throw await readErrorResponse(response);
      if (!response.body)
        throw new OpenRouterError('upstream_disconnected', 'OpenRouter body is missing');

      const decoder = new TextDecoder();
      const events: OpenRouterStreamEvent[] = [];
      let parserError: unknown;
      let completed = false;
      const parser = createParser({
        maxBufferSize: 1_000_000,
        onEvent: (event) => {
          const parsed = parseEvent(event.data);
          if (!parsed) return;
          events.push(parsed);
          if (parsed.type === 'done') completed = true;
        },
        onError: (error) => {
          parserError = error;
        },
      });

      try {
        for await (const chunk of response.body) {
          parser.feed(decoder.decode(chunk, { stream: true }));
          if (parserError)
            throw new OpenRouterError('upstream_disconnected', 'Invalid OpenRouter SSE stream');
          while (events.length > 0) yield events.shift() as OpenRouterStreamEvent;
        }
      } catch (error) {
        if (upstreamController.signal.reason === 'timeout')
          throw new OpenRouterError('generation_timeout', 'OpenRouter request timed out', {
            cause: error,
          });
        if (signal.aborted) throw error;
        if (error instanceof OpenRouterError) throw error;
        throw new OpenRouterError('upstream_disconnected', 'OpenRouter stream disconnected', {
          cause: error,
        });
      }
      parser.feed(decoder.decode());
      parser.reset({ consume: true });
      if (parserError)
        throw new OpenRouterError('upstream_disconnected', 'Incomplete OpenRouter SSE stream');
      while (events.length > 0) yield events.shift() as OpenRouterStreamEvent;
      if (!completed)
        throw new OpenRouterError('upstream_disconnected', 'OpenRouter stream ended before [DONE]');
    } finally {
      clearTimeout(timeout);
      upstreamController.abort();
      signal.removeEventListener('abort', handleAbort);
    }
  };

  const complete = async (
    messages: OpenRouterPromptMessage[],
    signal: AbortSignal,
  ): Promise<string> => {
    const upstreamController = new AbortController();
    const handleAbort = () => upstreamController.abort(signal.reason);
    const timeout = setTimeout(() => upstreamController.abort('timeout'), timeoutMs);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();

    try {
      let response: Response;
      try {
        response = await fetchImplementation(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: OPENROUTER_MODEL, messages, stream: false }),
          signal: upstreamController.signal,
        });
      } catch (error) {
        if (upstreamController.signal.reason === 'timeout')
          throw new OpenRouterError('generation_timeout', 'OpenRouter request timed out', {
            cause: error,
          });
        if (signal.aborted) throw error;
        throw new OpenRouterError('upstream_unavailable', 'OpenRouter request could not start', {
          cause: error,
        });
      }
      if (!response.ok) throw await readErrorResponse(response);
      const body: unknown = await response.json();
      return readCompletionContent(body);
    } finally {
      clearTimeout(timeout);
      upstreamController.abort();
      signal.removeEventListener('abort', handleAbort);
    }
  };

  return { stream, complete };
};
