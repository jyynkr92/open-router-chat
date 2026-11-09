import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { database } from '@/lib/server/database';
import { isUuid } from '@/lib/server/validation';

const PAGE_SIZE = 30;
const cursorTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/;
type ChatCursor = { updatedAt: string; id: string };
type ChatListRow = {
  id: string;
  title: string;
  title_source: string;
  title_status: string;
  created_at: Date;
  updated_at: Date;
  cursor_updated_at: string;
};

export const parseChatCursor = (value: string | null): ChatCursor | null => {
  if (value === null) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    const cursor = decoded as Record<string, unknown>;
    if (
      typeof cursor.updated_at !== 'string' ||
      typeof cursor.id !== 'string' ||
      !isUuid(cursor.id)
    )
      return null;
    if (!cursorTimestampPattern.test(cursor.updated_at)) return null;
    const updatedAt = new Date(cursor.updated_at);
    if (
      !Number.isFinite(updatedAt.getTime()) ||
      updatedAt.toISOString() !== `${cursor.updated_at.slice(0, 23)}Z`
    )
      return null;
    return { updatedAt: cursor.updated_at, id: cursor.id };
  } catch {
    return null;
  }
};

const encodeChatCursor = (cursor: ChatCursor) =>
  Buffer.from(JSON.stringify({ updated_at: cursor.updatedAt, id: cursor.id })).toString(
    'base64url',
  );

export const listChats = async (cursor: ChatCursor | null) => {
  const filter = cursor
    ? Prisma.sql`WHERE updated_at < ${cursor.updatedAt}::timestamptz OR (updated_at = ${cursor.updatedAt}::timestamptz AND id > ${cursor.id}::uuid)`
    : Prisma.empty;
  const rows = await database.$queryRaw<ChatListRow[]>`
    SELECT id, title, title_source, title_status, created_at, updated_at,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
    FROM chats
    ${filter}
    ORDER BY updated_at DESC, id ASC
    LIMIT ${PAGE_SIZE + 1}
  `;
  const items = rows.slice(0, PAGE_SIZE).map((row) => ({
    id: row.id,
    title: row.title,
    title_source: row.title_source,
    title_status: row.title_status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }));
  const last = rows[PAGE_SIZE - 1];
  return {
    items,
    next_cursor:
      rows.length > PAGE_SIZE && last
        ? encodeChatCursor({ updatedAt: last.cursor_updated_at, id: last.id })
        : null,
  };
};

export const getChatMessages = async (chatId: string) =>
  database.$transaction(
    async (tx) => {
      const chat = await tx.chat.findUnique({
        where: { id: chatId },
        select: {
          id: true,
          title: true,
          titleSource: true,
          titleStatus: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!chat) return null;
      const messages = await tx.message.findMany({
        where: { chatId },
        orderBy: { sequenceNo: 'asc' },
        select: {
          id: true,
          chatId: true,
          role: true,
          content: true,
          status: true,
          sequenceNo: true,
          generationId: true,
          errorCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const active = await tx.generationRequest.findFirst({
        where: { chatId, status: { in: ['pending', 'streaming'] } },
        select: { id: true, assistantMessageId: true, status: true, lastEventSeq: true },
      });
      const activeMessage = active
        ? messages.find(
            (message) =>
              message.id === active.assistantMessageId && message.generationId === active.id,
          )
        : undefined;
      return {
        chat: {
          id: chat.id,
          title: chat.title,
          title_source: chat.titleSource,
          title_status: chat.titleStatus,
          created_at: chat.createdAt.toISOString(),
          updated_at: chat.updatedAt.toISOString(),
        },
        messages: messages.map((message) => ({
          id: message.id,
          chat_id: message.chatId,
          role: message.role,
          content: message.content,
          status: message.status,
          sequence_no: message.sequenceNo,
          generation_id: message.generationId,
          error_code: message.errorCode,
          created_at: message.createdAt.toISOString(),
          updated_at: message.updatedAt.toISOString(),
        })),
        active_generation:
          active && activeMessage
            ? {
                generation_id: active.id,
                assistant_message_id: activeMessage.id,
                content: activeMessage.content,
                status: active.status,
                last_event_seq: active.lastEventSeq.toString(),
              }
            : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
