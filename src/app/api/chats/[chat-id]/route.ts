import { z } from 'zod';

import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { deleteChat } from '@/lib/server/chat-delete';
import { ChatTitleUpdateError, updateChatTitle } from '@/lib/server/chat-title-update';
import { database } from '@/lib/server/database';
import { isUuid } from '@/lib/server/validation';

const requestSchema = z.object({ title: z.string() }).strict();

export const PATCH = async (
  request: Request,
  { params }: { params: Promise<{ 'chat-id': string }> },
) => {
  const { 'chat-id': chatId } = await params;
  if (!isUuid(chatId)) return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  try {
    const result = await updateChatTitle({ client: database, chatId, title: parsed.data.title });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof ChatTitleUpdateError) {
      return errorResponse(
        error.code === 'chat_not_found' ? API_ERROR_CODE.chatNotFound : API_ERROR_CODE.invalidTitle,
        error.code === 'chat_not_found' ? HTTP_STATUS.notFound : HTTP_STATUS.badRequest,
      );
    }
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ 'chat-id': string }> },
) => {
  const { 'chat-id': chatId } = await params;
  if (!isUuid(chatId)) return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  try {
    await deleteChat(database, chatId);
    return new Response(null, { status: HTTP_STATUS.noContent });
  } catch {
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
