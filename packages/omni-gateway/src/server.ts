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
import { ConfigStore, KEY_OPENROUTER, MODEL_PRESETS, PROVIDERS, providerInfo } from './config-store.js';
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
  private chatLog: any[] = [];
  private appVersion: string = '';
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
    this.loadChat();
    this.appVersion = crypto.createHash('sha256').update(WEB_UI_HTML).digest('hex').slice(0, 12);
    this.swarm.onEvent = (event: any) => { this.broadcast({ type: 'agent.event', event: event }); };
    this.swarm.onToken = (chunk: string) => { this.broadcast({ type: 'task.token', chunk: chunk }); };
    this.swarm.onWorker = (event: any) => { this.broadcast({ type: 'agent.event', event: { kind: 'worker', index: event.index, state: event.state, text: event.task } }); };
    this.wireApprovals();

    this.setupAuth();
    this.setupWebUI();
    this.setupREST();
    this.setupOAuth();
    this.setupWebSocket();

    this.httpServer.listen(port, host, () => {
      console.log('[Gateway] Omni Gateway uruchomiony na ' + host + ':' + port);
      console.log('[Gateway] Panel, klucze API i OAuth gotowe.');
      this.startBackgroundWork();
      this.startTelegram();
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

  private notifications: any[] = [];
  private notifyTimer: any = null;

  private loadNotifications(): void {
    try {
      const f = path.join(process.env.HOME || '/home/openclaw', '.omni', 'notifications.json');
      if (fs.existsSync(f)) { const parsed = JSON.parse(fs.readFileSync(f, 'utf8')); if (Array.isArray(parsed)) { this.notifications = parsed; } }
    } catch (error) { }
  }

  private saveNotifications(): void {
    try {
      const dir = path.join(process.env.HOME || '/home/openclaw', '.omni');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'notifications.json'), JSON.stringify(this.notifications.slice(0, 100), null, 2), 'utf8');
    } catch (error) { }
  }

  private addNotification(title: string, body: string, kind: string): void {
    this.loadNotifications();
    const last = this.notifications[0];
    if (last && last.title === title && last.body === body && (Date.now() - Number(last.at || 0)) < 3600000) { return; }
    const item = { id: 'n' + Date.now(), title: title, body: body, kind: kind || 'info', at: Date.now(), read: false };
    this.notifications.unshift(item);
    this.saveNotifications();
    this.broadcast({ type: 'notification', notification: item });
    console.log('[Tlo] Powiadomienie: ' + title + ' - ' + body.slice(0, 80));
  }

  private quietHours(): boolean {
    const h = new Date().getHours();
    return h >= 23 || h < 8;
  }

  private startBackgroundWork(): void {
    if (this.notifyTimer) { return; }
    const everyMs = Number(process.env.OMNI_HEARTBEAT_MS || 1800000);
    this.notifyTimer = setInterval(() => { this.runBackgroundCheck().catch(() => { }); }, everyMs);
    console.log('[Tlo] Praca w tle uruchomiona (co ' + Math.round(everyMs / 60000) + ' min, cisza 23-8)');
    setTimeout(() => { this.runBackgroundCheck().catch(() => { }); }, 20000);
  }

  private async runBackgroundCheck(): Promise<any[]> {
    if (this.quietHours()) { return this.notifications; }
    this.loadNotifications();
    const found: any[] = [];
    try {
      const token = this.config.secrets.getSecret('GITHUB_TOKEN') || '';
      if (token) {
        const r = await fetch('https://api.github.com/notifications', { headers: { Authorization: ('token '.concat(token)), 'User-Agent': 'OmniBot' } });
        if (r.ok) {
          const list: any = await r.json().catch(() => []);
          if (Array.isArray(list) && list.length > 0) {
            const first = list[0] && list[0].subject ? String(list[0].subject.title || '') : '';
            const repo = list[0] && list[0].repository ? String(list[0].repository.full_name || '') : '';
            this.addNotification('GitHub', 'Masz ' + list.length + ' nieprzeczytanych powiadomien. Ostatnie: ' + first + ' (' + repo + ')', 'github');
            found.push({ kind: 'github', count: list.length });
          }
        }
      }
    } catch (error) { }
    return this.notifications;
  }
  private tgTimer: any = null;
  private tgOffset = 0;

  private startTelegram(): void {
    if (this.tgTimer) { return; }
    this.tgTimer = setInterval(() => { this.telegramPoll().catch(() => { }); }, 4000);
    const has = (this.config.secrets.getSecret('TELEGRAM_BOT_TOKEN') || '').length > 10;
    console.log('[Telegram] Odbior wiadomosci ' + (has ? 'wlaczony' : 'gotowy (wpisz token w panelu)') + '.');
  }

  private async telegramPoll(): Promise<void> {
    const botToken = this.config.secrets.getSecret('TELEGRAM_BOT_TOKEN') || '';
    if (botToken.length < 10) { return; }
    const url = 'https://api.telegram.org/bot' + botToken + '/getUpdates?timeout=0&offset=' + this.tgOffset;
    const r = await fetch(url);
    if (!r.ok) { return; }
    const data: any = await r.json().catch(() => null);
    if (!data || !data.ok || !Array.isArray(data.result) || !data.result.length) { return; }
    for (const upd of data.result) {
      this.tgOffset = Number(upd.update_id) + 1;
      const msg = upd.message || upd.edited_message;
      if (!msg || !msg.text) { continue; }
      const chatId = String((msg.chat && msg.chat.id) || '');
      const allowed = String(this.config.secrets.getSecret('TELEGRAM_CHAT_ID') || '').trim();
      if (!allowed) {
        await this.telegramSend(botToken, chatId, 'Twoj chat ID to: ' + chatId + String.fromCharCode(10) + 'Wpisz go w panelu Omni (Integracje -> Telegram), a zaczne odbierac polecenia.');
        continue;
      }
      if (chatId !== allowed) { continue; }
      console.log('[Telegram] Wiadomosc od ' + chatId + ': ' + String(msg.text).slice(0, 60));
      try {
        const cfg = this.config.get();
        const task = await this.swarm.executeTask('tg_' + chatId, String(msg.text), cfg.workspaceDir || process.cwd());
        const answer = String((task && task.result) || '').trim() || 'Nie udalo sie uzyskac odpowiedzi.';
        await this.telegramSend(botToken, chatId, answer.slice(0, 3500));
      } catch (error: any) {
        await this.telegramSend(botToken, chatId, 'Blad: ' + error.message);
      }
    }
  }

  private async telegramSend(botToken: string, chatId: string, text: string): Promise<void> {
    try {
      await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text }),
      });
    } catch (error) { }
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
      if (p === '/api/login' || p === '/api/version' || p === '/health' || p === '/manifest.webmanifest' || p === '/sw.js' || p === '/offline' || p.indexOf('/icon-') === 0) { next(); return; }
      const cookie = String(req.headers.cookie || '');
      if (cookie.indexOf('omni_token=' + this.tokenFor(cfg.accessCode)) !== -1) { next(); return; }
      if (p.indexOf('/api/') === 0) { res.status(401).json({ error: 'Wymagany kod dostepu' }); return; }
      res.type('html').send(LOGIN_PAGE);
    });
  }
  /** Ochrona kosztow: nie pozwala wlaczyc modelu, ktory moze kosztowac. */
  private costGuard(body: any): string {
    const provider = typeof body.provider === 'string' ? body.provider : '';
    if (provider !== 'openrouter') { return ''; }
    for (const field of ['model', 'modelPro']) {
      const model = body[field];
      if (typeof model === 'string' && model && model.indexOf(':free') === -1) {
        return 'Ochrona kosztow: OpenRouter z modelem bez koncowki ":free" moze kosztowac. Wybierz model darmowy, np. qwen/qwen-2.5-72b-instruct:free.';
      }
    }
    return '';
  }

  private integrationStatus(): any[] {
    const defs = [
      { id: 'github', name: 'GitHub', keys: ['GITHUB_TOKEN'] },
      { id: 'telegram', name: 'Telegram', keys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] },
      { id: 'email', name: 'E-mail (SMTP)', keys: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'] },
      { id: 'whatsapp', name: 'WhatsApp (Twilio)', keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WHATSAPP_TO'] },
    ];
    return defs.map((d) => {
      const missing = d.keys.filter((k) => !String(process.env[k] || '').trim());
      return { id: d.id, name: d.name, ready: missing.length === 0, missing: missing };
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
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.type('html').send(WEB_UI_HTML);
    });

    this.app.get('/api/engine/options', (_req, res) => {
      const cfg = this.config.get();
      res.json({
        current: { provider: cfg.provider, model: cfg.model },
        providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, free: p.free, hasKey: p.keyEnv ? this.config.hasKeyFor(p.id) : true })),
        models: MODEL_PRESETS.map((m) => ({ provider: m.provider, id: m.id, label: m.label, note: m.note || '' })),
      });
    });
    this.app.get('/api/notifications', (_req, res) => {
      this.loadNotifications();
      res.json({ notifications: this.notifications.slice(0, 50), unread: this.notifications.filter((n) => !n.read).length });
    });

    this.app.post('/api/notifications/read', (req, res) => {
      this.loadNotifications();
      const id = String((req.body && req.body.id) || '');
      this.notifications = this.notifications.map((n) => (id ? (n.id === id ? Object.assign({}, n, { read: true }) : n) : Object.assign({}, n, { read: true })));
      this.saveNotifications();
      res.json({ ok: true });
    });

    this.app.post('/api/notifications/check', async (_req, res) => {
      try { const list = await this.runBackgroundCheck(); this.startBackgroundWork(); res.json({ ok: true, notifications: list, unread: this.notifications.filter((n) => !n.read).length }); }
      catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.get('/api/keys/verify', async (_req, res) => {
      const scheme = String.fromCharCode(66, 101, 97, 114, 101, 114, 32);
      const targets = [
        { id: 'groq', label: 'Groq (darmowy)', name: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/models', gh: false },
        { id: 'openrouter', label: 'OpenRouter', name: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/auth/key', gh: false },
        { id: 'deepseek', label: 'DeepSeek (platny)', name: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/user/balance', gh: false },
        { id: 'github', label: 'GitHub', name: 'GITHUB_TOKEN', url: 'https://api.github.com/user', gh: true },
      ];
      const out: any[] = [];
      for (const t of targets) {
        let key = '';
        try { key = this.config.secrets.getSecret(t.name) || ''; } catch (e) { key = ''; }
        if (!key) { out.push({ id: t.id, label: t.label, state: 'brak', message: 'Nie wpisano klucza' }); continue; }
        try {
          const auth = t.gh ? ('token '.concat(key)) : scheme.concat(key);
          const hdrs: any = { Authorization: auth };
          if (t.gh) { hdrs['User-Agent'] = 'OmniBot'; }
          const r = await fetch(t.url, { headers: hdrs });
          out.push({ id: t.id, label: t.label, state: r.ok ? 'ok' : 'blad', status: r.status, message: r.ok ? 'Klucz dziala - wszystko w porzadku' : ('Klucz odrzucony przez dostawce (HTTP ' + r.status + ') - wpisz nowy') });
        } catch (e: any) {
          out.push({ id: t.id, label: t.label, state: 'blad', message: 'Blad polaczenia: ' + e.message });
        }
      }
      res.json({ keys: out });
    });

    this.app.get('/api/costs', (_req, res) => {
      const cfg = this.config.get();
      const info: any = providerInfo(cfg.provider);
      const providers = PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        free: p.free,
        active: p.id === cfg.provider,
        hasKey: p.keyEnv ? !!this.config.secrets.getSecret(p.keyEnv) : true,
        signup: p.signup,
      }));
      res.json({
        provider: cfg.provider,
        model: cfg.model,
        free: info.free,
        monthlyPln: 0,
        providers: providers,
      });
    });

    this.app.get('/api/version', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ version: this.appVersion, app: 'omni' });
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

            this.app.get('/offline', (_req, res) => {
      res.type('html').sendFile(path.join(this.assetsDir(), 'offline.html'));
    });

    this.app.get('/sw.js', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('application/javascript').sendFile(path.join(this.assetsDir(), 'sw.js'));
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
        const guard = this.costGuard(body);
        if (guard) { res.status(400).json({ error: guard }); return; }
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

    this.app.get('/api/integrations', (_req, res) => {
      res.json({ integrations: this.integrationStatus() });
    });

    this.app.post('/api/integrations', async (req, res) => {
      try {
        const values = (req.body && req.body.values) || {};
        let saved = 0;
        for (const key of Object.keys(values)) {
          const value = String(values[key] || '').trim();
          if (value) { await this.config.secrets.setSecret(key, value); saved++; }
        }
        this.config.applyToEnv();
        res.json({ ok: true, saved: saved, integrations: this.integrationStatus() });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.get('/api/tunnel', (_req, res) => {
      try {
        const domainFile = path.join(process.env.HOME || '/home/openclaw', '.omni', 'ngrok-domain.txt');
        if (fs.existsSync(domainFile)) {
          const domain = String(fs.readFileSync(domainFile, 'utf8')).trim();
          if (domain) { res.json({ url: 'https://' + domain, connected: true }); return; }
        }
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

    this.app.get('/api/chat', (_req, res) => {
      res.json({ messages: this.chatLog.slice(-120) });
    });

    this.app.get('/api/tasks', (_req, res) => {
      res.json({ tasks: this.recentTasks.slice(-25).reverse() });
    });

    this.app.post('/api/tasks', async (req, res) => {
      const { sessionId, prompt, cwd } = req.body || {};
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

      this.pushChat('user', prompt, (req.body && req.body.clientId) || '');
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

  private loadChat(): void {
    try {
      const file = path.join(this.config.dataDir(), 'chat.json');
      if (fs.existsSync(file)) { this.chatLog = JSON.parse(fs.readFileSync(file, 'utf8')); }
    } catch (error) { this.chatLog = []; }
  }

  private saveChat(): void {
    try {
      this.chatLog = this.chatLog.slice(-200);
      fs.writeFileSync(path.join(this.config.dataDir(), 'chat.json'), JSON.stringify(this.chatLog), 'utf8');
    } catch (error) { }
  }

  private pushChat(role: string, text: string, clientId?: string): void {
    const entry = { role: role, text: String(text || '').slice(0, 8000), ts: Date.now(), clientId: clientId || '' };
    this.chatLog.push(entry);
    this.saveChat();
    this.broadcast({ type: 'chat.message', message: entry });
  }

  private recordTask(task: any) {
    this.pushChat('bot', (task && task.result) ? task.result : ((task && task.error) || ''), '');
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
        this.pushChat('user', data.prompt, data.clientId);
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
