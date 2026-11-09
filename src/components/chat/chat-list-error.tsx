'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

interface ChatListErrorProps {
  onRetry: () => void;
}

export const ChatListError = ({ onRetry }: ChatListErrorProps) => {
  const t = useTranslations('Chat');
  return (
    <div className="mt-8 flex flex-col items-center text-center text-xs">
      <p role="alert">{t('loadChatsError')}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
        {t('retryLoad')}
      </Button>
    </div>
  );
};
