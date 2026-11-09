import type { RetryGenerationInput } from '@/types/chat/generation';

import { createGenerationBranch, GenerationBranchError } from '@/lib/server/chat-generation-branch';

export class GenerationRetryError extends Error {
  constructor(
    public readonly code:
      | 'chat_not_found'
      | 'message_not_found'
      | 'deleted_request'
      | 'retry_not_allowed'
      | 'generation_in_progress'
      | 'idempotency_conflict',
  ) {
    super(code);
  }
}

export const retryGeneration = async (input: RetryGenerationInput) => {
  try {
    return await createGenerationBranch({
      ...input,
      operation: 'retry',
      allowedTargetStatuses: ['failed', 'interrupted'],
    });
  } catch (error) {
    if (error instanceof GenerationBranchError && error.code === 'operation_not_allowed')
      throw new GenerationRetryError('retry_not_allowed');
    throw error;
  }
};
