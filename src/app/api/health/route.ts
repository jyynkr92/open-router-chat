import { API_ERROR_CODE, HTTP_STATUS } from '@/constants/api';
import { errorResponse } from '@/lib/server/api-response';
import { database } from '@/lib/server/database';

export const GET = async () => {
  try {
    await database.$queryRaw`SELECT 1`;
    return Response.json({ data: { status: 'ok', database: 'connected' } });
  } catch {
    return errorResponse(API_ERROR_CODE.databaseUnavailable, HTTP_STATUS.serviceUnavailable, true);
  }
};
