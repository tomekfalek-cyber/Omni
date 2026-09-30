/**
 * Omni Agent - Core Types & Contracts
 * Wersja: 1.0.0
 * Licencja: MIT
 * Opis: Centralny rejestr typów dla wszystkich pakietów Omni.
 */

export type AgentRole = 'planner' | 'executor' | 'reviewer' | 'evolver' | 'user' | 'system';

export type ToolApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  requiresApproval: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  status: ToolApprovalStatus;
  result?: any;
  error?: string;
  executedAt?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: AgentRole;
  content: string;
  toolCalls?: ToolCall[];
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface Task {
  id: string;
  sessionId: string;
  prompt: string;
  status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  iterations: number;
  maxIterations: number;
  currentAgent: AgentRole;
  result?: string;
  error?: string;
}

export interface Session {
  id: string;
  userId: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  taskIds: string[];
  memoryContext: string[];
}

export interface AgentConfig {
  provider: 'ollama' | 'openrouter';
  model: string;
  temperature: number;
  maxTokens: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface SystemState {
  version: string;
  uptime: number;
  activeSessions: number;
  memoryUsageMB: number;
  llmProviderStatus: 'healthy' | 'degraded' | 'down';
}
