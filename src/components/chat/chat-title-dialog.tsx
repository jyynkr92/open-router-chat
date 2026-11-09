'use client';

import { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: (title: string) => Promise<void>;
}

export const ChatTitleDialog = ({ open, title, onOpenChange, onSave }: Props) => {
  const t = useTranslations('Chat');
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(title);
    setError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, title]);

  const handleSave = async () => {
    const nextTitle = value.trim();
    if (!nextTitle || nextTitle.length > 100 || /[\r\n]/.test(nextTitle)) {
      setError('invalid_title');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(nextTitle);
      onOpenChange(false);
    } catch {
      setError('save_error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} title={t('editTitle')} onOpenChange={onOpenChange}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
        className="space-y-4"
      >
        <label htmlFor="chat-title-input" className="sr-only">
          {t('editTitle')}
        </label>
        <input
          ref={inputRef}
          id="chat-title-input"
          value={value}
          maxLength={100}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? 'chat-title-error' : undefined}
          onChange={(event) => setValue(event.target.value)}
          className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
        />
        {error && (
          <p id="chat-title-error" role="alert" className="text-xs text-destructive">
            {error === 'invalid_title' ? t('invalidTitle') : t('saveTitleError')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? t('savingTitle') : t('saveTitle')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
