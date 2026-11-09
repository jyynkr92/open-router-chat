import { z } from 'zod';

import { readChatJson } from '@/api/chat/read-json';
import { generationStatusSchema } from '@/lib/generation-schema';
import type {
  CreateGenerationInput,
  GenerationRegistration,
  RegenerateGenerationInput,
  RetryGenerationInput,
} from '@/types/chat/generation';
import type { GenerationSnapshot } from '@/types/chat/generation-events';
import type { GenerationStopResult } from '@/types/chat/generation-stop';

const registrationSchema = z.object({
  chat_id: z.uuid(),
  user_message_id: z.uuid(),
  assistant_message_id: z.uuid(),
  generation_id: z.uuid(),
  status: generationStatusSchema,
});

const registrationResponseSchema = z.object({ data: registrationSchema });
const snapshotResponseSchema = z.object({
  data: z.object({
    generation_id: z.uuid(),
    assistant_message_id: z.uuid(),
    content: z.string(),
    status: generationStatusSchema,
    last_event_seq: z.string().regex(/^\d+$/),
  }),
});

export class ChatGenerationError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const postBranchGeneration = async (
  operation: 'retry' | 'regenerate',
  input: RetryGenerationInput | RegenerateGenerationInput,
): Promise<GenerationRegistration> => {
  const response = await fetch(
    `/api/chats/${encodeURIComponent(input.chatId)}/messages/${encodeURIComponent(input.messageId)}/${operation}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_request_id: input.clientRequestId }),
    },
  );
  const result = registrationResponseSchema.safeParse(
    await readChatJson(response, ChatGenerationError),
  );
  if (!result.success) throw new ChatGenerationError('invalid_response');
  return result.data.data;
};

export const createGeneration = async (
  input: CreateGenerationInput,
): Promise<GenerationRegistration> => {
  const response = await fetch('/api/chat/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_request_id: input.clientRequestId,
      chat_id: input.chatId,
      content: input.content,
    }),
  });
  const result = registrationResponseSchema.safeParse(
    await readChatJson(response, ChatGenerationError),
  );
  if (!result.success) throw new ChatGenerationError('invalid_response');
  return result.data.data;
};

export const retryGeneration = async (
  input: RetryGenerationInput,
): Promise<GenerationRegistration> => postBranchGeneration('retry', input);

export const regenerateGeneration = async (
  input: RegenerateGenerationInput,
): Promise<GenerationRegistration> => postBranchGeneration('regenerate', input);

export const fetchGenerationSnapshot = async (
  generationId: string,
  signal?: AbortSignal,
): Promise<GenerationSnapshot> => {
  const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}`, { signal });
  const result = snapshotResponseSchema.safeParse(
    await readChatJson(response, ChatGenerationError),
  );
  if (!result.success) throw new ChatGenerationError('invalid_response');
  return result.data.data;
};

const stopResponseSchema = z.object({
  data: z.object({
    generation_id: z.uuid(),
    status: generationStatusSchema,
    stop_requested: z.boolean(),
  }),
});

export const stopGeneration = async (generationId: string): Promise<GenerationStopResult> => {
  const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}/stop`, {
    method: 'POST',
  });
  const result = stopResponseSchema.safeParse(await readChatJson(response, ChatGenerationError));
  if (!result.success) throw new ChatGenerationError('invalid_response');
  return result.data.data;
};
