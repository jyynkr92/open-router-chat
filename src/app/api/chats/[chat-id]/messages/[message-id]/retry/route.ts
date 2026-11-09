import { z } from 'zod';

import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { GenerationBranchError } from '@/lib/server/chat-generation-branch';
import { GenerationRetryError, retryGeneration } from '@/lib/server/chat-retry';

const requestSchema = z.object({ client_request_id: z.uuid() }).strict();
const uuidSchema = z.uuid();

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ 'chat-id': string; 'message-id': string }> },
) => {
  const { 'chat-id': chatId, 'message-id': messageId } = await params;
  if (!uuidSchema.safeParse(chatId).success || !uuidSchema.safeParse(messageId).success)
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);

  try {
    const result = await retryGeneration({
      clientRequestId: parsed.data.client_request_id,
      chatId,
      messageId,
    });
    return Response.json({ data: result.data }, { status: result.isDuplicate ? 200 : 202 });
  } catch (error) {
    if (error instanceof GenerationRetryError || error instanceof GenerationBranchError) {
      if (error.code === 'chat_not_found' || error.code === 'message_not_found')
        return errorResponse(
          error.code === 'chat_not_found'
            ? API_ERROR_CODE.chatNotFound
            : API_ERROR_CODE.messageNotFound,
          HTTP_STATUS.notFound,
        );
      if (error.code === 'deleted_request')
        return errorResponse(API_ERROR_CODE.deletedRequest, HTTP_STATUS.gone);
      if (error.code === 'generation_in_progress' || error.code === 'retry_not_allowed')
        return errorResponse(
          error.code === 'generation_in_progress'
            ? API_ERROR_CODE.generationInProgress
            : API_ERROR_CODE.retryNotAllowed,
          HTTP_STATUS.conflict,
        );
      return errorResponse(API_ERROR_CODE.idempotencyConflict, HTTP_STATUS.conflict);
    }
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
