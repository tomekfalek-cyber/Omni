import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionChunk } from 'openai/resources/chat/completions';
import { AgentConfig } from '../types.js';
import { EventEmitter } from 'events';

/** Dostawcy zgodni z OpenAI (darmowe zrodla). */
const COMPATIBLE: Record<string, { baseUrl: string, keyEnv: string }> = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: 'GEMINI_API_KEY' },
};

export class QwenProvider extends EventEmitter {
  private client: OpenAI;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    super();
    this.config = config;
    const provider = String(config.provider);

    if (provider === 'ollama') {
      this.client = new OpenAI({
        baseURL: config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
        apiKey: process.env.OLLAMA_API_KEY || 'ollama',
      });
    } else if (provider === 'openrouter') {
      this.client = new OpenAI({
        baseURL: process.env.OMNI_LLM_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY || process.env.OMNI_LLM_API_KEY || '',
        defaultHeaders: {
          'HTTP-Referer': 'https://omni-agent.local',
          'X-Title': 'Omni Agent Self-Hosted',
        },
      });
    } else if (COMPATIBLE[provider]) {
      const info = COMPATIBLE[provider];
      this.client = new OpenAI({
        baseURL: process.env.OMNI_LLM_BASE_URL || info.baseUrl,
        apiKey: process.env[info.keyEnv] || process.env.OMNI_LLM_API_KEY || '',
      });
    } else {
      this.client = new OpenAI({
        baseURL: process.env.OMNI_LLM_BASE_URL || 'http://localhost:11434/v1',
        apiKey: process.env.OMNI_LLM_API_KEY || 'ollama',
      });
    }
  }

  async *streamCompletion(messages: ChatCompletionMessageParam[]): AsyncGenerator<string, void, unknown> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        stream: true,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      }) as AsyncIterable<ChatCompletionChunk>;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          yield content;
        }
      }
    } catch (error: any) {
      this.emit('error', new Error('Blad Qwen Provider: ' + error.message));
      throw error;
    }
  }

  async getCompletion(messages: ChatCompletionMessageParam[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        stream: false,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      });
      return response.choices[0]?.message?.content || '';
    } catch (error: any) {
      this.emit('error', new Error('Blad Qwen Provider: ' + error.message));
      throw error;
    }
  }
}
