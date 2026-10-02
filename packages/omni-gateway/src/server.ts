import express from 'express';
import { extractAny } from './doc-extract.js';
import { execFile } from 'child_process';
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

export const KEY_REGISTRY = [
  { name: 'GROQ_API_KEY', label: 'Groq', desc: 'Darmowy i szybki model tekstowy + rozpoznawanie mowy. Klucz: console.groq.com/keys', group: 'Modele i mowa' },
  { name: 'OPENROUTER_API_KEY', label: 'OpenRouter', desc: 'Darmowe modele chmurowe. Klucz: openrouter.ai/keys', group: 'Modele i mowa' },
  { name: 'GEMINI_API_KEY', label: 'Google AI Studio (Gemini)', desc: 'Wzrok bota (obrazki) + model. Klucz: aistudio.google.com/apikey', group: 'Modele i mowa' },
  { name: 'DEEPSEEK_API_KEY', label: 'DeepSeek', desc: 'Silnik platny - tylko za Twoja zgoda. Klucz: platform.deepseek.com/api_keys', group: 'Modele i mowa' },
  { name: 'GITHUB_TOKEN', label: 'GitHub', desc: 'Repozytoria, wypychanie, powiadomienia. Token: github.com/settings/tokens', group: 'Integracje' },
  { name: 'TELEGRAM_BOT_TOKEN', label: 'Telegram - token bota', desc: 'Utworz bota u @BotFather i wklej token', group: 'Integracje' },
  { name: 'NGROK_AUTHTOKEN', label: 'ngrok - token (staly adres)', desc: 'Token z dashboard.ngrok.com - daje adres, ktory sie NIE zmienia po restarcie', group: 'Adres i zdalny dostep' },
  { name: 'NGROK_DOMAIN', label: 'ngrok - zarezerwowana domena', desc: 'np. exclude-jaunt-subarctic.ngrok-free.dev (Dashboard ngrok -> Domains)', group: 'Adres i zdalny dostep' },
  { name: 'TELEGRAM_CHAT_ID', label: 'Telegram - Twoj chat ID', desc: 'Napisz do bota - odpowie Ci Twoim chat ID', group: 'Integracje' },
];

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
    try {
      if (!this.config.get().accessCode) {
        const gen = String(Math.floor(10000000 + Math.random() * 90000000));
        this.config.save({ accessCode: gen } as any);
        console.log('[Bezpieczenstwo] Brak kodu dostepu - wygenerowalem nowy: ' + gen);
        console.log('[Bezpieczenstwo] Zapisz go! Panel jest teraz chroniony tym kodem.');
      }
    } catch (e) { }
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use((req, res, next) => {
      const started = Date.now();
      const skip = (req.path === '/' || req.path.indexOf('/api/health') === 0 || req.path.indexOf('/api/notifications') === 0);
      res.on('finish', () => {
        if (skip) { return; }
        try {
          const line = JSON.stringify({ at: Date.now(), method: req.method, path: String(req.path).slice(0, 160), status: res.statusCode, ms: Date.now() - started });
          fs.appendFileSync(path.join(process.env.HOME || '/home/openclaw', '.omni', 'activity.log'), line + String.fromCharCode(10));
        } catch (e) { }
      });
      next();
    });

    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.swarm = new SwarmManager();
    this.swarm.onEngineFailure = () => { void this.checkEngineHealth(true); };
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
    setTimeout(() => { void this.checkEngineHealth(); }, 20000);
    setInterval(() => { this.checkReminders(); }, 60000);
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
    void this.checkEngineHealth();
    this.maybeDailySummary();
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
  /** Sprawdza, czy aktywny silnik odpowiada. Jesli nie - przełącza na zdrowy. */
  private async checkEngineHealth(force?: boolean): Promise<void> {
    try {
      const last = Number((this as any).lastEngineCheck || 0);
      if (!force && Date.now() - last < 25 * 60 * 1000) { return; }
      (this as any).lastEngineCheck = Date.now();
      const cfg = this.config.get();
      const active = String(cfg.provider || 'groq');
      const failsPath = path.join(os.homedir(), '.omni', 'engine-fails.json');
      let engineFails: any = {};
      try { engineFails = JSON.parse(fs.readFileSync(failsPath, 'utf8')); } catch (e) { engineFails = {}; }
      const scheme = String.fromCharCode(66, 101, 97, 114, 101, 114, 32);
      const probe = async (id: string): Promise<{ ok: boolean; note: string }> => {
        const keyName: any = { groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };
        const name = keyName[id];
        if (!name) { return { ok: false, note: 'brak klucza' }; }
        let key = '';
        try { key = this.config.secrets.getSecret(name) || ''; } catch (e) { key = ''; }
        if (!key || key.length < 10) { return { ok: false, note: 'brak klucza' }; }
        try {
          let url = '';
          const hdrs: any = {};
          if (id === 'groq') { url = 'https://api.groq.com/openai/v1/models'; hdrs.Authorization = scheme.concat(key); }
          else if (id === 'openrouter') { url = 'https://openrouter.ai/api/v1/auth/key'; hdrs.Authorization = scheme.concat(key); }
          else if (id === 'deepseek') { url = 'https://api.deepseek.com/user/balance'; hdrs.Authorization = scheme.concat(key); }
          else { url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + key; }
          const ctl = new AbortController();
          const t = setTimeout(() => { ctl.abort(); }, 12000);
          const r = await fetch(url, { headers: hdrs, signal: ctl.signal });
          clearTimeout(t);
          return { ok: r.ok, note: 'HTTP ' + r.status };
        } catch (e: any) { return { ok: false, note: e.message }; }
      };
      const chatProbe = async (id: string, useModel?: string): Promise<{ ok: boolean; note: string }> => {
        const keyName: any = { groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };
        const name = keyName[id];
        if (!name) { return { ok: false, note: 'brak klucza' }; }
        let key = '';
        try { key = this.config.secrets.getSecret(name) || ''; } catch (e) { key = ''; }
        if (!key || key.length < 10) { return { ok: false, note: 'brak klucza' }; }
        const cmodel: any = { groq: 'openai/gpt-oss-20b', openrouter: 'nvidia/nemotron-3-super-120b-a12b:free', gemini: 'gemini-flash-latest', deepseek: 'deepseek-flash' };
        const chosenModel = (useModel && String(useModel).trim()) || cmodel[id];
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => { ctl.abort(); }, 15000);
          let r: any;
          if (id === 'gemini') {
            r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + chosenModel + ':generateContent?key=' + encodeURIComponent(key), {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
              signal: ctl.signal,
            });
          } else {
            const base: any = { groq: 'https://api.groq.com/openai/v1', openrouter: 'https://openrouter.ai/api/v1', deepseek: 'https://api.deepseek.com' };
            r = await fetch(base[id] + '/chat/completions', {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: scheme + key },
              body: JSON.stringify({ model: chosenModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
              signal: ctl.signal,
            });
          }
          clearTimeout(t);
          return { ok: r.ok, note: 'HTTP ' + r.status };
        } catch (e: any) { return { ok: false, note: String(e.message || e) }; }
      };
      const test = force ? await chatProbe(active, String(cfg.model || '')) : await probe(active);
      console.log('[Silniki] ' + active + ': ' + (test.ok ? 'dziala' : 'PROBLEM (' + test.note + ')'));
      if (test.ok) { return; }
      engineFails[active] = Date.now();
      try { fs.writeFileSync(failsPath, JSON.stringify(engineFails)); } catch (e) { }
      if (Date.now() - Number((this as any).lastEngineSwitch || 0) < 180 * 1000) { console.log('[Silniki] Cooldown przelaczania - pomijam.'); return; }
      const prefer: any = { groq: 'openai/gpt-oss-120b', openrouter: 'nvidia/nemotron-3-super-120b-a12b:free', gemini: 'gemini-flash-latest', deepseek: 'deepseek-v4-pro' };
      const order = ['groq', 'gemini', 'openrouter', 'deepseek'];
      for (const id of order) {
        if (id === active) { continue; }
        if (engineFails[id] && Date.now() - engineFails[id] < 15 * 60 * 1000) { console.log('[Silniki] Pomijam ' + id + ' (swiezy blad).'); continue; }
        const p = force ? await chatProbe(id, prefer[id]) : await probe(id);
        if (p.ok) {
          await this.config.save({ provider: id, model: prefer[id] } as any);
          this.config.applyToEnv();
          try { this.swarm.reconfigure(); } catch (e) { }
          (this as any).lastEngineSwitch = Date.now();
          this.addNotification('Awaryjne przelaczenie silnika', 'Silnik ' + active + ' nie odpowiadal (' + test.note + '). Przelaczylem na ' + id + ' (' + prefer[id] + ').', 'engine');
          console.log('[Silniki] Przelaczam na ' + id + ' (nowy silnik aktywny od razu).');
          if (this.swarm && this.swarm.busy) {
            console.log('[Silniki] Bot jest zajety - restart odlozony, ale nowy silnik juz dziala.');
            return;
          }
          execFile('systemctl', ['--user', 'restart', 'omni-gateway.service'], () => { });
          return;
        }
      }
      this.addNotification('Silnik nie odpowiada', 'Aktywny silnik ' + active + ' nie odpowiada, a zaden zapasowy nie ma waznego klucza. Wpisz klucz w zakladce Klucze API.', 'engine');
    } catch (error: any) { console.log('[Silniki] Blad sprawdzania: ' + error.message); }
  }
  /** Wysyla ikone apki z katalogu docs (kopiuje do pamieci przy pierwszym uzyciu). */
  private sendIcon(res: any, name: string): void {
    const tries = [
      path.join(process.cwd(), 'docs', name),
      path.join('/home/openclaw/omni', 'docs', name),
      path.join(process.env.HOME || '/home/openclaw', 'omni', 'docs', name),
    ];
    for (const p of tries) {
      try {
        if (fs.existsSync(p)) {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.send(fs.readFileSync(p));
          return;
        }
      } catch (e) { }
    }
    res.status(404).json({ error: 'Brak ikony.' });
  }
  /** Wysyla alert na Telegram wlasciciela (jesli token i chat ID sa ustawione). */
  private async sendTelegramAlert(text: string): Promise<void> {
    try {
      let token = ''; let chat = '';
      try { token = this.config.secrets.getSecret('TELEGRAM_BOT_TOKEN') || ''; } catch (e) { }
      try { chat = this.config.secrets.getSecret('TELEGRAM_CHAT_ID') || ''; } catch (e) { }
      if (!token || !chat) { return; }
      await this.telegramSend(token, chat, text);
    } catch (e) { }
  }
  private summaryFile(): string {
    return path.join(process.env.HOME || '/home/openclaw', '.omni', 'summary.json');
  }

  private buildSummary(): string {
    const home = process.env.HOME || '/home/openclaw';
    const nl = String.fromCharCode(10);
    const rd = (p: string): any => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch (e) { return null; } };
    const chat = rd(path.join(home, '.omni', 'chat.json')) || {};
    const dayAgo = Date.now() - 86400000;
    let msgs = 0;
    for (const k of Object.keys(chat)) { const m = chat[k]; if (m && m.ts && Number(m.ts) >= dayAgo) { msgs++; } }
    const notifs = rd(path.join(home, '.omni', 'notifications.json')) || [];
    let skills = 0;
    try { const sd = path.join(home, '.omni', 'skills'); if (fs.existsSync(sd)) { skills = fs.readdirSync(sd).filter((f) => f.slice(-3) === '.md').length; } } catch (e) { }
    const cfg = this.config.get();
    const lines = [
      'Podsumowanie dnia - ' + new Date().toLocaleDateString('pl-PL'),
      '',
      '- Wiadomosci w ciagu 24 godzin: ' + msgs,
      '- Powiadomienia w kolejce: ' + (Array.isArray(notifs) ? notifs.length : 0),
      '- Skille bota: ' + skills,
      '- Silnik: ' + cfg.provider + ' / ' + cfg.model,
      '- Bot pracuje bez przerwy, a praca w tle czuwa nad GitHubem i powiadomieniami.',
    ];
    return lines.join(nl);
  }

  private maybeDailySummary(): void {
    try {
      const f = this.summaryFile();
      let state: any = {};
      try { if (fs.existsSync(f)) { state = JSON.parse(fs.readFileSync(f, 'utf8')); } } catch (e) { }
      const today = new Date().toISOString().slice(0, 10);
      if (state && state.date === today) { return; }
      if (new Date().getHours() < Number(process.env.OMNI_SUMMARY_HOUR || 8)) { return; }
      const text = this.buildSummary();
      fs.writeFileSync(f, JSON.stringify({ date: today, text: text, at: Date.now() }, null, 2), 'utf8');
      this.addNotification('Podsumowanie dnia', text.split(String.fromCharCode(10)).slice(2).join(' ').slice(0, 220), 'summary');
    } catch (error) { }
  }
  private remindersFile(): string {
    return path.join(process.env.HOME || '/home/openclaw', '.omni', 'reminders.json');
  }

  private loadReminders(): any[] {
    try { const f = this.remindersFile(); if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (Array.isArray(j)) { return j; } } } catch (e) { }
    return [];
  }

  private saveReminders(list: any[]): void {
    try { fs.mkdirSync(path.dirname(this.remindersFile()), { recursive: true }); fs.writeFileSync(this.remindersFile(), JSON.stringify(list.slice(0, 300), null, 2), 'utf8'); } catch (e) { }
  }

  private checkReminders(): void {
    try {
      const list = this.loadReminders();
      let changed = false;
      for (const r of list) {
        if (!r || r.done) { continue; }
        if (Number(r.at) <= Date.now()) {
          r.done = true;
          changed = true;
          this.addNotification('Przypomnienie', String(r.text || ''), 'reminder');
          void this.sendTelegramAlert('Przypomnienie: ' + String(r.text || ''));
        }
      }
      if (changed) { this.saveReminders(list); }
    } catch (e) { }
  }
  private tokenFor(code: string): string {
    return crypto.createHash('sha256').update('omni-gate:' + code).digest('hex');
  }

  private isLocalRequest(req: any): boolean {
    const remote = String((req.socket && req.socket.remoteAddress) || '');
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  }

  private setupAuth() {
    const loginFails: any = {};
    this.app.post('/api/login', (req, res) => {
      const cfg = this.config.get();
      const ip = String(((req.headers['x-forwarded-for'] as any) || req.socket.remoteAddress || '')).split(',')[0].trim();
      const rec = loginFails[ip] || { n: 0, until: 0 };
      if (rec.until && Date.now() < rec.until) { res.status(429).json({ error: 'Za duzo nieudanych prob logowania. Odczekaj 5 minut.' }); return; }
      const code = String((req.body && req.body.code) || '');
      if (!cfg.accessCode) { res.json({ ok: true, note: 'Kod nie jest ustawiony' }); return; }
      if (code !== cfg.accessCode) {
        rec.n = (rec.n || 0) + 1;
        if (rec.n >= 5) { rec.until = Date.now() + 5 * 60 * 1000; rec.n = 0; console.log('[Bezpieczenstwo] 5 nieudanych prob z ' + ip + ' - blokada na 5 minut.'); }
        loginFails[ip] = rec;
        res.status(403).json({ error: 'Zly kod dostepu' });
        return;
      }
      loginFails[ip] = { n: 0, until: 0 };
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

    this.app.get('/api/engines/models', async (_req, res) => {
      try {
        const key = this.config.secrets.getSecret('GROQ_API_KEY') || '';
        if (key.length < 10) { res.status(400).json({ error: 'Brak klucza Groq.' }); return; }
        const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: (String.fromCharCode(66,101,97,114,101,114,32).concat(key)) } });
        const data: any = await r.json().catch(() => ({}));
        const ids = (data && data.data ? data.data : []).map((m: any) => String(m.id));
        const vis = ids.filter((x: string) => (x.indexOf('vision') !== -1) || (x.indexOf('llama-4') !== -1) || (x.indexOf('vl') !== -1));
        res.json({ total: ids.length, vision: vis, all: ids.slice(0, 40) });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.get('/api/engine/options', (_req, res) => {
      const cfg = this.config.get();
      res.json({
        current: { provider: cfg.provider, model: cfg.model },
        providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, free: p.free, hasKey: p.keyEnv ? this.config.hasKeyFor(p.id) : true })),
        models: MODEL_PRESETS.map((m) => ({ provider: m.provider, id: m.id, label: m.label, note: m.note || '' })),
      });
    });
    this.app.get('/api/files', (req, res) => {
      try {
        const root = String(this.config.get().workspaceDir || process.env.HOME || '/home/openclaw');
        const rel = String((req.query && req.query.dir) || '');
        const full = path.resolve(root, rel);
        if (full !== root && full.indexOf(root + path.sep) !== 0) { res.status(400).json({ error: 'Poza katalogiem roboczym.' }); return; }
        if (!fs.existsSync(full)) { res.status(404).json({ error: 'Nie ma takiego katalogu.' }); return; }
        const entries = fs.readdirSync(full).map((name) => {
          let isDir = false; let size = 0;
          try { const st = fs.statSync(path.join(full, name)); isDir = st.isDirectory(); size = st.size; } catch (e) { }
          return { name: name, isDir: isDir, size: size };
        }).sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
        res.json({ root: root, dir: path.relative(root, full) || '.', entries: entries.slice(0, 400) });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.get('/api/files/read', (req, res) => {
      try {
        const root = String(this.config.get().workspaceDir || process.env.HOME || '/home/openclaw');
        const rel = String((req.query && req.query.path) || '');
        const full = path.resolve(root, rel);
        if (full.indexOf(root + path.sep) !== 0) { res.status(400).json({ error: 'Poza katalogiem roboczym.' }); return; }
        if (!fs.existsSync(full)) { res.status(404).json({ error: 'Brak pliku.' }); return; }
        const st = fs.statSync(full);
        if (st.size > 2000000) { res.status(400).json({ error: 'Plik za duzy (limit 2 MB).' }); return; }
        res.json({ ok: true, path: rel, content: fs.readFileSync(full, 'utf8').slice(0, 400000) });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.post('/api/files/save', (req, res) => {
      try {
        const root = String(this.config.get().workspaceDir || process.env.HOME || '/home/openclaw');
        const rel = String((req.body && req.body.path) || '');
        const content = String((req.body && req.body.content) || '');
        const full = path.resolve(root, rel);
        if (full.indexOf(root + path.sep) !== 0) { res.status(400).json({ error: 'Poza katalogiem roboczym.' }); return; }
        fs.writeFileSync(full, content, 'utf8');
        res.json({ ok: true, chars: content.length });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.get('/api/activity', (req, res) => {
      const home = process.env.HOME || '/home/openclaw';
      const lim = Math.min(Number((req.query && req.query.limit) || 120), 500);
      let lines: any[] = [];
      try {
        const f = path.join(home, '.omni', 'activity.log');
        if (fs.existsSync(f)) {
          const raw = fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).filter((l) => l.trim().length > 8);
          lines = raw.slice(-lim).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((x) => x);
        }
      } catch (e) { }
      res.json({ entries: lines.reverse() });
    });
    this.app.get('/api/threads', (_req, res) => {
      const home = process.env.HOME || '/home/openclaw';
      const map: any = {};
      try {
        const f = path.join(home, '.omni', 'chat.json');
        if (fs.existsSync(f)) {
          const chat = JSON.parse(fs.readFileSync(f, 'utf8'));
          for (const k of Object.keys(chat || {})) {
            const m = chat[k];
            if (!m || !m.ts) { continue; }
            const id = String(m.clientId || 'domyslna');
            if (!map[id]) { map[id] = { id: id, count: 0, lastTs: 0, preview: '' }; }
            map[id].count++;
            if (Number(m.ts) >= map[id].lastTs) { map[id].lastTs = Number(m.ts); map[id].preview = String(m.text || '').slice(0, 80); }
          }
        }
      } catch (e) { }
      const list = Object.keys(map).map((k) => map[k]).sort((a, b) => b.lastTs - a.lastTs);
      res.json({ threads: list });
    });

    this.app.post('/api/threads/delete', (req, res) => {
      try {
        const id = String((req.body && req.body.id) || '');
        const home = process.env.HOME || '/home/openclaw';
        const f = path.join(home, '.omni', 'chat.json');
        if (id && fs.existsSync(f)) {
          const chat = JSON.parse(fs.readFileSync(f, 'utf8'));
          const out: any = {};
          for (const k of Object.keys(chat || {})) { if (String((chat[k] || {}).clientId || 'domyslna') !== id) { out[k] = chat[k]; } }
          fs.writeFileSync(f, JSON.stringify(out), 'utf8');
        }
        res.json({ ok: true });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.get('/api/history/search', (req, res) => {
      const home = process.env.HOME || '/home/openclaw';
      const q = String((req.query && req.query.q) || '').trim().toLowerCase();
      if (q.length < 2) { res.json({ query: q, results: [], note: 'Wpisz co najmniej 2 znaki.' }); return; }
      let results: any[] = [];
      try {
        const f = path.join(home, '.omni', 'chat.json');
        if (fs.existsSync(f)) {
          const chat = JSON.parse(fs.readFileSync(f, 'utf8'));
          const keys = Object.keys(chat || {});
          for (const k of keys) {
            const m = chat[k];
            if (!m || typeof m.text !== 'string') { continue; }
            if (m.text.toLowerCase().indexOf(q) !== -1) {
              results.push({ at: Number(m.ts || 0), role: String(m.role || ''), text: String(m.text).slice(0, 400) });
            }
          }
        }
      } catch (e) { }
      results = results.sort((a, b) => b.at - a.at).slice(0, 60);
      res.json({ query: q, count: results.length, results: results });
    });
    this.app.get('/api/reminders', (_req, res) => {
      res.json({ reminders: this.loadReminders() });
    });

    this.app.post('/api/reminders', (req, res) => {
      try {
        const body = req.body || {};
        const text = String(body.text || '').trim();
        const at = Number(body.at || 0);
        if (!text) { res.status(400).json({ error: 'Brak tresci przypomnienia.' }); return; }
        if (!at || at < Date.now() - 60000) { res.status(400).json({ error: 'Podaj czas w przyszlosci.' }); return; }
        const list = this.loadReminders();
        list.push({ id: 'r' + Date.now(), text: text.slice(0, 400), at: at, done: false });
        this.saveReminders(list);
        res.json({ ok: true, reminders: list });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.post('/api/reminders/done', (req, res) => {
      try {
        const id = String((req.body && req.body.id) || '');
        let list = this.loadReminders();
        if (id) { list = list.filter((r) => r.id !== id); }
        this.saveReminders(list);
        res.json({ ok: true, reminders: list });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.get('/api/summary', (_req, res) => {
      try {
        const text = this.buildSummary();
        fs.writeFileSync(this.summaryFile(), JSON.stringify({ date: new Date().toISOString().slice(0, 10), text: text, at: Date.now() }, null, 2), 'utf8');
        res.json({ ok: true, text: text });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.get('/api/summary/last', (_req, res) => {
      let out: any = null;
      try { const f = this.summaryFile(); if (fs.existsSync(f)) { out = JSON.parse(fs.readFileSync(f, 'utf8')); } } catch (e) { }
      res.json({ last: out });
    });
    this.app.get('/api/backup', (_req, res) => {
      const home = process.env.HOME || '/home/openclaw';
      const rd = (p: string): any => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch (e) { return null; } };
      const pack: any = {
        kind: 'omni-backup',
        version: VERSION,
        at: new Date().toISOString(),
        config: this.config.get(),
        chat: rd(path.join(home, '.omni', 'chat.json')),
        notifications: rd(path.join(home, '.omni', 'notifications.json')),
        automations: rd(path.join(home, '.omni', 'automations.json')),
        secretsRaw: (() => { try { const p = path.join(home, '.omni', 'secrets', 'encrypted-secrets.json'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch (e) { return ''; } })(),
        memoryRules: (() => { try { const p = path.join(home, '.omni', 'memory', 'skills.md'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch (e) { return ''; } })(),
        skills: (() => { const out: any[] = []; try { const d = path.join(home, '.omni', 'skills'); if (fs.existsSync(d)) { for (const f of fs.readdirSync(d)) { if (f.slice(-3) === '.md') { out.push({ file: f, content: fs.readFileSync(path.join(d, f), 'utf8') }); } } } } catch (e) { } return out; })(),
      };
      try { delete pack.config.accessCode; } catch (e) { }
      res.json(pack);
    });

    this.app.post('/api/restore', async (req, res) => {
      try {
        const pack = (req.body && req.body.pack) || {};
        if (pack.kind !== 'omni-backup') { res.status(400).json({ error: 'To nie jest kopia Omni.' }); return; }
        const home = process.env.HOME || '/home/openclaw';
        const base = path.join(home, '.omni');
        const wr = (p: string, data: string): void => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data, 'utf8'); } catch (e) { } };
        if (pack.chat) { wr(path.join(base, 'chat.json'), JSON.stringify(pack.chat)); }
        if (pack.notifications) { wr(path.join(base, 'notifications.json'), JSON.stringify(pack.notifications, null, 2)); }
        if (pack.automations) { wr(path.join(base, 'automations.json'), JSON.stringify(pack.automations, null, 2)); }
        if (pack.memoryRules) { wr(path.join(base, 'memory', 'skills.md'), String(pack.memoryRules)); }
        if (pack.secretsRaw) { wr(path.join(base, 'secrets', 'encrypted-secrets.json'), String(pack.secretsRaw)); }
        if (Array.isArray(pack.skills)) { for (const s of pack.skills) { const f = String(s.file || '').replace(new RegExp('[^A-Za-z0-9_.-]', 'g'), ''); if (f) { wr(path.join(base, 'skills', f), String(s.content || '')); } } }
        if (pack.config) { const c = Object.assign({}, pack.config); delete c.accessCode; await this.config.save(c); }
        res.json({ ok: true });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.get('/api/stats', (_req, res) => {
      const home = process.env.HOME || '/home/openclaw';
      const readJson = (p: string): any => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch (e) { return null; } };
      let messages = 0; const perDay: any = {};
      const chat = readJson(path.join(home, '.omni', 'chat.json'));
      if (chat && typeof chat === 'object') {
        for (const k of Object.keys(chat)) {
          const m = chat[k]; if (!m || !m.ts) { continue; }
          messages++;
          const d = new Date(Number(m.ts));
          const key = String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          perDay[key] = (perDay[key] || 0) + 1;
        }
      }
      const days: any[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const key = String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        days.push({ day: key.slice(5), count: perDay[key] || 0 });
      }
      const notifs = readJson(path.join(home, '.omni', 'notifications.json'));
      const autos = readJson(path.join(home, '.omni', 'automations.json'));
      let skills = 0;
      try { const sd = path.join(home, '.omni', 'skills'); if (fs.existsSync(sd)) { skills = fs.readdirSync(sd).filter((f) => f.slice(-3) === '.md').length; } } catch (e) { }
      let rules = 0;
      try { const rf = path.join(home, '.omni', 'memory', 'skills.md'); if (fs.existsSync(rf)) { rules = fs.readFileSync(rf, 'utf8').length; } } catch (e) { }
      let keysSet = 0; let keysAll = 0;
      let ngrokT2 = ''; let ngrokD2 = '';
      try { const y2 = path.join(home, '.config', 'ngrok', 'ngrok.yml'); if (fs.existsSync(y2)) { const raw2 = fs.readFileSync(y2, 'utf8'); const m2 = raw2.match(/authtoken:\s*(\S+)/); if (m2) { ngrokT2 = String(m2[1]); } } } catch (e) { }
      try { const d2 = path.join(home, '.omni', 'ngrok-domain.txt'); if (fs.existsSync(d2)) { ngrokD2 = String(fs.readFileSync(d2, 'utf8')).trim(); } } catch (e) { }
      try {
        keysAll = KEY_REGISTRY.length;
        for (const k of KEY_REGISTRY) {
          let ok = false;
          if (k.name === 'NGROK_AUTHTOKEN') { ok = ngrokT2.length > 10; }
          else if (k.name === 'NGROK_DOMAIN') { ok = ngrokD2.length > 3; }
          else { try { const v = this.config.secrets.getSecret(k.name) || ''; ok = v.length > 0; } catch (e) { } }
          if (ok) { keysSet++; }
        }
      } catch (e) { }
      const mem = process.memoryUsage();
      const up = process.uptime();
      res.json({
        messages: messages,
        days: days,
        notifications: Array.isArray(notifs) ? notifs.length : 0,
        automations: Array.isArray(autos) ? autos.length : Object.keys(autos || {}).length,
        skills: skills,
        rulesChars: rules,
        keysSet: keysSet,
        keysAll: keysAll,
        uptimeMin: Math.round(up / 60),
        memMb: Math.round(mem.rss / 1048576),
        engine: this.config.get().provider,
        model: this.config.get().model,
        version: VERSION,
      });
    });
    this.app.get('/api/memory/overview', (_req, res) => {
      const home = process.env.HOME || '/home/openclaw';
      let rules = '';
      let skills: any[] = [];
      try {
        const rf = path.join(home, '.omni', 'memory', 'skills.md');
        if (fs.existsSync(rf)) { rules = fs.readFileSync(rf, 'utf8'); }
      } catch (e) { }
      try {
        const dir = path.join(home, '.omni', 'skills');
        if (fs.existsSync(dir)) {
          skills = fs.readdirSync(dir).filter((f) => f.slice(-3) === '.md').map((f) => {
            const raw = fs.readFileSync(path.join(dir, f), 'utf8');
            const lines = raw.split(String.fromCharCode(10));
            const title = (lines[0] || f).replace(new RegExp('^#+ '), '');
            const whenLine = lines.filter((l) => l.indexOf('KIEDY:') === 0)[0] || '';
            return { file: f, title: title, when: whenLine.replace('KIEDY: ', ''), chars: raw.length, content: raw.slice(0, 4000) };
          });
        }
      } catch (e) { }
      res.json({ rules: rules.slice(0, 60000), skills: skills });
    });

    this.app.post('/api/memory/rules', (req, res) => {
      try {
        const text = String((req.body && req.body.text) || '').slice(0, 60000);
        const dir = path.join(process.env.HOME || '/home/openclaw', '.omni', 'memory');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'skills.md'), text, 'utf8');
        res.json({ ok: true, chars: text.length });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });

    this.app.post('/api/skills/delete', (req, res) => {
      try {
        const file = String((req.body && req.body.file) || '').replace(new RegExp('[^A-Za-z0-9_.-]', 'g'), '');
        if (!file) { res.status(400).json({ error: 'Brak nazwy.' }); return; }
        const full = path.join(process.env.HOME || '/home/openclaw', '.omni', 'skills', file);
        if (fs.existsSync(full)) { fs.unlinkSync(full); }
        res.json({ ok: true });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.get('/api/secrets/list', (_req, res) => {
      const home = process.env.HOME || '/home/openclaw';
      let ngrokTok = ''; let ngrokDom = '';
      try { const y = path.join(home, '.config', 'ngrok', 'ngrok.yml'); if (fs.existsSync(y)) { const raw = fs.readFileSync(y, 'utf8'); const m = raw.match(/authtoken:\s*(\S+)/); if (m) { ngrokTok = String(m[1]); } } } catch (e) { }
      try { const d = path.join(home, '.omni', 'ngrok-domain.txt'); if (fs.existsSync(d)) { ngrokDom = String(fs.readFileSync(d, 'utf8')).trim(); } } catch (e) { }
      const out = KEY_REGISTRY.map((k) => {
        let set = false; let len = 0;
        if (k.name === 'NGROK_AUTHTOKEN') { set = ngrokTok.length > 10; len = ngrokTok.length; }
        else if (k.name === 'NGROK_DOMAIN') { set = ngrokDom.length > 3; len = ngrokDom.length; }
        else { try { const v = this.config.secrets.getSecret(k.name) || ''; set = v.length > 0; len = v.length; } catch (e) { } }
        return { name: k.name, label: k.label, desc: k.desc, group: k.group, isSet: set, length: len };
      });
      res.json({ keys: out });
    });

    this.app.post('/api/secrets/set', async (req, res) => {
      try {
        const name = String((req.body && req.body.name) || '').trim().toUpperCase();
        const value = String((req.body && req.body.value) || '').trim();
        const known = KEY_REGISTRY.filter((k) => k.name === name)[0];
        if (!known) { res.status(400).json({ error: 'Nieznany klucz.' }); return; }
        if (value.length < 4) { res.status(400).json({ error: 'Wartosc jest za krotka.' }); return; }
        if (name === 'NGROK_DOMAIN') {
          fs.writeFileSync(path.join(process.env.HOME || '/home/openclaw', '.omni', 'ngrok-domain.txt'), value, 'utf8');
          execFile('systemctl', ['--user', 'restart', 'omni-ngrok.service'], () => { });
          res.json({ ok: true, name: name }); return;
        }
        if (name === 'NGROK_AUTHTOKEN') {
          const yml = path.join(process.env.HOME || '/home/openclaw', '.config', 'ngrok', 'ngrok.yml');
          let raw = fs.existsSync(yml) ? fs.readFileSync(yml, 'utf8') : 'version: "3"';
          const idx = raw.indexOf('authtoken:');
          if (idx !== -1) {
            const lineEnd = raw.indexOf(String.fromCharCode(10), idx);
            const rest = lineEnd === -1 ? '' : raw.slice(lineEnd);
            raw = raw.slice(0, idx) + 'authtoken: ' + value + rest;
          } else {
            raw = raw + String.fromCharCode(10) + 'agent:' + String.fromCharCode(10) + '    authtoken: ' + value + String.fromCharCode(10);
          }
          fs.writeFileSync(yml, raw, 'utf8');
          execFile('systemctl', ['--user', 'restart', 'omni-ngrok.service'], () => { });
          res.json({ ok: true, name: name }); return;
        }
        const patch: any = {};
        patch[name] = value;
        await this.config.save({}, patch);
        this.config.applyToEnv();
        try { this.swarm.reconfigure(); console.log('[Klucze] Przeladowano silniki po zapisie klucza: ' + name); } catch (e) { }
        this.startTelegram();
        res.json({ ok: true, name: name });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
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

    this.app.post('/api/docs/extract', express.raw({ type: ['application/octet-stream', 'application/pdf', 'text/plain'], limit: '30mb' }), async (req, res) => {
      try {
        const buf = req.body as Buffer;
        if (!buf || !buf.length) { res.status(400).json({ error: 'Brak pliku.' }); return; }
        const out = extractAny(buf);
        const text = String(out.text || '').slice(0, 200000);
        if (!text) { res.status(400).json({ error: 'Nie udalo sie wyciagnac tekstu - moze to skan albo obraz?' }); return; }
        res.json({ ok: true, kind: out.kind, chars: text.length, text: text });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.post('/api/vision/ask', async (req, res) => {
      try {
        const body = req.body || {};
        const image = String(body.image || '');
        const question = String(body.question || '').trim();
        if (image.indexOf('data:image/') !== 0) { res.status(400).json({ error: 'Brak obrazka.' }); return; }
        let key = this.config.secrets.getSecret('GEMINI_API_KEY') || '';
        let endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
        let candidates = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.5-flash'];
        if (key.length < 10) { key = this.config.secrets.getSecret('OPENROUTER_API_KEY') || ''; endpoint = 'https://openrouter.ai/api/v1/chat/completions'; candidates = ['qwen/qwen2.5-vl-72b-instruct', 'openai/gpt-4o-mini']; }
        if (key.length < 10) { key = this.config.secrets.getSecret('GROQ_API_KEY') || ''; endpoint = 'https://api.groq.com/openai/v1/chat/completions'; candidates = ['meta-llama/llama-4-scout-17b-16e-instruct']; }
        if (key.length < 10) { res.status(400).json({ error: 'Wzrok potrzebuje klucza Google AI Studio (Gemini) - jest darmowy: aistudio.google.com/apikey . Wpisz go w zakladce Modele i klucze.' }); return; }

        let answer = '';
        let lastErr = '';
        for (const vm of candidates) {
          const payload = {
            model: vm,
            messages: [{ role: 'user', content: [
              { type: 'text', text: question || 'Opisz dokladnie, co widzisz na tym obrazku. Odpowiedz po polsku.' },
              { type: 'image_url', image_url: { url: image } },
            ] }],
            max_tokens: 900,
          };
          const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: (String.fromCharCode(66,101,97,114,101,114,32).concat(key)) }, body: JSON.stringify(payload) });
          const data: any = await r.json().catch(() => ({}));
          if (r.ok && data && data.choices && data.choices[0] && data.choices[0].message) {
            answer = String(data.choices[0].message.content || '').trim();
            if (answer) { console.log('[Wzrok] Model: ' + vm); break; }
          } else {
            lastErr = lastErr + ' [' + vm + ': ' + String((data && data.error && data.error.message) || ('HTTP ' + r.status)) + ']';
          }
        }
        if (!answer) { res.status(500).json({ error: 'Nie udalo sie przeanalizowac obrazka: ' + lastErr }); return; }
        res.json({ ok: true, text: answer });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
    });
    this.app.post('/api/voice/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }), async (req, res) => {
      try {
        const key = this.config.secrets.getSecret('GROQ_API_KEY') || '';
        if (key.length < 10) { res.status(400).json({ error: 'Brak klucza Groq - wpisz go w zakladce Modele i klucze.' }); return; }
        const buf = req.body as Buffer;
        if (!buf || !buf.length) { res.status(400).json({ error: 'Brak nagrania.' }); return; }
        const fd = new FormData();
        const bytes = new Uint8Array(buf);
        fd.append('file', new Blob([bytes], { type: 'audio/webm' }), 'nagranie.webm');
        fd.append('model', 'whisper-large-v3');
        fd.append('language', 'pl');
        fd.append('prompt', 'Omni. Rozmowa z asystentem o nazwie Omni. Nazwy wlasne: Omni, Omni, oprogramowanie Omni.');
        const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: ('Bearer '.concat(key)) }, body: fd });
        const data: any = await r.json().catch(() => ({}));
        if (!r.ok) { res.status(500).json({ error: 'Rozpoznawanie nieudane (HTTP ' + r.status + ')' }); return; }
        let out = String(data.text || '').trim();
        try {
          const nm = String(this.config.get().botName || 'Omni');
          out = out.replace(new RegExp('\\b(o+m+n+i|o+m+i|anni|annie|anny|omny)\\b', 'gi'), nm);
        } catch (e) { }
        res.json({ ok: true, text: out });
      } catch (error: any) { res.status(500).json({ error: error.message }); }
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
