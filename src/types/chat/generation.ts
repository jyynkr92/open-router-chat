export type CreateGenerationInput = {
  clientRequestId: string;
  chatId: string | null;
  content: string;
};

export type RetryGenerationInput = {
  clientRequestId: string;
  chatId: string;
  messageId: string;
};

export type RegenerateGenerationInput = RetryGenerationInput;

export type GenerationStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'interrupted';

export type GenerationTerminalStatus = Extract<
  GenerationStatus,
  'completed' | 'failed' | 'interrupted'
>;

export type GenerationRegistration = {
  chat_id: string;
  user_message_id: string;
  assistant_message_id: string;
  generation_id: string;
  status: GenerationStatus;
};

export type GenerationConnection = 'idle' | 'connecting' | 'streaming' | 'closed' | 'error';

export type ActiveGenerationState = GenerationRegistration & {
  userContent: string;
  content: string;
  lastEventSeq: string;
  connection: GenerationConnection;
  errorCode: string | null;
};

export type ResumableGeneration = {
  chat_id: string;
  user_message_id: string;
  assistant_message_id: string;
  generation_id: string;
  user_content: string;
  content: string;
  status: GenerationStatus;
  last_event_seq: string;
};
