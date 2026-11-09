import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { TitleGenerationError, generateChatTitle } from '@/lib/server/chat-title';
import { database } from '@/lib/server/database';
import { createOpenRouterClient } from '@/lib/server/openrouter';
import { isUuid } from '@/lib/server/validation';

export const POST = async (
  _request: Request,
  { params }: { params: Promise<{ 'chat-id': string }> },
) => {
  const { 'chat-id': chatId } = await params;
  if (!isUuid(chatId)) return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  try {
    const result = await generateChatTitle({
      client: database,
      openRouter: createOpenRouterClient(),
      chatId,
    });
    return Response.json(
      { data: result },
      {
        status: result.title_status === 'generating' ? HTTP_STATUS.accepted : HTTP_STATUS.ok,
      },
    );
  } catch (error) {
    if (error instanceof TitleGenerationError) {
      if (error.code === 'chat_not_found')
        return errorResponse(API_ERROR_CODE.chatNotFound, HTTP_STATUS.notFound);
      if (error.code === 'title_not_ready' || error.code === 'title_in_progress')
        return errorResponse(API_ERROR_CODE.titleNotReady, HTTP_STATUS.conflict);
      return errorResponse(API_ERROR_CODE.titleGenerationFailed, HTTP_STATUS.badGateway, true);
    }
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
