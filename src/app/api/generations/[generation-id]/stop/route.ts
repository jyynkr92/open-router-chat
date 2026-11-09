import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { GenerationStopError, stopGeneration } from '@/lib/server/generation-stop';
import { isUuid } from '@/lib/server/validation';
import type { GenerationRouteContext } from '@/types/chat/generation-events';

export const POST = async (_request: Request, { params }: GenerationRouteContext) => {
  const { 'generation-id': generationId } = await params;
  if (!isUuid(generationId))
    return errorResponse(API_ERROR_CODE.validation, HTTP_STATUS.badRequest);
  try {
    const result = await stopGeneration(generationId);
    return Response.json(
      { data: result },
      { status: result.stop_requested ? HTTP_STATUS.accepted : HTTP_STATUS.ok },
    );
  } catch (error) {
    if (error instanceof GenerationStopError)
      return errorResponse(API_ERROR_CODE.generationNotFound, HTTP_STATUS.notFound);
    return errorResponse(API_ERROR_CODE.storage, HTTP_STATUS.serviceUnavailable, true);
  }
};
