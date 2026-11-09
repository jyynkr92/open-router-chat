import type { ActiveGenerationState } from '@/types/chat/generation';

export type ChatState = { selectedChatId: string | null };
export type GenerationState = {
  activeGeneration: ActiveGenerationState | null;
  isStopping: boolean;
};
export type ChatActions = {
  selectChat: (chatId: string | null) => void;
  setActiveGeneration: (generation: ActiveGenerationState | null) => void;
  setIsStopping: (isStopping: boolean) => void;
};
export type ChatStore = ChatState & GenerationState & { actions: ChatActions };
