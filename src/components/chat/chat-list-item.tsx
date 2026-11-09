'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { ChatListItem as ChatListItemType } from '@/types/chat/read';

interface Props {
  chat: ChatListItemType;
  isSelected: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const ChatListItem = ({
  chat,
  isSelected,
  isDisabled,
  onSelect,
  onEdit,
  onDelete,
}: Props) => {
  const t = useTranslations('Chat');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleMenuAction = (action: () => void) => {
    setIsMenuOpen(false);
    menuButtonRef.current?.focus();
    action();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (currentIndex + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div
      data-selected={isSelected}
      className="group relative flex min-w-0 items-center gap-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-accent/70 active:bg-accent data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[selected=true]:font-medium"
    >
      <Button
        type="button"
        variant="ghost"
        aria-current={isSelected ? 'page' : undefined}
        onClick={onSelect}
        className="min-w-0 flex-1 justify-start overflow-hidden px-2 py-2 text-left font-[inherit] hover:bg-transparent active:bg-transparent"
      >
        <span className="block min-w-0 truncate">{chat.title}</span>
      </Button>
      <div ref={menuRef} className="relative shrink-0">
        <Button
          ref={menuButtonRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('chatMenu')}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-controls={`chat-menu-${chat.id}`}
          title={t('chatMenu')}
          onClick={() => setIsMenuOpen((value) => !value)}
          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground data-[state=open]:opacity-100 focus-visible:bg-accent focus-visible:text-accent-foreground"
          data-state={isMenuOpen ? 'open' : 'closed'}
        >
          <MoreHorizontal />
        </Button>
        {isMenuOpen && (
          <div
            id={`chat-menu-${chat.id}`}
            role="menu"
            aria-label={t('chatMenu')}
            onKeyDown={handleMenuKeyDown}
            className="absolute right-0 top-9 z-20 w-36 rounded-xl border bg-background p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent active:bg-accent/80 focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => handleMenuAction(onEdit)}
            >
              <Pencil className="size-4" />
              {t('editTitle')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isDisabled}
              className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm text-destructive hover:bg-destructive/10 active:bg-destructive/20 focus-visible:bg-destructive/10 focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => handleMenuAction(onDelete)}
            >
              <Trash2 className="size-4" />
              {t('deleteChat')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
