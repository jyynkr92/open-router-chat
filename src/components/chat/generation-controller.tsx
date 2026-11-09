'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { useChatStore } from '@/providers/app-providers';
import { useGenerationStream } from '@/hooks/use-generation-stream';
import type { ResumableGeneration } from '@/types/chat/generation';

type GenerationControllerProps = {
  selectedChatId: string | null;
  resumableGeneration: ResumableGeneration | null;
  children: ReactNode;
};

type GenerationActions = Pick<
  ReturnType<typeof useGenerationStream>,
  | 'startGeneration'
  | 'stopActiveGeneration'
  | 'retryActiveGeneration'
  | 'regenerateActiveGeneration'
  | 'reconnectActiveGeneration'
>;

const GenerationActionsContext = createContext<GenerationActions | null>(null);

export const GenerationController = ({
  selectedChatId,
  resumableGeneration,
  children,
}: GenerationControllerProps) => {
  const stream = useGenerationStream(selectedChatId, resumableGeneration);
  const setActiveGeneration = useChatStore((state) => state.actions.setActiveGeneration);

  useEffect(() => () => setActiveGeneration(null), [setActiveGeneration]);

  const actions = useMemo<GenerationActions>(
    () => ({
      startGeneration: stream.startGeneration,
      stopActiveGeneration: stream.stopActiveGeneration,
      retryActiveGeneration: stream.retryActiveGeneration,
      regenerateActiveGeneration: stream.regenerateActiveGeneration,
      reconnectActiveGeneration: stream.reconnectActiveGeneration,
    }),
    [
      stream.reconnectActiveGeneration,
      stream.regenerateActiveGeneration,
      stream.retryActiveGeneration,
      stream.startGeneration,
      stream.stopActiveGeneration,
    ],
  );

  return (
    <GenerationActionsContext.Provider value={actions}>
      {children}
    </GenerationActionsContext.Provider>
  );
};

export const useGenerationActions = () => {
  const actions = useContext(GenerationActionsContext);
  if (!actions) throw new Error('Generation controller is required');
  return actions;
};
