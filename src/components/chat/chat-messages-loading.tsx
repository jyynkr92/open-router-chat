'use client';

import { useTranslations } from 'next-intl';

import { LoaderCircle } from 'lucide-react';

export const ChatMessagesLoading = () => {
  const t = useTranslations('Chat');
  return (
    <div
      role="status"
      aria-label={t('loadingMessages')}
      className="flex items-center justify-center py-12 text-sm text-muted-foreground"
    >
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">{t('loadingMessages')}</span>
    </div>
  );
};
