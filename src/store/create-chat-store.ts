import { createStore } from 'zustand/vanilla';

import type { ChatStore } from '@/types/chat/store';

export const createChatStore = () =>
  createStore<ChatStore>()((set) => ({
    selectedChatId: null,
    activeGeneration: null,
    isStopping: false,
    actions: {
      selectChat: (selectedChatId) => set({ selectedChatId }),
      setActiveGeneration: (activeGeneration) => set({ activeGeneration }),
      setIsStopping: (isStopping) => set({ isStopping }),
    },
  }));
