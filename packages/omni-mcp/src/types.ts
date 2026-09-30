import { z } from 'zod';

export type MCPTransportType = 'stdio' | 'http';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  execute: (args: any) => Promise<any>;
}

export interface MCPServer {
  name: string;
  version: string;
  transport: MCPTransportType;
  tools: MCPTool[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface MCPClientConfig {
  serverName: string;
  transport: MCPTransportType;
  command?: string; // Dla stdio
  args?: string[]; // Dla stdio
  url?: string; // Dla HTTP
  headers?: Record<string, string>; // Dla HTTP
  env?: Record<string, string>; // Zmienne środowiskowe
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export const MCPMethod = {
  INITIALIZE: 'initialize',
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  SHUTDOWN: 'shutdown',
} as const;
