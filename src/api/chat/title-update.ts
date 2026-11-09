import { z } from 'zod';

const responseSchema = z.object({
  data: z.object({
    chat_id: z.uuid(),
    title: z.string(),
    title_source: z.string(),
    title_status: z.string(),
  }),
});

export class ChatTitleUpdateError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const updateChatTitle = async (chatId: string, title: string) => {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ChatTitleUpdateError('invalid_response');
  }
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
    throw new ChatTitleUpdateError(error.success ? error.data.error.code : 'storage_error');
  }
  const result = responseSchema.safeParse(body);
  if (!result.success) throw new ChatTitleUpdateError('invalid_response');
  return result.data.data;
};
