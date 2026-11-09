'use client';

import { memo } from 'react';

import { LoaderCircle, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AnswerCopyButton } from '@/components/chat/answer-copy-button';
import { LoadingDots } from '@/components/chat/loading-dots';
import { MarkdownAnswer } from '@/components/chat/markdown-answer';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/ui/icon-tooltip';
import type { ChatMessage } from '@/types/chat/read';

type ChatMessageItemProps = {
  message: ChatMessage;
  replacingMessageId: string | null;
  isGenerationActive: boolean;
  onReplace: (messageId: string, sequenceNo: number, operation: 'retry' | 'regenerate') => void;
};

export const ChatMessageItem = memo(
  ({ message, replacingMessageId, isGenerationActive, onReplace }: ChatMessageItemProps) => {
    const t = useTranslations('Chat');
    const isAssistant = message.role === 'assistant';
    const isReplaceable =
      message.status === 'completed' ||
      message.status === 'failed' ||
      message.status === 'interrupted';
    const actionLabel = message.status === 'completed' ? t('regenerate') : t('retry');

    return (
      <article className="w-full">
        {isAssistant ? (
          <div className="flex gap-3">
            <div
              aria-hidden="true"
              className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary to-fuchsia-500 text-white"
            >
              <Sparkles className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              {message.content ? (
                <>
                  <MarkdownAnswer content={message.content} />
                  {message.status === 'streaming' && (
                    <span
                      aria-hidden="true"
                      className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle"
                    />
                  )}
                </>
              ) : (
                <div
                  className="text-sm text-muted-foreground"
                  role="status"
                  aria-label={t('pending')}
                >
                  <LoadingDots label={t('pending')} />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm leading-7 text-secondary-foreground">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        )}
        {isAssistant && isReplaceable && (
          <div className="mt-1.5 flex items-center gap-0.5 pl-9">
            {message.content && <AnswerCopyButton content={message.content} />}
            <IconTooltip label={actionLabel}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={replacingMessageId !== null || isGenerationActive}
                aria-busy={replacingMessageId === message.id}
                aria-label={replacingMessageId === message.id ? t('regenerating') : actionLabel}
                title={actionLabel}
                onClick={() =>
                  onReplace(
                    message.id,
                    message.sequence_no,
                    message.status === 'completed' ? 'regenerate' : 'retry',
                  )
                }
                className="active:bg-accent/80"
              >
                {replacingMessageId === message.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
              </Button>
            </IconTooltip>
          </div>
        )}
      </article>
    );
  },
  (previous, next) => {
    if (previous.message.role === 'user' && next.message.role === 'user')
      return (
        previous.message.id === next.message.id &&
        previous.message.content === next.message.content &&
        previous.message.status === next.message.status
      );
    return (
      previous.message === next.message &&
      previous.replacingMessageId === next.replacingMessageId &&
      previous.isGenerationActive === next.isGenerationActive &&
      previous.onReplace === next.onReplace
    );
  },
);

ChatMessageItem.displayName = 'ChatMessageItem';
