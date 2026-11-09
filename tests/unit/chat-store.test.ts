import { describe, expect, it } from 'vitest';

import { createChatStore } from '../../src/store/create-chat-store';

describe('chat store request isolation', () => {
  it('does not share selected chats between independent stores', () => {
    const first = createChatStore();
    const second = createChatStore();
    first.getState().actions.selectChat('chat-1');
    expect(second.getState().selectedChatId).toBeNull();
  });
});
