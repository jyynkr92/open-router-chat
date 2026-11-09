'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createParser } from 'eventsource-parser';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import {
  ChatGenerationError,
  createGeneration,
  fetchGenerationSnapshot,
  regenerateGeneration as requestGenerationRegenerate,
  retryGeneration as requestGenerationRetry,
  stopGeneration as requestGenerationStop,
} from '@/api/chat/generation';
import { requestChatTitle } from '@/api/chat/title';
import { isTerminalGenerationStatus } from '@/lib/generation-status';
import { generationStatusSchema } from '@/lib/generation-schema';
import { useChatStore } from '@/providers/app-providers';
import type {
  ActiveGenerationState,
  GenerationRegistration,
  RegenerateGenerationInput,
  ResumableGeneration,
  RetryGenerationInput,
} from '@/types/chat/generation';
import type { GenerationEvent, GenerationSnapshot } from '@/types/chat/generation-events';

const generationEventSchema = z.object({
  generation_id: z.uuid(),
  assistant_message_id: z.uuid(),
  event_seq: z.string().regex(/^\d+$/),
  event_type: z.enum(['delta', 'completed', 'interrupted', 'error']),
  text: z.string().optional(),
  status: generationStatusSchema.optional(),
  content: z.string().optional(),
  error_code: z.string().optional(),
});
const generationErrorSchema = z.object({ error: z.object({ code: z.string() }) });
const reconnectBaseDelayMs = 500;
const reconnectMaxDelayMs = 5_000;

const waitForReconnect = (signal: AbortSignal, delayMs: number) =>
  new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
      signal.removeEventListener('abort', handleAbort);
    };
    const handleOnline = () => {
      cleanup();
      resolve();
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException('The reconnect was aborted', 'AbortError'));
    };
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener('abort', handleAbort, { once: true });
    if (navigator.onLine) timer = setTimeout(handleOnline, delayMs);
    else window.addEventListener('online', handleOnline, { once: true });
  });

const updateFromSnapshot = (state: ActiveGenerationState, snapshot: GenerationSnapshot) => ({
  ...state,
  content: snapshot.content,
  status: snapshot.status,
  lastEventSeq: snapshot.last_event_seq,
});

