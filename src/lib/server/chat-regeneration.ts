import type { RegenerateGenerationInput } from '@/types/chat/generation';

import { createGenerationBranch, GenerationBranchError } from '@/lib/server/chat-generation-branch';

export class GenerationRegenerationError extends Error {
  constructor(
    public readonly code:
      | 'chat_not_found'
      | 'message_not_found'
      | 'deleted_request'
      | 'regeneration_not_allowed'
      | 'generation_in_progress'
      | 'idempotency_conflict',
  ) {
    super(code);
  }
}

export const regenerateGeneration = async (input: RegenerateGenerationInput) => {
  try {
    return await createGenerationBranch({
      ...input,
      operation: 'regenerate',
      allowedTargetStatuses: ['completed'],
    });
  } catch (error) {
    if (error instanceof GenerationBranchError && error.code === 'operation_not_allowed')
      throw new GenerationRegenerationError('regeneration_not_allowed');
    throw error;
  }
};
