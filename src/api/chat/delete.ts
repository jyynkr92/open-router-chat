import { z } from 'zod';

export class ChatDeleteError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const deleteChat = async (chatId: string) => {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
  });
  if (response.status === 204) return;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ChatDeleteError('invalid_response');
  }
  const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
  throw new ChatDeleteError(error.success ? error.data.error.code : 'storage_error');
};
