import { randomUUID } from 'node:crypto';

import type { ApiErrorCode } from '@/constants/api';

export const errorResponse = (code: ApiErrorCode, status: number, retryable = false) =>
  Response.json({ error: { code, retryable, request_id: randomUUID() } }, { status });
