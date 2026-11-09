'use client';

import { useTranslations } from 'next-intl';
import { LoaderCircle } from 'lucide-react';

export const ChatListLoading = () => {
  const t = useTranslations('Chat');
  return (
    <div role="status" aria-label={t('loadingChats')} className="mt-8 flex justify-center">
      <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t('loadingChats')}</span>
    </div>
  );
};
