import { z } from 'zod';

type ChatApiErrorConstructor = new (code: string) => Error;

const errorResponseSchema = z.object({ error: z.object({ code: z.string() }) });

export const readChatJson = async (
  response: Response,
  ErrorType: ChatApiErrorConstructor,
): Promise<unknown> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ErrorType('invalid_response');
  }
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(body);
    throw new ErrorType(error.success ? error.data.error.code : 'storage_error');
  }
  return body;
};
