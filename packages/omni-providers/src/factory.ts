import type { LLMProvider } from './types.js';
import { OllamaProvider, type OllamaConfig } from './ollama-provider.js';
import {
  OpenAICompatibleProvider,
  OpenRouterProvider,
  QwenProvider,
  type OpenAICompatibleConfig,
} from './qwen-provider.js';

export type ProviderId = 'ollama' | 'qwen' | 'openrouter';

export interface ProviderOptions extends OllamaConfig, Partial<OpenAICompatibleConfig> {}

/** Build a provider by id. Falls back to `OMNI_LLM_PROVIDER`, then `ollama`. */
export function createProvider(id?: ProviderId, options: ProviderOptions = {}): LLMProvider {
  const selected = id ?? (process.env.OMNI_LLM_PROVIDER as ProviderId | undefined) ?? 'ollama';
  switch (selected) {
    case 'ollama':
      return new OllamaProvider(options);
    case 'qwen':
      return new QwenProvider(options);
    case 'openrouter':
      return new OpenRouterProvider(options);
    default:
      throw new Error(`Unknown LLM provider: ${String(selected)}`);
  }
}

/** Env-configured provider from `OMNI_LLM_PROVIDER` (default: ollama). */
export function createProviderFromEnv(): LLMProvider {
  return createProvider(undefined);
}

export { OpenAICompatibleProvider };
