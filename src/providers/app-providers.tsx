'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStore } from 'zustand';

import { createChatStore } from '@/store/create-chat-store';
import type { ChatStore } from '@/types/chat/store';

type StoreApi = ReturnType<typeof createChatStore>;
const ChatStoreContext = createContext<StoreApi | null>(null);
interface Props {
  children: ReactNode;
}

export const AppProviders = ({ children }: Props) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 }, mutations: { retry: false } },
      }),
  );
  const [chatStore] = useState(createChatStore);
  return (
    <QueryClientProvider client={queryClient}>
      <ChatStoreContext.Provider value={chatStore}>{children}</ChatStoreContext.Provider>
    </QueryClientProvider>
  );
};

export const useChatStore = <T,>(selector: (store: ChatStore) => T): T => {
  const store = useContext(ChatStoreContext);
  if (!store) throw new Error('Chat store provider is required');
  return useStore(store, selector);
};
