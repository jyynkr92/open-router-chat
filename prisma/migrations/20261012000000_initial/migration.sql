-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL DEFAULT '새 채팅',
    "title_source" VARCHAR(20) NOT NULL DEFAULT 'default',
    "title_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "title_version" INTEGER NOT NULL DEFAULT 0,
    "title_started_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "sequence_no" INTEGER NOT NULL,
    "generation_id" UUID,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_requests" (
    "id" UUID NOT NULL,
    "client_request_id" UUID NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "chat_id" UUID,
    "user_message_id" UUID,
    "assistant_message_id" UUID,
    "operation" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "worker_id" UUID,
    "last_event_seq" BIGINT NOT NULL DEFAULT 0,
    "cancel_requested_at" TIMESTAMPTZ(6),
    "lease_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_events" (
    "id" UUID NOT NULL,
    "generation_id" UUID NOT NULL,
    "event_seq" BIGINT NOT NULL,
    "event_type" VARCHAR(20) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chats_updated_at_id_idx" ON "chats"("updated_at" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_chat_id_sequence_no_key" ON "messages"("chat_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "generation_requests_client_request_id_key" ON "generation_requests"("client_request_id");

-- CreateIndex
CREATE INDEX "generation_requests_status_lease_idx" ON "generation_requests"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "generation_events_generation_id_event_seq_key" ON "generation_events"("generation_id", "event_seq");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_user_message_id_fkey" FOREIGN KEY ("user_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_events" ADD CONSTRAINT "generation_events_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain constraints managed explicitly in migration SQL.
ALTER TABLE chats ADD CONSTRAINT chats_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 100);
ALTER TABLE chats ADD CONSTRAINT chats_title_source_check CHECK (title_source IN ('default','auto','manual'));
ALTER TABLE chats ADD CONSTRAINT chats_title_status_check CHECK (title_status IN ('idle','generating','completed','failed'));
ALTER TABLE chats ADD CONSTRAINT chats_title_version_check CHECK (title_version >= 0);
ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK (role IN ('user','assistant'));
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (status IN ('pending','streaming','completed','failed','interrupted'));
ALTER TABLE messages ADD CONSTRAINT messages_user_status_check CHECK (role != 'user' OR (status = 'completed' AND generation_id IS NULL));
ALTER TABLE messages ADD CONSTRAINT messages_sequence_no_check CHECK (sequence_no > 0);
CREATE UNIQUE INDEX messages_one_active_assistant_per_chat_idx ON messages(chat_id) WHERE role = 'assistant' AND status IN ('pending','streaming');
ALTER TABLE generation_requests ADD CONSTRAINT generation_requests_operation_check CHECK (operation IN ('send','retry','regenerate'));
ALTER TABLE generation_requests ADD CONSTRAINT generation_requests_status_check CHECK (status IN ('pending','streaming','completed','failed','interrupted'));
ALTER TABLE generation_requests ADD CONSTRAINT generation_requests_event_seq_check CHECK (last_event_seq >= 0);
ALTER TABLE generation_events ADD CONSTRAINT generation_events_type_check CHECK (event_type IN ('delta','completed','interrupted','error'));
ALTER TABLE generation_events ADD CONSTRAINT generation_events_seq_check CHECK (event_seq > 0);
