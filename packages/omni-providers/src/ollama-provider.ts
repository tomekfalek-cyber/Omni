import type { ChatOptions, ChatResult, LLMProvider } from './types.js';

export interface OllamaConfig {
  /** Base URL of the Ollama OpenAI-compatible endpoint, e.g. http://127.0.0.1:11434/v1 */
  baseUrl?: string;
  model?: string;
}

interface OllamaChatResponse {
  model?: string;
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Local Ollama daemon. Free and offline — the default backend for Omni.
 * Talks to the native `/api/chat` endpoint so no SDK is required.
 */
export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (local)';
  readonly local = true;
  readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(cfg: OllamaConfig = {}) {
    const openaiCompat =
      cfg.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1';
    // Strip the OpenAI-compatible /v1 suffix to reach the native API.
    this.baseUrl = openaiCompat.replace(/\/v1\/?$/, '');
    this.defaultModel = cfg.model ?? process.env.OMNI_LLM_MODEL ?? 'qwen2.5:7b';
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const model = options.model ?? this.defaultModel;
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: options.messages,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as OllamaChatResponse;
    return {
      content: data.message?.content ?? '',
      model: data.model ?? model,
      provider: this.id,
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        totalTokens:
          data.prompt_eval_count !== undefined && data.eval_count !== undefined
            ? data.prompt_eval_count + data.eval_count
            : undefined,
      },
      raw: data,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama listModels failed: ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  }
}
