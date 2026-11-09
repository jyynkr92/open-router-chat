import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { fetchChatMessages, fetchChats } from '@/api/chat/read';

export const useChats = () =>
  useInfiniteQuery({
    queryKey: ['chats'],
    queryFn: ({ pageParam }) => fetchChats(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });

export const useChatMessages = (chatId: string | null) =>
  useQuery({
    queryKey: ['chat-messages', chatId],
    queryFn: () => {
      if (chatId === null) throw new Error('chatId is required');
      return fetchChatMessages(chatId);
    },
    enabled: chatId !== null,
  });
