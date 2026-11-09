export type ChatListItem = {
  id: string;
  title: string;
  title_source: string;
  title_status: string;
  created_at: string;
  updated_at: string;
};

export type ChatList = {
  items: ChatListItem[];
  next_cursor: string | null;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  status: GenerationStatus;
  sequence_no: number;
  generation_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type ActiveGeneration = {
  generation_id: string;
  assistant_message_id: string;
  content: string;
  status: 'pending' | 'streaming';
  last_event_seq: string;
};

export type ChatDetail = {
  chat: ChatListItem;
  messages: ChatMessage[];
  active_generation: ActiveGeneration | null;
};
import type { GenerationStatus } from '@/types/chat/generation';
