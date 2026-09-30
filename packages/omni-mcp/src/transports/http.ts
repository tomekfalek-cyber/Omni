import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';
import { MCPRequest, MCPResponse } from '../types.js';

export class HttpTransport extends EventEmitter {
  private client: AxiosInstance;
  private url: string;
  private requestId = 0;

  constructor(url: string, headers: Record<string, string> = {}) {
    super();
    this.url = url;
    this.client = axios.create({
      baseURL: url,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      timeout: 30000
    });
  }

  public async start(): Promise<void> {
    console.log(`[HttpTransport] Połączono z: ${this.url}`);
  }

  public async stop(): Promise<void> {
    console.log(`[HttpTransport] Rozłączono z: ${this.url}`);
  }

  public async send(request: MCPRequest): Promise<MCPResponse> {
    try {
      const response = await this.client.post('', request);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: error.response.status,
            message: error.response.data?.message || 'HTTP Error',
            data: error.response.data
          }
        };
      }
      throw error;
    }
  }

  public getNextRequestId(): number {
    return ++this.requestId;
  }
}
