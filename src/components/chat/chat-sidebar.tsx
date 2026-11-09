'use client';

import { Plus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ChatListError } from '@/components/chat/chat-list-error';
import { ChatListItem } from '@/components/chat/chat-list-item';
import { ChatListLoading } from '@/components/chat/chat-list-loading';
import { Button } from '@/components/ui/button';
import { useChats } from '@/hooks/use-chat-read';

type ChatSidebarProps = {
  selectedChatId: string | null;
  deletingChatId: string | null;
  deleteErrorChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onEditChat: (chatId: string, title: string) => void;
  onDeleteChat: (chatId: string) => void;
};

export const ChatSidebar = ({
  selectedChatId,
  deletingChatId,
  deleteErrorChatId,
  onNewChat,
  onSelectChat,
  onEditChat,
  onDeleteChat,
}: ChatSidebarProps) => {
  const t = useTranslations('Chat');
  const common = useTranslations('Common');
  const chats = useChats();
  const items = chats.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r bg-sidebar px-3 py-4"
      aria-label={t('chatList')}
    >
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25">
          <Sparkles className="size-4" aria-hidden="true" />
        </div>
        <p className="text-[15px] font-semibold tracking-tight">{common('appName')}</p>
      </div>
      <Button
        className="h-10 w-full justify-start rounded-xl shadow-sm shadow-primary/20"
        onClick={onNewChat}
      >
        <Plus />
        {t('newChat')}
      </Button>
      {chats.isPending && <ChatListLoading />}
      {chats.isError && <ChatListError onRetry={() => void chats.refetch()} />}
      {chats.isSuccess && items.length === 0 && (
        <p className="mt-8 px-2 text-xs text-muted-foreground">{t('emptyList')}</p>
      )}
      <nav className="mt-5 min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label={t('chatList')}>
        {items.map((chat) => (
          <ChatListItem
            key={chat.id}
            chat={chat}
            isSelected={selectedChatId === chat.id}
            isDisabled={deletingChatId !== null}
            onSelect={() => onSelectChat(chat.id)}
            onEdit={() => onEditChat(chat.id, chat.title)}
            onDelete={() => onDeleteChat(chat.id)}
          />
        ))}
      </nav>
      {deleteErrorChatId && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t('deleteError')}
        </p>
      )}
      {chats.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full"
          disabled={chats.isFetchingNextPage}
          onClick={() => void chats.fetchNextPage()}
        >
          {chats.isFetchingNextPage ? t('loadingChats') : t('loadMore')}
        </Button>
      )}
      {chats.isFetchNextPageError && (
        <p role="alert" className="mt-2 text-xs">
          {t('loadChatsError')}
        </p>
      )}
    </aside>
  );
};
