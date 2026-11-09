import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { GenerationReadError, getGenerationSnapshot } from '@/lib/server/generation-events';
import { isUuid } from '@/lib/server/validation';
import type { GenerationRouteContext } from '@/types/chat/generation-events';

export const GET = async (_request: Request, { params }: GenerationRouteContext) => {
  const { 'generation-id': generationId } = await params;
  if (!isUuid(generationId))
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  try {
    return Response.json({ data: await getGenerationSnapshot(generationId) });
  } catch (error) {
    if (error instanceof GenerationReadError) {
      return errorResponse(
        error.code === 'deleted_request'
          ? API_ERROR_CODE.deletedRequest
          : API_ERROR_CODE.generationNotFound,
        error.code === 'deleted_request' ? HTTP_STATUS.gone : HTTP_STATUS.notFound,
      );
    }
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