export const useGenerationStream = (
  selectedChatId: string | null,
  resumableGeneration: ResumableGeneration | null,
) => {
  const queryClient = useQueryClient();
  const generationId = useChatStore((state) => state.activeGeneration?.generation_id ?? null);
  const isStopping = useChatStore((state) => state.isStopping);
  const setActiveGeneration = useChatStore((state) => state.actions.setActiveGeneration);
  const setIsStopping = useChatStore((state) => state.actions.setIsStopping);
  const [reconnectKey, setReconnectKey] = useState(0);
  const activeGenerationRef = useRef<ActiveGenerationState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setGenerationState = useCallback(
    (generationId: string, update: (state: ActiveGenerationState) => ActiveGenerationState) => {
      const current = activeGenerationRef.current;
      if (!current || current.generation_id !== generationId) return;
      const next = update(current);
      activeGenerationRef.current = next;
      setActiveGeneration(next);
    },
    [setActiveGeneration],
  );

  const startGeneration = useCallback(
    async (input: { chatId: string | null; content: string }) => {
      abortControllerRef.current?.abort();
      setIsStopping(false);
      const registration = await createGeneration({
        clientRequestId: crypto.randomUUID(),
        chatId: input.chatId,
        content: input.content,
      });
      const next: ActiveGenerationState = {
        ...registration,
        userContent: input.content,
        content: '',
        lastEventSeq: '0',
        connection: 'idle',
        errorCode: null,
      };
      activeGenerationRef.current = next;
      setActiveGeneration(next);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: ['chat-messages', registration.chat_id] });
      void requestChatTitle(registration.chat_id)
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          void queryClient.invalidateQueries({
            queryKey: ['chat-messages', registration.chat_id],
          });
        });
      return registration;
    },
    [queryClient, setActiveGeneration, setIsStopping],
  );

  const stopActiveGeneration = useCallback(async () => {
    const generation = activeGenerationRef.current;
    if (!generation || isTerminalGenerationStatus(generation.status) || isStopping) return;
    setIsStopping(true);
    try {
      const result = await requestGenerationStop(generation.generation_id);
      if (result.status === 'interrupted') {
        setGenerationState(generation.generation_id, (state) => ({
          ...state,
          status: 'interrupted',
          connection: 'closed',
        }));
        setIsStopping(false);
        await queryClient.invalidateQueries({ queryKey: ['chat-messages', generation.chat_id] });
      }
    } catch (error) {
      setIsStopping(false);
      throw error;
    }
  }, [isStopping, queryClient, setGenerationState, setIsStopping]);

  const activateGeneration = useCallback(
    (registration: GenerationRegistration, userContent: string) => {
      const next: ActiveGenerationState = {
        ...registration,
        userContent,
        content: '',
        lastEventSeq: '0',
        connection: 'idle',
        errorCode: null,
      };
      activeGenerationRef.current = next;
      setActiveGeneration(next);
      void queryClient.invalidateQueries({ queryKey: ['chat-messages', next.chat_id] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      return registration;
    },
    [queryClient, setActiveGeneration],
  );

  const retryActiveGeneration = useCallback(
    async (input: Omit<RetryGenerationInput, 'clientRequestId'> & { userContent: string }) => {
      abortControllerRef.current?.abort();
      setIsStopping(false);
      const registration = await requestGenerationRetry({
        clientRequestId: crypto.randomUUID(),
        chatId: input.chatId,
        messageId: input.messageId,
      });
      return activateGeneration(registration, input.userContent);
    },
    [activateGeneration, setIsStopping],
  );

  const regenerateActiveGeneration = useCallback(
    async (input: Omit<RegenerateGenerationInput, 'clientRequestId'> & { userContent: string }) => {
      abortControllerRef.current?.abort();
      setIsStopping(false);
      const registration = await requestGenerationRegenerate({
        clientRequestId: crypto.randomUUID(),
        chatId: input.chatId,
        messageId: input.messageId,
      });
      return activateGeneration(registration, input.userContent);
    },
    [activateGeneration, setIsStopping],
  );

  const reconnectActiveGeneration = useCallback(() => {
    setReconnectKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!resumableGeneration || !selectedChatId) return;
    const current = activeGenerationRef.current;
    if (current?.chat_id === selectedChatId) return;
    const next: ActiveGenerationState = {
      chat_id: selectedChatId,
      user_message_id: resumableGeneration.user_message_id,
      assistant_message_id: resumableGeneration.assistant_message_id,
      generation_id: resumableGeneration.generation_id,
      status: resumableGeneration.status,
      userContent: resumableGeneration.user_content,
      content: resumableGeneration.content,
      lastEventSeq: resumableGeneration.last_event_seq,
      connection: 'idle',
      errorCode: null,
    };
    activeGenerationRef.current = next;
    setIsStopping(false);
    setActiveGeneration(next);
  }, [resumableGeneration, selectedChatId, setActiveGeneration, setIsStopping]);

  useEffect(() => {
    const generation = activeGenerationRef.current;
    if (
      !generation ||
      generation.generation_id !== generationId ||
      generation.chat_id !== selectedChatId
    )
      return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let eventCursor = BigInt(generation.lastEventSeq);
    let sequenceGapDetected = false;
    const applyEvent = (event: GenerationEvent) => {
      if (
        event.generation_id !== generation.generation_id ||
        event.assistant_message_id !== generation.assistant_message_id
      )
        return;
      const eventSeq = BigInt(event.event_seq);
      if (eventSeq > eventCursor + 1n) {
        sequenceGapDetected = true;
        return;
      }
      if (eventSeq <= eventCursor) return;
      eventCursor = eventSeq;
      setGenerationState(generation.generation_id, (state) => {
        if (event.event_type === 'delta')
          return {
            ...state,
            content: state.content + (event.text ?? ''),
            lastEventSeq: event.event_seq,
            status: 'streaming',
            connection: 'streaming',
          };
        const next = {
          ...state,
          content: event.content ?? state.content,
          lastEventSeq: event.event_seq,
          status: event.status ?? state.status,
          connection: 'closed' as const,
          errorCode: event.error_code ?? null,
        };
        return next;
      });
      if (event.event_type !== 'delta') {
        setIsStopping(false);
        void queryClient.invalidateQueries({ queryKey: ['chat-messages', generation.chat_id] });
      }
    };

    const run = async () => {
      let reconnectAttempt = 0;
      while (!controller.signal.aborted) {
        try {
          setGenerationState(generation.generation_id, (state) => ({
            ...state,
            connection: 'connecting',
            errorCode: reconnectKey > 0 ? null : state.errorCode,
          }));
          const snapshot = await fetchGenerationSnapshot(
            generation.generation_id,
            controller.signal,
          );
          setGenerationState(generation.generation_id, (state) => ({
            ...updateFromSnapshot(state, snapshot),
            connection: 'connecting',
          }));
          if (isTerminalGenerationStatus(snapshot.status)) {
            setGenerationState(generation.generation_id, (state) => ({
              ...state,
              connection: 'closed',
            }));
            setIsStopping(false);
            await queryClient.invalidateQueries({
              queryKey: ['chat-messages', generation.chat_id],
            });
            return;
          }

          const response = await fetch(
            `/api/generations/${encodeURIComponent(generation.generation_id)}/events?after_event_seq=${encodeURIComponent(snapshot.last_event_seq)}`,
            { signal: controller.signal, headers: { Accept: 'text/event-stream' } },
          );
          if (!response.ok || !response.body) throw new ChatGenerationError('storage_error');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          eventCursor = BigInt(snapshot.last_event_seq);
          sequenceGapDetected = false;
          let parserError: unknown;
          let terminalEventReceived = false;
          let streamErrorCode: string | null = null;
          const parser = createParser({
            onEvent: (event) => {
              if (event.event === 'error') {
                try {
                  const payload = generationErrorSchema.parse(JSON.parse(event.data) as unknown);
                  streamErrorCode = payload.error.code;
                  setGenerationState(generation.generation_id, (state) => ({
                    ...state,
                    connection: 'error',
                    errorCode: payload.error.code,
                  }));
                  setIsStopping(false);
                } catch {
                  parserError = new Error('Invalid generation error event');
                }
                return;
              }
              try {
                const payload = generationEventSchema.parse(JSON.parse(event.data) as unknown);
                if (payload.event_type !== 'delta') terminalEventReceived = true;
                applyEvent(payload as GenerationEvent);
              } catch (error) {
                parserError = error;
              }
            },
            onError: (error) => {
              parserError = error;
            },
          });
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
            if (parserError) throw parserError;
          }
          parser.feed(decoder.decode());
          parser.reset({ consume: true });
          if (parserError) throw parserError;
          if (streamErrorCode) return;
          if (sequenceGapDetected) throw new ChatGenerationError('event_gap');
          if (terminalEventReceived) return;
          throw new ChatGenerationError(streamErrorCode ?? 'upstream_disconnected');
        } catch (error) {
          if (controller.signal.aborted) return;
          setGenerationState(generation.generation_id, (state) => ({
            ...state,
            connection: 'error',
            errorCode: error instanceof ChatGenerationError ? error.code : 'storage_error',
          }));
          setIsStopping(false);
          const delayMs = Math.min(
            reconnectBaseDelayMs * 2 ** reconnectAttempt,
            reconnectMaxDelayMs,
          );
          reconnectAttempt += 1;
          try {
            await waitForReconnect(controller.signal, delayMs);
          } catch {
            return;
          }
        }
      }
    };
    void run();

    return () => {
      controller.abort();
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    };
  }, [generationId, queryClient, reconnectKey, selectedChatId, setGenerationState, setIsStopping]);

  return {
    startGeneration,
    stopActiveGeneration,
    retryActiveGeneration,
    regenerateActiveGeneration,
    reconnectActiveGeneration,
  };
};
