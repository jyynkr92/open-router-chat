import { z } from 'zod';

import type { GenerationStatus } from '@/types/chat/generation';

export const generationStatusSchema = z.enum([
  'pending',
  'streaming',
  'completed',
  'failed',
  'interrupted',
]) satisfies z.ZodType<GenerationStatus>;
