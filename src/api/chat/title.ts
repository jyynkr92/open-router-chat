import { z } from 'zod';

const titleResponseSchema = z.object({
  data: z.object({
    chat_id: z.uuid(),
    title: z.string(),
    title_source: z.string(),
    title_status: z.string(),
  }),
});

export class ChatTitleError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const requestChatTitle = async (chatId: string) => {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/title`, {
    method: 'POST',
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ChatTitleError('invalid_response');
  }
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
    throw new ChatTitleError(error.success ? error.data.error.code : 'storage_error');
  }
  const result = titleResponseSchema.safeParse(body);
  if (!result.success) throw new ChatTitleError('invalid_response');
  return result.data.data;
};
