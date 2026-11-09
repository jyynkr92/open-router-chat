import type { GenerationStatus, GenerationTerminalStatus } from '@/types/chat/generation';

export const isGenerationStatus = (status: string): status is GenerationStatus =>
  status === 'pending' ||
  status === 'streaming' ||
  status === 'completed' ||
  status === 'failed' ||
  status === 'interrupted';

export const isTerminalGenerationStatus = (status: string): status is GenerationTerminalStatus =>
  status === 'completed' || status === 'failed' || status === 'interrupted';
