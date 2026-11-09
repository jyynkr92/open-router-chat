import 'server-only';

import { isGenerationStatus } from '@/lib/generation-status';
import { database } from '@/lib/server/database';
import type { GenerationStopResult } from '@/types/chat/generation-stop';

export class GenerationStopError extends Error {
  constructor(public readonly code: 'generation_not_found') {
    super(code);
  }
}

type StopRow = {
  id: string;
  status: string;
  assistant_message_id: string | null;
  content: string | null;
  last_event_seq: bigint;
};

const isTerminalStatus = (status: string) =>
  status === 'completed' || status === 'failed' || status === 'interrupted';

export const stopGeneration = async (generationId: string): Promise<GenerationStopResult> =>
  database.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<StopRow[]>`
      SELECT request.id, request.status, request.assistant_message_id,
             message.content, request.last_event_seq
      FROM generation_requests AS request
      LEFT JOIN messages AS message ON message.id = request.assistant_message_id
      WHERE request.id = ${generationId}::uuid
      FOR UPDATE OF request
    `;
    const row = rows[0];
    if (!row) throw new GenerationStopError('generation_not_found');

    if (isTerminalStatus(row.status)) {
      if (!isGenerationStatus(row.status)) throw new Error('Generation status is invalid');
      return {
        generation_id: row.id,
        status: row.status,
        stop_requested: false,
      };
    }

    if (row.status === 'pending') {
      const eventSeq = row.last_event_seq + 1n;
      const content = row.content ?? '';
      if (row.assistant_message_id) {
        const updated = await transaction.message.updateMany({
          where: { id: row.assistant_message_id, status: 'pending' },
          data: { content, status: 'interrupted', lastActivityAt: new Date() },
        });
        if (updated.count !== 1) throw new Error('Generation message is not pending');
      }
      await transaction.generationRequest.update({
        where: { id: row.id },
        data: {
          status: 'interrupted',
          cancelRequestedAt: new Date(),
          lastEventSeq: eventSeq,
        },
      });
      await transaction.generationEvent.create({
        data: {
          generationId: row.id,
          eventSeq,
          eventType: 'interrupted',
          payload: {
            generation_id: row.id,
            assistant_message_id: row.assistant_message_id,
            status: 'interrupted',
            content,
          },
        },
      });
      return { generation_id: row.id, status: 'interrupted', stop_requested: false };
    }

    await transaction.generationRequest.updateMany({
      where: { id: row.id, status: 'streaming', cancelRequestedAt: null },
      data: { cancelRequestedAt: new Date() },
    });
    return {
      generation_id: row.id,
      status: 'streaming',
      stop_requested: true,
    };
  });
