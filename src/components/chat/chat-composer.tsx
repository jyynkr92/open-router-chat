'use client';

import { useState, type FormEvent } from 'react';

import { ArrowUp, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useGenerationActions } from '@/components/chat/generation-controller';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/providers/app-providers';
import { isTerminalGenerationStatus } from '@/lib/generation-status';

type ChatComposerProps = {
  selectedChatId: string | null;
  replaceError: 'retry' | 'regenerate' | null;
  onSelectChat: (chatId: string | null) => void;
  onClearReplaceError: () => void;
};

export const ChatComposer = ({
  selectedChatId,
  replaceError,
  onSelectChat,
  onClearReplaceError,
}: ChatComposerProps) => {
  const t = useTranslations('Chat');
  const { startGeneration, stopActiveGeneration, reconnectActiveGeneration } =
    useGenerationActions();
  const generationStatus = useChatStore((state) =>
    state.activeGeneration?.chat_id === selectedChatId ? state.activeGeneration.status : undefined,
  );
  const connection = useChatStore((state) =>
    state.activeGeneration?.chat_id === selectedChatId
      ? state.activeGeneration.connection
      : undefined,
  );
  const isStopping = useChatStore(
    (state) => state.activeGeneration?.chat_id === selectedChatId && state.isStopping,
  );
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const isGenerationActive =
    generationStatus !== undefined && !isTerminalGenerationStatus(generationStatus);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || isSubmitting || isGenerationActive) return;
    setIsSubmitting(true);
    setSendError(null);
    setStopError(null);
    onClearReplaceError();
    try {
      const registration = await startGeneration({ chatId: selectedChatId, content });
      setInput('');
      onSelectChat(registration.chat_id);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'storage_error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = async () => {
    try {
      setStopError(null);
      await stopActiveGeneration();
    } catch (error) {
      setStopError(error instanceof Error ? error.message : 'storage_error');
    }
  };

  return (
    <section className="w-full px-4 pb-5 pt-2 sm:px-8 sm:pb-8">
      <form className="mx-auto w-full max-w-3xl" onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="chat-input" className="sr-only">
          {t('placeholder')}
        </label>
        <div className="rounded-3xl border bg-background p-2 shadow-xl shadow-primary/5 transition focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15">
          <Textarea
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={t('placeholder')}
            className="max-h-60 min-h-14 resize-none border-0 bg-transparent px-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
            disabled={isSubmitting || isGenerationActive}
          />
          <div className="flex items-center justify-between gap-2 pb-1 pr-1 pl-3">
            <p className="hidden text-[11px] text-muted-foreground sm:block">{t('composerHint')}</p>
            {isGenerationActive ? (
              <Button
                type="button"
                size="icon"
                disabled={isStopping}
                aria-busy={isStopping}
                onClick={() => void handleStop()}
                aria-label={t('stop')}
                title={t('stop')}
                className="ml-auto rounded-full active:bg-primary/80"
              >
                <Square />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={isSubmitting || input.trim().length === 0}
                aria-label={t('send')}
                title={t('send')}
                className="ml-auto rounded-full active:bg-primary/80"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        {sendError && (
          <p role="alert" className="mt-2 text-center text-xs text-destructive">
            {t('sendError')}
          </p>
        )}
        {stopError && (
          <p role="alert" className="mt-2 text-center text-xs text-destructive">
            {t('stopError')}
          </p>
        )}
        {replaceError && (
          <p role="alert" className="mt-2 text-center text-xs text-destructive">
            {t(replaceError === 'regenerate' ? 'regenerateError' : 'retryError')}
          </p>
        )}
        {connection === 'error' && (
          <div
            role="alert"
            className="mt-2 flex items-center justify-center gap-2 text-xs text-destructive"
          >
            <p>{t('streamError')}</p>
            <Button type="button" variant="outline" size="sm" onClick={reconnectActiveGeneration}>
              {t('reconnect')}
            </Button>
          </div>
        )}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {isStopping ? t('stopping') : connection === 'error' ? t('streamError') : ''}
          {generationStatus && connection !== 'error' ? t(`status.${generationStatus}`) : ''}
        </p>
      </form>
    </section>
  );
};
