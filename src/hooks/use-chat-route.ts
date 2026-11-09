'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useChatStore } from '@/providers/app-providers';

const readChatId = () => {
  const pathname = new URL(window.location.href).pathname;
  const match = pathname.match(/^\/chats\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
};

export const useChatRoute = () => {
  const selectedChatId = useChatStore((state) => state.selectedChatId);
  const selectChat = useChatStore((state) => state.actions.selectChat);
  const isReadyRef = useRef(false);

  useEffect(() => {
    const syncFromUrl = () => {
      selectChat(readChatId());
      isReadyRef.current = true;
    };
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [selectChat]);

  const selectChatAndUpdateUrl = useCallback(
    (chatId: string | null) => {
      selectChat(chatId);
      if (!isReadyRef.current) return;
      const pathname = chatId ? `/chats/${encodeURIComponent(chatId)}` : '/';
      window.history.pushState({ chat_id: chatId }, '', pathname);
    },
    [selectChat],
  );

  return { selectedChatId, selectChat: selectChatAndUpdateUrl };
};
