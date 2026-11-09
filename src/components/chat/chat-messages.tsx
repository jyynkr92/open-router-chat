'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ChatMessagesError } from '@/components/chat/chat-messages-error';
import { ChatMessagesLoading } from '@/components/chat/chat-messages-loading';
import { ChatMessageItem } from '@/components/chat/chat-message-item';
import { Button } from '@/components/ui/button';
import { useGenerationActions } from '@/components/chat/generation-controller';
import { CHAT_MODEL } from '@/constants/chat';
import { mergeActiveGenerationMessages } from '@/lib/chat/generation-view';
import { isTerminalGenerationStatus } from '@/lib/generation-status';
import { useChatStore } from '@/providers/app-providers';
import type { ChatDetail } from '@/types/chat/read';

type ChatMessagesProps = {
  selectedChatId: string | null;
  detail: ChatDetail | undefined;
  isPending: boolean;
  isError: boolean;
  isTitleRetrying: boolean;
  onRetryMessages: () => void;
  onEditTitle: (chatId: string, title: string) => void;
  onRetryTitle: () => void;
  onReplaceError: (operation: 'retry' | 'regenerate' | null) => void;
};

export const ChatMessages = ({
  selectedChatId,
  detail,
  isPending,
  isError,
  isTitleRetrying,
  onRetryMessages,
  onEditTitle,
  onRetryTitle,
  onReplaceError,
}: ChatMessagesProps) => {
  const t = useTranslations('Chat');
  const { retryActiveGeneration, regenerateActiveGeneration } = useGenerationActions();
  const activeGeneration = useChatStore((state) =>
    state.activeGeneration?.chat_id === selectedChatId ? state.activeGeneration : null,
  );
  const isStopping = useChatStore(
    (state) => state.activeGeneration?.chat_id === selectedChatId && state.isStopping,
  );
  const [replacingMessageId, setReplacingMessageId] = useState<string | null>(null);
  const messagesRef = useRef<HTMLElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const displayMessages = mergeActiveGenerationMessages(
    detail?.messages,
    activeGeneration,
    selectedChatId,
    isStopping,
  );
  const displayMessagesRef = useRef(displayMessages);
  displayMessagesRef.current = displayMessages;
  const generationContent = activeGeneration?.content;
  const messageCount = detail?.messages.length;
  const isGenerationActive =
    activeGeneration !== null && !isTerminalGenerationStatus(activeGeneration.status);

  const handleReplace = useCallback(
    async (messageId: string, sequenceNo: number, operation: 'retry' | 'regenerate') => {
      if (!selectedChatId || replacingMessageId || isGenerationActive) return;
      const currentMessages = displayMessagesRef.current;
      const userMessage = currentMessages.find(
        (message) => message.role === 'user' && message.sequence_no === sequenceNo - 1,
      );
      if (!userMessage) return;
      const hasFollowingMessages = currentMessages.some(
        (message) => message.sequence_no > sequenceNo,
      );
      if (
        hasFollowingMessages &&
        !window.confirm(
          t(operation === 'regenerate' ? 'regenerateDeletesFollowing' : 'retryDeletesFollowing'),
        )
      )
        return;
      setReplacingMessageId(messageId);
      onReplaceError(null);
      try {
        const replace = operation === 'retry' ? retryActiveGeneration : regenerateActiveGeneration;
        await replace({
          chatId: selectedChatId,
          messageId,
          userContent: userMessage.content,
        });
      } catch {
        onReplaceError(operation);
      } finally {
        setReplacingMessageId(null);
      }
    },
    [
      isGenerationActive,
      onReplaceError,
      regenerateActiveGeneration,
      replacingMessageId,
      retryActiveGeneration,
      selectedChatId,
      t,
    ],
  );

  const handleMessagesScroll = () => {
    const element = messagesRef.current;
    if (!element) return;
    shouldStickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= 64;
  };

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    if (selectedChatId === null) return;
    const frame = requestAnimationFrame(() => {
      const element = messagesRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedChatId]);

  useEffect(() => {
    const element = messagesRef.current;
    if (generationContent === undefined && messageCount === undefined) return;
    if (!element || !shouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [generationContent, messageCount]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/80 px-5 backdrop-blur sm:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">
            {detail?.chat.title ?? t('title')}
          </span>
          {selectedChatId && detail && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('editTitle')}
              title={t('editTitle')}
              onClick={() => onEditTitle(selectedChatId, detail.chat.title)}
              className="active:bg-accent/80"
            >
              <Pencil />
            </Button>
          )}
          {detail?.chat.title_status === 'failed' && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={isTitleRetrying ? t('retryingTitle') : t('retryTitle')}
              title={t('retryTitle')}
              disabled={isTitleRetrying}
              onClick={onRetryTitle}
              className="active:bg-accent/80"
            >
              <RotateCcw className={isTitleRetrying ? 'animate-spin' : undefined} />
            </Button>
          )}
        </div>
        <span className="hidden shrink-0 rounded-full border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:inline">
          {CHAT_MODEL}
        </span>
      </header>
      {selectedChatId === null && (
        <section className="relative flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden px-6 py-20 text-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
          />
          <div className="relative mb-2 flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30">
            <Sparkles className="size-7" aria-hidden="true" />
          </div>
          <h1 className="relative text-3xl font-semibold tracking-tight">{t('description')}</h1>
          <p className="relative max-w-sm text-sm text-muted-foreground">{t('descriptionHint')}</p>
        </section>
      )}
      {selectedChatId !== null && (
        <section
          ref={messagesRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8"
          aria-label={t('messages')}
          onScroll={handleMessagesScroll}
        >
          <div className="mx-auto w-full max-w-3xl space-y-8 py-8">
            {isPending && <ChatMessagesLoading />}
            {isError && <ChatMessagesError onRetry={onRetryMessages} />}
            {detail && displayMessages.length === 0 && (
              <p className="py-20 text-center text-sm text-muted-foreground">
                {t('emptyMessages')}
              </p>
            )}
            {displayMessages.map((message) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                replacingMessageId={replacingMessageId}
                isGenerationActive={isGenerationActive}
                onReplace={handleReplace}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
};
