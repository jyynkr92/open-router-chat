import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { listChats, parseChatCursor } from '@/lib/server/chat-read';

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const rawCursor = url.searchParams.get('cursor');
  const cursor = parseChatCursor(rawCursor);
  if (
    (rawCursor !== null && cursor === null) ||
    url.searchParams.getAll('cursor').length > 1 ||
    [...url.searchParams.keys()].some((key) => key !== 'cursor')
  ) {
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  }
  try {
    return Response.json({ data: await listChats(cursor) });
  } catch {
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
