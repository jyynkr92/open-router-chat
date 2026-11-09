import type { ActiveGenerationState, ResumableGeneration } from '@/types/chat/generation';
import type { ChatDetail, ChatMessage } from '@/types/chat/read';

export const getResumableGeneration = (
  detail: ChatDetail | undefined,
): ResumableGeneration | null => {
  const active = detail?.active_generation;
  if (!detail || !active) return null;
  const assistantMessage = detail.messages.find(
    (message) => message.id === active.assistant_message_id,
  );
  if (!assistantMessage) return null;
  const userMessage = detail.messages.find(
    (message) => message.sequence_no === assistantMessage.sequence_no - 1,
  );
  if (!userMessage) return null;
  return {
    chat_id: detail.chat.id,
    ...active,
    user_message_id: userMessage.id,
    user_content: userMessage.content,
  };
};

export const mergeActiveGenerationMessages = (
  messages: ChatMessage[] | undefined,
  activeGeneration: ActiveGenerationState | null,
  selectedChatId: string | null,
  isStopping = false,
): ChatMessage[] => {
  const result = (messages ?? []).filter(
    (message) =>
      message.role !== 'assistant' || message.status !== 'interrupted' || message.content !== '',
  );
  if (!activeGeneration || activeGeneration.chat_id !== selectedChatId) return result;

  const now = new Date().toISOString();
  if (!result.some((message) => message.id === activeGeneration.user_message_id))
    result.push({
      id: activeGeneration.user_message_id,
      chat_id: activeGeneration.chat_id,
      role: 'user',
      content: activeGeneration.userContent,
      status: 'completed',
      sequence_no: result.length * 2 + 1,
      generation_id: null,
      error_code: null,
      created_at: now,
      updated_at: now,
    });

  if (
    (activeGeneration.status === 'interrupted' ||
      (isStopping && activeGeneration.status === 'pending')) &&
    activeGeneration.content === ''
  )
    return result.filter((message) => message.id !== activeGeneration.assistant_message_id);

  const assistant: ChatMessage = {
    id: activeGeneration.assistant_message_id,
    chat_id: activeGeneration.chat_id,
    role: 'assistant',
    content: activeGeneration.content,
    status: activeGeneration.status,
    sequence_no: result.length * 2 + 2,
    generation_id: activeGeneration.generation_id,
    error_code: activeGeneration.errorCode,
    created_at: now,
    updated_at: now,
  };
  const existingIndex = result.findIndex((message) => message.id === assistant.id);
  if (existingIndex === -1) result.push(assistant);
  else result[existingIndex] = assistant;
  return result.sort((first, second) => first.sequence_no - second.sequence_no);
};
