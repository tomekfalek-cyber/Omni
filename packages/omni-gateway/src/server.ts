import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SwarmManager } from 'omni-swarm/swarm-manager.js';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import * as crypto from 'crypto';
import * as path from 'path';
import { WEB_UI_HTML } from './web-ui.js';
import { ConfigStore, KEY_OPENROUTER, MODEL_PRESETS } from './config-store.js';

const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';
const VERSION = '1.1.0';

function b64url(buf: Buffer): string {
  return buf.toString('base64').split('+').join('-').split('/').join('_').split('=').join('');
}

export class OmniGateway {
  private app: express.Application;
  private httpServer: any;
  private wss: WebSocketServer;
  private swarm: SwarmManager;
  private config: ConfigStore;
  private sessions: Map<string, { ws: WebSocket, cwd: string, startedAt: number }> = new Map();
  private recentTasks: any[] = [];
  private oauthStates: Map<string, { verifier: string, createdAt: number }> = new Map();
  private startedAt: number = Date.now();

  constructor(port: number = 7800, host: string = '127.0.0.1', config?: ConfigStore) {
    this.config = config || new ConfigStore();
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json({ limit: '1mb' }));
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.swarm = new SwarmManager();

    this.setupWebUI();
    this.setupREST();
    this.setupOAuth();
    this.setupWebSocket();

