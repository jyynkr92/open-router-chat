import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { getChatMessages } from '@/lib/server/chat-read';
import { isUuid } from '@/lib/server/validation';

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ 'chat-id': string }> },
) => {
  const { 'chat-id': chatId } = await params;
  if (!isUuid(chatId)) return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  try {
    const result = await getChatMessages(chatId);
    if (!result) return errorResponse(API_ERROR_CODE.chatNotFound, HTTP_STATUS.notFound);
    return Response.json({ data: result });
  } catch {
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
