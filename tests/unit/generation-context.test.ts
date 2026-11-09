import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@/generated/prisma/client';
import { loadGenerationContext } from '@/lib/server/generation-context';

describe('generation context', () => {
  it('includes only completed messages from the generation chat', async () => {
    const findUnique = vi.fn().mockResolvedValue({ chatId: 'chat-1' });
    const findMany = vi.fn().mockResolvedValue([
      { role: 'user', content: '첫 질문' },
      { role: 'assistant', content: '완료된 답변' },
      { role: 'user', content: '현재 질문' },
    ]);
    const client = {
      generationRequest: { findUnique },
      message: { findMany },
    } as unknown as PrismaClient;

    await expect(loadGenerationContext(client, 'generation-1')).resolves.toEqual([
      { role: 'user', content: '첫 질문' },
      { role: 'assistant', content: '완료된 답변' },
      { role: 'user', content: '현재 질문' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { chatId: 'chat-1', role: { in: ['user', 'assistant'] }, status: 'completed' },
      orderBy: { sequenceNo: 'asc' },
      select: { role: true, content: true },
    });
  });
});
