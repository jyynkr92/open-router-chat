export type GenerationContextMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type OpenRouterPromptMessage =
  | GenerationContextMessage
  | { role: 'system'; content: string };
