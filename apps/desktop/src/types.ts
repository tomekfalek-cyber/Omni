export interface WsMessage {
  type: 'auth.ok' | 'auth.fail' | 'chat.token' | 'chat.done' | 'error' | 'task.started' | 'task.finished';
  token?: string;
  fullText?: string;
  sessionId?: string;
  taskId?: string;
  error?: string;
  status?: string;
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface Session {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: number;
}

export interface GatewayConfig {
  url: string;
  token: string;
}
