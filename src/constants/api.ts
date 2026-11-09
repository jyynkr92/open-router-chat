export const API_ERROR_CODE = {
  validation: 'validation_error',
  storage: 'storage_error',
  chatNotFound: 'chat_not_found',
  generationInProgress: 'generation_in_progress',
  idempotencyConflict: 'idempotency_conflict',
  deletedRequest: 'deleted_request',
  generationNotFound: 'generation_not_found',
  messageNotFound: 'message_not_found',
  databaseUnavailable: 'database_unavailable',
  retryNotAllowed: 'retry_not_allowed',
  regenerationNotAllowed: 'regeneration_not_allowed',
  titleNotReady: 'title_not_ready',
  titleGenerationFailed: 'title_generation_failed',
  invalidTitle: 'invalid_title',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

export const HTTP_STATUS = {
  ok: 200,
  noContent: 204,
  badRequest: 400,
  conflict: 409,
  notFound: 404,
  gone: 410,
  accepted: 202,
  serviceUnavailable: 503,
  badGateway: 502,
} as const;
