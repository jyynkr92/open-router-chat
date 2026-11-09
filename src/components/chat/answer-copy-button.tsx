'use client';

import { useEffect, useState } from 'react';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/ui/icon-tooltip';
import type { CopyStatus } from '@/types/chat/copy-status';

interface Props {
  content: string;
}

export const AnswerCopyButton = ({ content }: Props) => {
  const t = useTranslations('Common');
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timeout = window.setTimeout(() => setCopyStatus('idle'), 3000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <IconTooltip label={t(copyStatus === 'copied' ? 'copied' : 'copy')}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t(copyStatus === 'copied' ? 'copied' : 'copy')}
        title={t(copyStatus === 'copied' ? 'copied' : 'copy')}
        onClick={() => void handleCopy()}
      >
        {copyStatus === 'copied' ? <Check className="text-emerald-600" /> : <Copy />}
      </Button>
      {copyStatus === 'failed' && (
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {t('copyError')}
        </span>
      )}
    </IconTooltip>
  );
};