    this.httpServer.listen(port, host, () => {
      console.log('[Gateway] Omni Gateway uruchomiony na ' + host + ':' + port);
      console.log('[Gateway] Panel, klucze API i OAuth gotowe.');
    });
  }

  private baseUrl(req: any): string {
    const host = req.headers['x-forwarded-host'] || req.headers.host || ('127.0.0.1:' + (process.env.OMNI_GATEWAY_PORT || '7800'));
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return proto + '://' + host;
  }

  private setupWebUI() {
    this.app.get('/', (_req, res) => {
      res.type('html').send(WEB_UI_HTML);
    });
  }

  private async ollamaStatus(): Promise<{ ok: boolean, url: string, models: string[] }> {
    const cfg = this.config.get();
    const url = cfg.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
    const tags = url.split('/v1')[0] + '/api/tags';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(tags, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return { ok: false, url: url, models: [] };
      const data: any = await r.json();
      const models = (data.models || []).map((m: any) => m.name);
      return { ok: true, url: url, models: models };
    } catch (error) {
      return { ok: false, url: url, models: [] };
    }
  }

  private statusPayload(): any {
    const cfg = this.config.get();
    return {
      status: 'ok',
      version: VERSION,
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      provider: cfg.provider,
      model: cfg.model,
      modelPro: cfg.modelPro,
      botName: cfg.botName,
      language: cfg.language,
      hasOpenRouterKey: this.config.hasOpenRouterKey(),
      keyNames: this.config.keyNames(),
      sessions: this.sessions.size,
      presets: MODEL_PRESETS,
      node: process.version,
    };
  }

  private setupREST() {
    this.app.get('/health', async (_req, res) => {
      const cfg = this.config.get();
      const ollama = await this.ollamaStatus();
      res.json({ status: 'ok', uptime: process.uptime(), provider: cfg.provider, model: cfg.model, ollama: ollama.ok });
    });

    this.app.get('/api/status', async (_req, res) => {
      const payload = this.statusPayload();
      payload.ollama = await this.ollamaStatus();
      res.json(payload);
    });

    this.app.get('/api/config', (_req, res) => {
      res.json(this.config.get());
    });

    this.app.post('/api/config', async (req, res) => {
      try {
        const body = req.body || {};
        await this.config.save(body, body.apiKeys);
        this.swarm.reconfigure();
        res.json({ ok: true, config: this.config.get() });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/keys/delete', async (req, res) => {
      try {
        const name = (req.body && req.body.name) || KEY_OPENROUTER;
        await this.config.removeKey(String(name));
        this.swarm.reconfigure();
        res.json({ ok: true, keyNames: this.config.keyNames() });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/test', async (_req, res) => {
      try {
        const answer = await this.swarm.ping('Napisz jedno zdanie: jaki jest twoj model i czy dzialasz?');
        res.json({ ok: true, answer: answer, provider: this.config.get().provider, model: this.config.get().model });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/ollama/models', async (_req, res) => {
      res.json(await this.ollamaStatus());
    });

    this.app.get('/api/sessions', (_req, res) => {
      const sessions = Array.from(this.sessions.entries()).map((entry) => ({
        id: entry[0],
        status: 'aktywna',
        updatedAt: entry[1].startedAt,
        cwd: entry[1].cwd,
      }));
      res.json({ sessions: sessions });
    });

    this.app.get('/api/tasks', (_req, res) => {
      res.json({ tasks: this.recentTasks.slice(-25).reverse() });
    });

    this.app.post('/api/tasks', async (req, res) => {
      const { sessionId, prompt, cwd } = req.body || {};
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

      const activeSessionId = sessionId || uuidv4();
      const safeCwd = cwd || process.cwd();

      try {
        const task = await this.swarm.executeTask(activeSessionId, prompt, safeCwd);
        this.recordTask(task);
        res.json(task);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  private recordTask(task: any) {
    this.recentTasks.push({
      id: task && task.id,
      status: task && task.status,
      createdAt: (task && task.createdAt) || Date.now(),
      prompt: task && task.prompt,
      result: task && task.result,
    });
    if (this.recentTasks.length > 100) this.recentTasks.shift();
  }

  private setupOAuth() {
    this.app.get('/oauth/openrouter/start', (req, res) => {
      const verifier = b64url(crypto.randomBytes(32));
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const state = b64url(crypto.randomBytes(16));
      this.oauthStates.set(state, { verifier: verifier, createdAt: Date.now() });
      const callback = this.baseUrl(req) + '/oauth/callback';
      const url = OPENROUTER_AUTH_URL + '?callback_url=' + encodeURIComponent(callback) +
        '&code_challenge=' + challenge + '&code_challenge_method=S256&state=' + state;
      res.redirect(url);
    });

    this.app.get('/oauth/callback', async (req, res) => {
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code) return res.status(400).send('Brak kodu autoryzacji.');

      let verifier = '';
      if (state && this.oauthStates.has(state)) {
        verifier = (this.oauthStates.get(state) as any).verifier;
        this.oauthStates.delete(state);
      } else if (this.oauthStates.size > 0) {
        const last = Array.from(this.oauthStates.values()).pop() as any;
        verifier = last.verifier;
        this.oauthStates.clear();
      }
      if (!verifier) return res.status(400).send('Sesja logowania wygasla. Sprobuj ponownie z panelu.');

      try {
        const r = await fetch(OPENROUTER_KEYS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code, code_verifier: verifier, code_challenge_method: 'S256' }),
        });
        const data: any = await r.json().catch(() => ({}));
        if (!r.ok || !data.key) {
          return res.status(502).send('Nie udalo sie odebrac klucza: ' + (data.error || r.status));
        }
        await this.config.save({ provider: 'openrouter' }, { [KEY_OPENROUTER]: data.key });
        this.swarm.reconfigure();
        res.redirect('/#keys');
      } catch (error: any) {
        res.status(502).send('Blad polaczenia z OpenRouter: ' + error.message);
      }
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket) => {
      const sessionId = uuidv4();
      this.sessions.set(sessionId, { ws, cwd: process.cwd(), startedAt: Date.now() });
      console.log('[Gateway] Nowa sesja WebSocket: ' + sessionId);

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
        console.log('[Gateway] Sesja zamknieta: ' + sessionId);
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
          this.recordTask(task);
          ws.send(JSON.stringify({ type: 'task.finished', taskId: task.id, status: task.status, result: task.result }));
        } catch (error: any) {
          ws.send(JSON.stringify({ type: 'task.finished', taskId: 'temp', status: 'failed', error: error.message }));
        }
        break;

      case 'config.reload':
        this.swarm.reconfigure();
        ws.send(JSON.stringify({ type: 'config.reloaded' }));
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }
}
