import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionChunk } from 'openai/resources/chat/completions';
import { AgentConfig } from '../types.js';
import { EventEmitter } from 'events';

export class QwenProvider extends EventEmitter {
  private client: OpenAI;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    super();
    this.config = config;

    if (config.provider === 'ollama') {
      this.client = new OpenAI({
        baseURL: config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
        apiKey: process.env.OLLAMA_API_KEY || 'ollama',
      });
    } else if (config.provider === 'openrouter') {
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.apiKey || process.env.OPENROUTER_API_KEY || '',
        defaultHeaders: {
          'HTTP-Referer': 'https://omni-agent.local',
          'X-Title': 'Omni Agent Self-Hosted',
        },
      });
    } else {
      throw new Error('Nieobsługiwany dostawca. Dozwolone tylko: ollama, openrouter (darmowe Qwen).');
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
      this.emit('error', new Error(`Błąd Qwen Provider: ${error.message}`));
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
      this.emit('error', new Error(`Błąd Qwen Provider: ${error.message}`));
      throw error;
    }
  }
}
