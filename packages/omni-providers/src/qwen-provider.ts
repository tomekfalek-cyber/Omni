import OpenAI from 'openai';
import type { ChatOptions, ChatResult, LLMProvider } from './types.js';

export interface OpenAICompatibleConfig {
  /** Base URL of an OpenAI-compatible endpoint. */
  baseUrl: string;
  apiKey?: string;
  model?: string;
  /** Shown in errors; defaults to the provider id. */
  label?: string;
}

export const QWEN_DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
export const QWEN_DEFAULT_MODEL = 'qwen2.5-72b-instruct';
export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = 'qwen/qwen-2.5-72b-instruct:free';

/**
 * Any OpenAI-compatible chat endpoint: Alibaba Qwen/DashScope, OpenRouter
 * (free `:free` models) or a self-hosted gateway.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  private readonly client: OpenAI;

  constructor(id: string, name: string, cfg: OpenAICompatibleConfig) {
    if (!cfg.apiKey) {
      throw new Error(`${cfg.label ?? id}: missing API key`);
    }
    this.id = id;
    this.name = name;
    this.defaultModel = cfg.model ?? QWEN_DEFAULT_MODEL;
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const model = options.model ?? this.defaultModel;
    const completion = await this.client.chat.completions.create(
      {
        model,
        messages: options.messages.map((m) => ({ role: m.role, content: m.content })) as any,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      },
      options.signal ? { signal: options.signal } : undefined
    );
    const choice = completion.choices[0];
    return {
      content: choice?.message?.content ?? '',
      model: completion.model ?? model,
      provider: this.id,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
      raw: completion,
    };
  }

  async listModels(): Promise<string[]> {
    const page = await this.client.models.list();
    return page.data.map((m) => m.id).sort();
  }
}

/** Alibaba Qwen / DashScope (OpenAI-compatible mode). */
export class QwenProvider extends OpenAICompatibleProvider {
  constructor(cfg: Partial<OpenAICompatibleConfig> = {}) {
    super('qwen', 'Qwen (DashScope)', {
      baseUrl: cfg.baseUrl ?? process.env.QWEN_BASE_URL ?? QWEN_DEFAULT_BASE_URL,
      apiKey: cfg.apiKey ?? process.env.QWEN_API_KEY,
      model: cfg.model ?? process.env.OMNI_LLM_MODEL ?? QWEN_DEFAULT_MODEL,
      label: 'Qwen',
    });
  }
}

/** OpenRouter — use free models only (ids ending in `:free`). */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(cfg: Partial<OpenAICompatibleConfig> = {}) {
    super('openrouter', 'OpenRouter (free models)', {
      baseUrl: cfg.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL,
      apiKey: cfg.apiKey ?? process.env.OPENROUTER_API_KEY,
      model: cfg.model ?? process.env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULT_MODEL,
      label: 'OpenRouter',
    });
  }
}
