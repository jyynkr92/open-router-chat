import { randomUUID } from 'node:crypto';

import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { isTerminalGenerationStatus } from '@/lib/generation-status';
import {
  GenerationCursorError,
  GenerationReadError,
  getGenerationEventState,
} from '@/lib/server/generation-events';
import { isUuid } from '@/lib/server/validation';
import type { GenerationEvent, GenerationRouteContext } from '@/types/chat/generation-events';

const POLL_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 15_000;

const parseAfterEventSeq = (request: Request): bigint | null => {
  const url = new URL(request.url);
  if (
    url.searchParams.getAll('after_event_seq').length > 1 ||
    [...url.searchParams.keys()].some((key) => key !== 'after_event_seq')
  )
    return null;
  const value = url.searchParams.get('after_event_seq') ?? '0';
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const serializeEvent = (event: GenerationEvent) =>
  `id: ${event.event_seq}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;

const serializeError = (code: string, retryable: boolean) =>
  `event: error\ndata: ${JSON.stringify({ error: { code, retryable, request_id: randomUUID() } })}\n\n`;

const waitForNextPoll = (signal: AbortSignal, milliseconds: number) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const handleAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      resolve(false);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve(true);
    }, milliseconds);
    signal.addEventListener('abort', handleAbort, { once: true });
  });

const streamEvents = async function* (
  generationId: string,
  afterEventSeq: bigint,
  signal: AbortSignal,
) {
  let cursor = afterEventSeq;
  let lastHeartbeatAt = Date.now();
  while (!signal.aborted) {
    const state = await getGenerationEventState(generationId, cursor);
    for (const event of state.events) {
      cursor = BigInt(event.event_seq);
      yield serializeEvent(event);
    }
    if (isTerminalGenerationStatus(state.status) && cursor >= state.lastEventSeq) return;

    const now = Date.now();
    if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatAt = now;
      yield ': heartbeat\n\n';
    }
    const waitMs = Math.min(
      POLL_INTERVAL_MS,
      Math.max(1, HEARTBEAT_INTERVAL_MS - (Date.now() - lastHeartbeatAt)),
    );
    if (!(await waitForNextPoll(signal, waitMs))) return;
  }
};

export const GET = async (request: Request, { params }: GenerationRouteContext) => {
  const { 'generation-id': generationId } = await params;
  const afterEventSeq = parseAfterEventSeq(request);
  if (!isUuid(generationId) || afterEventSeq === null)
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);

  try {
    await getGenerationEventState(generationId, afterEventSeq);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of streamEvents(generationId, afterEventSeq, request.signal)) {
            if (request.signal.aborted) break;
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (error) {
          if (!request.signal.aborted) {
            const code =
              error instanceof GenerationReadError
                ? API_ERROR_CODE.deletedRequest
                : API_ERROR_CODE.storage;
            controller.enqueue(
              encoder.encode(serializeError(code, code === API_ERROR_CODE.storage)),
            );
            controller.close();
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof GenerationReadError)
      return errorResponse(
        error.code === 'deleted_request'
          ? API_ERROR_CODE.deletedRequest
          : API_ERROR_CODE.generationNotFound,
        error.code === 'deleted_request' ? HTTP_STATUS.gone : HTTP_STATUS.notFound,
      );
    if (error instanceof GenerationCursorError)
      return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
