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

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await fn(); } catch (error: any) {
        lastError = error;
        const msg = String(error && error.message ? error.message : error);
        if (msg.indexOf('429') === -1 && msg.indexOf('Rate limit') === -1 && msg.indexOf('rate limit') === -1) { throw error; }
        await new Promise((resolve) => setTimeout(resolve, 3000 + attempt * 3000));
      }
    }
    throw lastError;
  }

  async getCompletionWithTools(messages: ChatCompletionMessageParam[], tools: any[], toolChoice?: string): Promise<{ content: string, toolCalls: any[] }> {
    const payload: any = {
      model: this.config.model,
      messages: messages,
      stream: false,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
    };
    if (tools && tools.length) { payload.tools = tools; }
    if (toolChoice) { payload.tool_choice = toolChoice; }
    const response: any = await this.withRetry(async () => await this.client.chat.completions.create(payload) as any);
    const message: any = (response.choices && response.choices[0] && response.choices[0].message) || {};
    return { content: message.content || '', toolCalls: message.tool_calls || [] };
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
