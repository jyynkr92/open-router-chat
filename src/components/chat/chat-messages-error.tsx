'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

interface ChatMessagesErrorProps {
  onRetry: () => void;
}

export const ChatMessagesError = ({ onRetry }: ChatMessagesErrorProps) => {
  const t = useTranslations('Chat');
  return (
    <div className="flex min-h-48 flex-col items-center justify-center text-center">
      <p role="alert">{t('loadMessagesError')}</p>
      <Button variant="outline" className="mt-2" onClick={onRetry}>
        {t('retryLoad')}
      </Button>
    </div>
  );
};
