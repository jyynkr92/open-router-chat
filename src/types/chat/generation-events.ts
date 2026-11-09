import type { GenerationStatus } from '@/types/chat/generation';

export type GenerationSnapshot = {
  generation_id: string;
  assistant_message_id: string;
  content: string;
  status: GenerationStatus;
  last_event_seq: string;
};

export type GenerationRouteContext = {
  params: Promise<{ 'generation-id': string }>;
};

export type GenerationEvent = {
  generation_id: string;
  assistant_message_id: string;
  event_seq: string;
  event_type: 'delta' | 'completed' | 'interrupted' | 'error';
  text?: string;
  status?: GenerationStatus;
  content?: string;
  error_code?: string;
};
