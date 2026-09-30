import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SwarmManager } from 'omni-swarm/swarm-manager.js';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import * as crypto from 'crypto';
import * as path from 'path';
import { WEB_UI_HTML } from './web-ui.js';
import * as fs from 'fs';
import * as os from 'os';
import { ConfigStore, KEY_OPENROUTER, MODEL_PRESETS, PROVIDERS } from './config-store.js';
import { VoiceManager } from './voice/voice-manager.js';
import { LOGIN_PAGE } from './login-page.js';
import { AutomationScheduler } from './automations/scheduler.js';

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
  private voice: VoiceManager;
  private automations: AutomationScheduler;

  constructor(port: number = 7800, host: string = '127.0.0.1', config?: ConfigStore) {
    this.config = config || new ConfigStore();
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json({ limit: '1mb' }));
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.swarm = new SwarmManager();
    this.voice = new VoiceManager();
    this.swarm.workspaceCwd = this.config.get().workspaceDir;
    this.automations = new AutomationScheduler(this.config.dataDir(), async (prompt: string, name: string) => {
      const task = await this.swarm.executeTask('auto_' + name, prompt, this.config.get().workspaceDir);
      this.recordTask(task);
      return String((task as any).result || (task as any).error || '');
    });
    this.automations.start();
    this.swarm.onEvent = (event: any) => { this.broadcast({ type: 'agent.event', event: event }); };
    this.swarm.onToken = (chunk: string) => { this.broadcast({ type: 'task.token', chunk: chunk }); };
    this.wireApprovals();

    this.setupAuth();
    this.setupWebUI();
    this.setupREST();
    this.setupOAuth();
    this.setupWebSocket();

    this.httpServer.listen(port, host, () => {
      console.log('[Gateway] Omni Gateway uruchomiony na ' + host + ':' + port);
      console.log('[Gateway] Panel, klucze API i OAuth gotowe.');
    });
  }

  private wireApprovals() {
    try {
      const approvals: any = this.swarm.getApprovalManager();
      approvals.on('approval_required', (req: any) => {
        const cfg = this.config.get();
        if (cfg.autoApproveTools) {
          console.log('[Gateway] Auto-zatwierdzono narzedzie: ' + req.toolName);
          approvals.respondToApproval(req.callId, true);
        } else {
          this.broadcast({ type: 'approval.required', callId: req.callId, toolName: req.toolName, args: req.args });
        }
      });
    } catch (error) {
      console.log('[Gateway] Nie udalo sie podlaczyc zatwierdzen: ' + String(error));
    }
  }

  private broadcast(payload: any) {
    const text = JSON.stringify(payload);
    this.sessions.forEach((s) => {
      try { if (s.ws.readyState === 1) s.ws.send(text); } catch (error) { }
    });
  }

  private baseUrl(req: any): string {
    const host = req.headers['x-forwarded-host'] || req.headers.host || ('127.0.0.1:' + (process.env.OMNI_GATEWAY_PORT || '7800'));
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return proto + '://' + host;
  }

  private tokenFor(code: string): string {
    return crypto.createHash('sha256').update('omni-gate:' + code).digest('hex');
  }

  private isLocalRequest(req: any): boolean {
    const remote = String((req.socket && req.socket.remoteAddress) || '');
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  }

  private setupAuth() {
    this.app.post('/api/login', (req, res) => {
      const cfg = this.config.get();
      const code = String((req.body && req.body.code) || '');
      if (!cfg.accessCode) { res.json({ ok: true, note: 'Kod nie jest ustawiony' }); return; }
      if (code !== cfg.accessCode) { res.status(403).json({ error: 'Zly kod dostepu' }); return; }
      res.setHeader('Set-Cookie', 'omni_token=' + this.tokenFor(cfg.accessCode) + '; Path=/; Max-Age=2592000; SameSite=Lax');
      res.json({ ok: true });
    });

    this.app.use((req, res, next) => {
      const cfg = this.config.get();
      if (!cfg.accessCode) { next(); return; }
      const p = req.path || '/';
      if (p === '/api/login' || p === '/health' || p === '/manifest.webmanifest' || p === '/sw.js' || p.indexOf('/icon-') === 0) { next(); return; }
      const cookie = String(req.headers.cookie || '');
      if (cookie.indexOf('omni_token=' + this.tokenFor(cfg.accessCode)) !== -1) { next(); return; }
      if (p.indexOf('/api/') === 0) { res.status(401).json({ error: 'Wymagany kod dostepu' }); return; }
      res.type('html').send(LOGIN_PAGE);
    });
  }
  private assetsDir(): string {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const candidates = [
      path.join(process.cwd(), 'packages', 'omni-gateway', 'assets'),
      path.join(process.cwd(), 'assets'),
      path.join(here, '..', 'assets'),
    ];
    for (const dir of candidates) {
      try { if (fs.existsSync(path.join(dir, 'icon-512.png'))) { return dir; } } catch (error) { }
    }
    return candidates[0];
  }

  private setupWebUI() {
    this.app.get('/', (_req, res) => {
      res.type('html').send(WEB_UI_HTML);
    });

    this.app.get('/manifest.webmanifest', (_req, res) => {
      const cfg = this.config.get();
      const manifest = {
        name: cfg.botName + ' - Twoj asystent',
        short_name: cfg.botName,
        description: 'Osobisty asystent AI dzialajacy na Twoim komputerze.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        lang: 'pl',
        icons: [
          { src: '/icon-96.png', sizes: '96x96', type: 'image/png' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      };
      res.type('application/manifest+json').send(JSON.stringify(manifest));
    });

    for (const size of [96, 192, 512]) {
      this.app.get('/icon-' + size + '.png', (_req, res) => {
        try {
          const file = path.join(this.assetsDir(), 'icon-' + size + '.png');
          res.type('png').send(fs.readFileSync(file));
        } catch (error: any) {
          console.log('[Gateway] Nie moge podac ikony: ' + error.message);
          res.status(404).end();
        }
      });
    }

    this.app.get('/sw.js', (_req, res) => {
      res.type('application/javascript').send(
        'self.addEventListener("install", () => self.skipWaiting());' +
        'self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));' +
        'self.addEventListener("fetch", () => {});'
      );
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
      providers: PROVIDERS,
      autoApproveTools: cfg.autoApproveTools,
      tools: this.swarm.listTools(),
      workspaceDir: cfg.workspaceDir,
      voice: cfg.voice,
      voiceRate: cfg.voiceRate,
      voiceAutoRead: cfg.voiceAutoRead,
      voices: this.voice.listVoices(),
      voiceEngines: { edge: this.voice.edgeAvailable(), piper: this.voice.piperAvailable() },
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
        this.swarm.workspaceCwd = this.config.get().workspaceDir;
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

    this.app.get('/api/automations', (_req, res) => {
      const list = this.automations.list().map((j: any) => Object.assign({}, j, { when: this.automations.describe(j) }));
      res.json({ automations: list });
    });

    this.app.post('/api/automations', (req, res) => {
      try {
        const job = this.automations.upsert(req.body || {});
        res.json({ ok: true, automation: job, when: this.automations.describe(job) });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.post('/api/automations/delete', (req, res) => {
      this.automations.remove(String((req.body && req.body.id) || ''));
      res.json({ ok: true });
    });

    this.app.post('/api/automations/run', async (req, res) => {
      try {
        const job = await this.automations.runNow(String((req.body && req.body.id) || ''));
        res.json({ ok: !!job, automation: job, when: job ? this.automations.describe(job) : '' });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.get('/api/tunnel', (_req, res) => {
      try {
        const logPath = path.join(process.cwd(), 'tunnel.log');
        const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
        const marker = '.trycloudflare.com';
        const parts = log.split('https://');
        let url = '';
        for (const part of parts) {
          const idx = part.indexOf(marker);
          if (idx > 0) { url = 'https://' + part.slice(0, idx + marker.length); }
        }
        res.json({ url: url, connected: log.indexOf('Registered tunnel connection') !== -1 });
      } catch (error: any) {
        res.json({ url: '', connected: false });
      }
    });

    this.app.get('/api/voice/voices', (_req, res) => {
      res.json({ voices: this.voice.listVoices(), current: this.config.get().voice, engines: { edge: this.voice.edgeAvailable(), piper: this.voice.piperAvailable() } });
    });

    this.app.post('/api/voice/speak', async (req, res) => {
      try {
        const body = req.body || {};
        const voice = String(body.voice || this.config.get().voice || 'pl-PL-MarekNeural');
        const rate = String(body.rate || this.config.get().voiceRate || '+0%');
        const result = await this.voice.speak(String(body.text || ''), voice, rate);
        res.json({ ok: true, url: '/voice/' + path.basename(result.file), mime: result.mime });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/voice/upload', async (req, res) => {
      try {
        const body = req.body || {};
        const id = this.voice.saveUploadedVoice(body.name, body.onnx, body.config);
        res.json({ ok: true, id: id, voices: this.voice.listVoices() });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/image/:file', (req, res) => {
      const name = String(req.params.file || '').replace(new RegExp('[^A-Za-z0-9_.-]', 'g'), '');
      const full = path.join(os.homedir(), '.omni', 'images', name);
      if (!name || !fs.existsSync(full)) { res.status(404).json({ error: 'Brak obrazka' }); return; }
      res.sendFile(full);
    });

    this.app.get('/voice/:file', (req, res) => {
      const name = String(req.params.file || '').replace(new RegExp('[^A-Za-z0-9_.-]', 'g'), '');
      const full = path.join(this.voice.outDirPath(), name);
      if (!name || !fs.existsSync(full)) { res.status(404).json({ error: 'Brak pliku' }); return; }
      res.sendFile(full);
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
      const safeCwd = cwd || this.config.get().workspaceDir;

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
      error: task && task.error,
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
      this.sessions.set(sessionId, { ws, cwd: this.config.get().workspaceDir, startedAt: Date.now() });
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
