import { z } from 'zod';

import { readChatJson } from '@/api/chat/read-json';
import type { ChatDetail, ChatList } from '@/types/chat/read';

const chatSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  title_source: z.string(),
  title_status: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
const messageSchema = z.object({
  id: z.uuid(),
  chat_id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: z.enum(['pending', 'streaming', 'completed', 'failed', 'interrupted']),
  sequence_no: z.number().int().positive(),
  generation_id: z.uuid().nullable(),
  error_code: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
const listSchema = z.object({
  data: z.object({ items: z.array(chatSchema), next_cursor: z.string().nullable() }),
});
const detailSchema = z.object({
  data: z.object({
    chat: chatSchema,
    messages: z.array(messageSchema),
    active_generation: z
      .object({
        generation_id: z.uuid(),
        assistant_message_id: z.uuid(),
        content: z.string(),
        status: z.enum(['pending', 'streaming']),
        last_event_seq: z.string().regex(/^\d+$/),
      })
      .nullable(),
  }),
});

export class ChatReadError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const fetchChats = async (cursor: string | null): Promise<ChatList> => {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await fetch(`/api/chats${query}`);
  const result = listSchema.safeParse(await readChatJson(response, ChatReadError));
  if (!result.success) throw new ChatReadError('invalid_response');
  return result.data.data;
};

export const fetchChatMessages = async (chatId: string): Promise<ChatDetail> => {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`);
  const result = detailSchema.safeParse(await readChatJson(response, ChatReadError));
  if (!result.success) throw new ChatReadError('invalid_response');
  return result.data.data;
};
