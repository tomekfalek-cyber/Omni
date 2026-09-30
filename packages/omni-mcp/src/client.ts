import { StdioTransport } from './transports/stdio.js';
import { HttpTransport } from './transports/http.js';
import { MCPClientConfig, MCPTool, MCPRequest, MCPMethod } from './types.js';
import { z } from 'zod';

export class MCPClient {
  private config: MCPClientConfig;
  private transport: StdioTransport | HttpTransport;
  private tools: Map<string, MCPTool> = new Map();
  private initialized = false;

  constructor(config: MCPClientConfig) {
    this.config = config;

    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error('Transport stdio wymaga pola "command"');
      }
      this.transport = new StdioTransport(config.command, config.args, config.env);
    } else if (config.transport === 'http') {
      if (!config.url) {
        throw new Error('Transport HTTP wymaga pola "url"');
      }
      this.transport = new HttpTransport(config.url, config.headers);
    } else {
      throw new Error(`Nieobsługiwany transport: ${config.transport}`);
    }
  }

  public async start(): Promise<void> {
    await this.transport.start();
    await this.initialize();
    await this.loadTools();
    this.initialized = true;
  }

  public async stop(): Promise<void> {
    if (this.initialized) {
      await this.sendRequest(MCPMethod.SHUTDOWN, {});
    }
    await this.transport.stop();
    this.tools.clear();
    this.initialized = false;
  }

  private async initialize(): Promise<void> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.transport.getNextRequestId(),
      method: MCPMethod.INITIALIZE,
      params: {
        protocolVersion: '2026-07-28',
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: 'omni-agent',
          version: '1.0.0'
        }
      }
    };

    const response = await this.transport.send(request);
    if (response.error) {
      throw new Error(`Błąd inicjalizacji MCP: ${response.error.message}`);
    }

    console.log(`[MCPClient:${this.config.serverName}] Zainicjalizowano`);
  }

  private async loadTools(): Promise<void> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.transport.getNextRequestId(),
      method: MCPMethod.TOOLS_LIST,
      params: {}
    };

    const response = await this.transport.send(request);
    if (response.error) {
      throw new Error(`Błąd ładowania narzędzi: ${response.error.message}`);
    }

    const tools = response.result?.tools || [];
    for (const tool of tools) {
      const mcpTool: MCPTool = {
        name: tool.name,
        description: tool.description || '',
        inputSchema: z.any(), // W pełnej implementacji: parsowanie JSON Schema do Zod
        execute: async (args: any) => {
          return await this.callTool(tool.name, args);
        }
      };
      this.tools.set(tool.name, mcpTool);
    }

    console.log(`[MCPClient:${this.config.serverName}] Załadowano ${this.tools.size} narzędzi`);
  }

  private async callTool(toolName: string, args: any): Promise<any> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.transport.getNextRequestId(),
      method: MCPMethod.TOOLS_CALL,
      params: {
        name: toolName,
        arguments: args
      }
    };

    const response = await this.transport.send(request);
    if (response.error) {
      throw new Error(`Błąd wywołania narzędzia ${toolName}: ${response.error.message}`);
    }

    return response.result;
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.transport.getNextRequestId(),
      method,
      params
    };

    const response = await this.transport.send(request);
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  public getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  public getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}
