import { z } from 'zod';

import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import {
  createGeneration,
  GenerationRegistrationError,
  MAX_USER_CONTENT_LENGTH,
} from '@/lib/server/chat-generation';

const requestSchema = z
  .object({
    client_request_id: z.uuid(),
    chat_id: z.uuid().nullable(),
    content: z
      .string()
      .max(MAX_USER_CONTENT_LENGTH)
      .refine((content) => content.trim().length > 0),
  })
  .strict();

export const POST = async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);

  try {
    const result = await createGeneration({
      clientRequestId: parsed.data.client_request_id,
      chatId: parsed.data.chat_id,
      content: parsed.data.content,
    });
    return Response.json({ data: result.data }, { status: result.isDuplicate ? 200 : 202 });
  } catch (error) {
    if (error instanceof GenerationRegistrationError) {
      if (error.code === 'chat_not_found')
        return errorResponse(API_ERROR_CODE.chatNotFound, HTTP_STATUS.notFound);
      if (error.code === 'deleted_request')
        return errorResponse(API_ERROR_CODE.deletedRequest, HTTP_STATUS.gone);
      if (error.code === 'generation_in_progress')
        return errorResponse(API_ERROR_CODE.generationInProgress, HTTP_STATUS.conflict);
      return errorResponse(API_ERROR_CODE.idempotencyConflict, HTTP_STATUS.conflict);
    }
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
