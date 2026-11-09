'use client';

import { useState } from 'react';

import { LoaderCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { deleteChat } from '@/api/chat/delete';
import { requestChatTitle } from '@/api/chat/title';
import { updateChatTitle } from '@/api/chat/title-update';
import { ChatComposer } from '@/components/chat/chat-composer';
import { GenerationController } from '@/components/chat/generation-controller';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { ChatTitleDialog } from '@/components/chat/chat-title-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useChatMessages } from '@/hooks/use-chat-read';
import { useChatRoute } from '@/hooks/use-chat-route';
import { getResumableGeneration } from '@/lib/chat/generation-view';

export const ChatWorkspace = () => {
  const t = useTranslations('Chat');
  const queryClient = useQueryClient();
  const { selectedChatId, selectChat } = useChatRoute();
  const detail = useChatMessages(selectedChatId);
  const resumableGeneration = getResumableGeneration(detail.data);
  const [replaceError, setReplaceError] = useState<'retry' | 'regenerate' | null>(null);
  const [isTitleRetrying, setIsTitleRetrying] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [deleteDialogChatId, setDeleteDialogChatId] = useState<string | null>(null);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [deleteErrorChatId, setDeleteErrorChatId] = useState<string | null>(null);
  const [composerResetKey, setComposerResetKey] = useState(0);

  const handleNewChatClick = () => {
    selectChat(null);
    setComposerResetKey((key) => key + 1);
    setReplaceError(null);
    setEditingChatId(null);
  };

  const handleTitleRetry = async () => {
    if (!selectedChatId || isTitleRetrying) return;
    setIsTitleRetrying(true);
    try {
      await requestChatTitle(selectedChatId);
    } catch {
      // The failed title state remains visible so the user can retry again.
    } finally {
      setIsTitleRetrying(false);
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      await queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedChatId] });
    }
  };

  const handleStartTitleEdit = (chatId: string, title: string) => {
    setEditingChatId(chatId);
    setEditingTitle(title);
  };

  const handleSaveTitle = async (title: string) => {
    if (!editingChatId) return;
    try {
      await updateChatTitle(editingChatId, title);
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      await queryClient.invalidateQueries({ queryKey: ['chat-messages', editingChatId] });
    } catch (error) {
      throw error instanceof Error ? error : new Error('storage_error');
    }
  };

  const handleDeleteChat = (chatId: string) => {
    setDeleteErrorChatId(null);
    setDeleteDialogChatId(chatId);
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialogChatId || deletingChatId) return;
    const chatId = deleteDialogChatId;
    setDeletingChatId(chatId);
    setDeleteErrorChatId(null);
    try {
      await deleteChat(chatId);
      await queryClient.cancelQueries({ queryKey: ['chat-messages', chatId] });
      queryClient.removeQueries({ queryKey: ['chat-messages', chatId] });
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (selectedChatId === chatId) {
        setEditingChatId(null);
        selectChat(null);
      }
      setDeleteDialogChatId(null);
    } catch {
      setDeleteErrorChatId(chatId);
    } finally {
      setDeletingChatId(null);
    }
  };

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-foreground">
      <ChatSidebar
        selectedChatId={selectedChatId}
        deletingChatId={deletingChatId}
        deleteErrorChatId={deleteErrorChatId}
        onNewChat={handleNewChatClick}
        onSelectChat={selectChat}
        onEditChat={handleStartTitleEdit}
        onDeleteChat={handleDeleteChat}
      />
      <GenerationController
        selectedChatId={selectedChatId}
        resumableGeneration={resumableGeneration}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatMessages
            selectedChatId={selectedChatId}
            detail={detail.data}
            isPending={detail.isPending}
            isError={detail.isError}
            isTitleRetrying={isTitleRetrying}
            onRetryMessages={() => void detail.refetch()}
            onEditTitle={handleStartTitleEdit}
            onRetryTitle={() => void handleTitleRetry()}
            onReplaceError={setReplaceError}
          />
          <ChatComposer
            key={`${selectedChatId ?? 'new-chat'}-${composerResetKey}`}
            selectedChatId={selectedChatId}
            replaceError={replaceError}
            onSelectChat={selectChat}
            onClearReplaceError={() => setReplaceError(null)}
          />
        </div>
      </GenerationController>
      <ChatTitleDialog
        open={editingChatId !== null}
        title={editingTitle}
        onOpenChange={(open) => {
          if (!open) setEditingChatId(null);
        }}
        onSave={handleSaveTitle}
      />
      <Dialog
        open={deleteDialogChatId !== null}
        title={t('deleteDialogTitle')}
        description={t('deleteDialogDescription')}
        onOpenChange={(open) => {
          if (!open && !deletingChatId) setDeleteDialogChatId(null);
        }}
      >
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={deletingChatId !== null}
            onClick={() => setDeleteDialogChatId(null)}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deletingChatId !== null}
            onClick={() => void handleConfirmDelete()}
          >
            {deletingChatId ? (
              <>
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                <span className="sr-only">{t('deletingChat')}</span>
              </>
            ) : (
              t('deleteConfirmAction')
            )}
          </Button>
        </div>
      </Dialog>
    </main>
  );
};
