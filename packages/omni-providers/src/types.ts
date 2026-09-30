export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  usage?: ChatUsage;
  raw?: unknown;
}

/** Uniform interface every Omni LLM backend implements. */
export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  /** Default model id for this provider instance. */
  readonly defaultModel: string;
  chat(options: ChatOptions): Promise<ChatResult>;
  listModels?(): Promise<string[]>;
  /** True when the provider needs no API key (e.g. a local Ollama daemon). */
  readonly local?: boolean;
}
