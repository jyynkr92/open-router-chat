import { describe, expect, it } from 'vitest';

import { mergeActiveGenerationMessages } from '../../src/lib/chat/generation-view';
import type { ActiveGenerationState } from '../../src/types/chat/generation';
import type { ChatMessage } from '../../src/types/chat/read';

const activeGeneration: ActiveGenerationState = {
  chat_id: 'chat-1',
  user_message_id: 'user-1',
  assistant_message_id: 'assistant-1',
  generation_id: 'generation-1',
  status: 'pending',
  userContent: '질문',
  content: '',
  lastEventSeq: '0',
  connection: 'connecting',
  errorCode: null,
};

const interruptedMessage: ChatMessage = {
  id: 'assistant-1',
  chat_id: 'chat-1',
  role: 'assistant',
  content: '',
  status: 'interrupted',
  sequence_no: 2,
  generation_id: 'generation-1',
  error_code: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('generation message view', () => {
  it('keeps pending dots until stop is requested and removes them while stopping', () => {
    expect(mergeActiveGenerationMessages([], activeGeneration, 'chat-1')).toHaveLength(2);
    const stopping = mergeActiveGenerationMessages([], activeGeneration, 'chat-1', true);
    expect(stopping.map((message) => message.role)).toEqual(['user']);
  });

  it('hides an empty interrupted answer in both local and persisted messages', () => {
    expect(
      mergeActiveGenerationMessages(
        [interruptedMessage],
        { ...activeGeneration, status: 'interrupted' },
        'chat-1',
      ),
    ).toHaveLength(1);
    expect(mergeActiveGenerationMessages([interruptedMessage], null, 'chat-1')).toEqual([]);
  });

  it('preserves a partial interrupted answer', () => {
    const partial = { ...interruptedMessage, content: '부분 답변' };
    expect(mergeActiveGenerationMessages([partial], null, 'chat-1')).toEqual([partial]);
  });

  it('does not merge another chat generation into the selected chat', () => {
    expect(mergeActiveGenerationMessages([], activeGeneration, 'chat-2')).toEqual([]);
  });
});
