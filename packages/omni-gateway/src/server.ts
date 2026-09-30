import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SwarmManager } from 'omni-swarm/swarm-manager.js';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';

export class OmniGateway {
  private app: express.Application;
  private httpServer: any;
  private wss: WebSocketServer;
  private swarm: SwarmManager;
  private sessions: Map<string, { ws: WebSocket, cwd: string }> = new Map();

  constructor(port: number = 7800, host: string = '127.0.0.1') {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.swarm = new SwarmManager();

    this.setupREST();
    this.setupWebSocket();
    
    this.httpServer.listen(port, host, () => {
      console.log(`[Gateway] Omni Gateway uruchomiony na ${host}:${port}`);
      console.log(`[Gateway] Dostępne endpointy: /health, /api/tasks`);
    });
  }

  private setupREST() {
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', uptime: process.uptime(), provider: process.env.OMNI_LLM_PROVIDER || 'ollama' });
    });

    this.app.post('/api/tasks', async (req, res) => {
      const { sessionId, prompt, cwd } = req.body;
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
      
      const activeSessionId = sessionId || uuidv4();
      const safeCwd = cwd || process.cwd();

      try {
        const task = await this.swarm.executeTask(activeSessionId, prompt, safeCwd);
        res.json(task);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const sessionId = uuidv4();
      this.sessions.set(sessionId, { ws, cwd: process.cwd() });
      console.log(`[Gateway] Nowa sesja WebSocket: ${sessionId}`);

      ws.send(JSON.stringify({ type: 'auth.ok', sessionId }));

      ws.on('message', async (message: string) => {
        try {
          const data = JSON.parse(message);
          await this.handleWsMessage(sessionId, data, ws);
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.sessions.delete(sessionId);
        console.log(`[Gateway] Sesja zamknięta: ${sessionId}`);
      });
    });
  }

  private async handleWsMessage(sessionId: string, data: any, ws: WebSocket) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (data.type) {
      case 'task.create':
        ws.send(JSON.stringify({ type: 'task.started', taskId: 'temp_' + Date.now(), sessionId }));
        try {
          const task = await this.swarm.executeTask(sessionId, data.prompt, session.cwd);
          ws.send(JSON.stringify({ type: 'task.finished', taskId: task.id, status: task.status, result: task.result }));
        } catch (error: any) {
          ws.send(JSON.stringify({ type: 'task.finished', taskId: 'temp', status: 'failed', error: error.message }));
        }
        break;
      
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }
}
