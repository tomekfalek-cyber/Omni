import { ToolDefinition } from 'omni-core/types.js';
import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

function env(name: string): string { return String(process.env[name] || '').trim(); }

const REQUIRED: Record<string, string[]> = {
  github: ['GITHUB_TOKEN'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
  email: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'],
  whatsapp: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WHATSAPP_TO'],
};

export class IntegrationTools {
  public static readonly KEYS: Record<string, string[]> = REQUIRED;

  public getDefinitions(): ToolDefinition[] {
    return [
      { name: 'github_api', description: 'GitHub: wywoluje API (lista repo, utworzenie repo, issues).', parameters: { path: 'string', method: 'string', body: 'string' }, requiresApproval: false, timeoutMs: 35000, maxOutputBytes: 20000 },
      { name: 'telegram_send', description: 'Wysyla wiadomosc na Telegram.', parameters: { text: 'string' }, requiresApproval: false, timeoutMs: 25000, maxOutputBytes: 3000 },
      { name: 'email_send', description: 'Wysyla e-mail przez SMTP.', parameters: { to: 'string', subject: 'string', body: 'string' }, requiresApproval: true, timeoutMs: 40000, maxOutputBytes: 3000 },
      { name: 'whatsapp_send', description: 'Wysyla wiadomosc WhatsApp przez Twilio.', parameters: { text: 'string' }, requiresApproval: true, timeoutMs: 35000, maxOutputBytes: 3000 },
      { name: 'git_push', description: 'Wypycha lokalne repozytorium na GitHub (git push).', parameters: { branch: 'string' }, requiresApproval: false, timeoutMs: 120000, maxOutputBytes: 6000 },
      { name: 'github_create_repo', description: 'Tworzy nowe repozytorium na GitHubie i wypycha do niego projekt.', parameters: { name: 'string', private: 'string' }, requiresApproval: true, timeoutMs: 120000, maxOutputBytes: 6000 }
    ];
  }

  public status(): Array<{ id: string, name: string, ready: boolean, missing: string[] }> {
    const names: Record<string, string> = { github: 'GitHub', telegram: 'Telegram', email: 'E-mail (SMTP)', whatsapp: 'WhatsApp (Twilio)' };
    const out: Array<{ id: string, name: string, ready: boolean, missing: string[] }> = [];
    for (const id of Object.keys(REQUIRED)) {
      const missing = REQUIRED[id].filter((k) => !env(k));
      out.push({ id: id, name: names[id] || id, ready: missing.length === 0, missing: missing });
    }
    return out;
  }

  public async github(args: any): Promise<string> {
    const token = env('GITHUB_TOKEN');
    if (!token) { throw new Error('Brak tokenu GitHub. Dodaj go w zakladce Integracje.'); }
    const raw = String((args && args.path) || '/user').trim();
    const method = String((args && args.method) || 'GET').toUpperCase();
    const url = raw.indexOf('http') === 0 ? raw : 'https://api.github.com' + (raw.indexOf('/') === 0 ? raw : '/' + raw);
    const init: any = {
      method: method,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'OmniBot', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    };
    if (method !== 'GET' && method !== 'HEAD') { init.body = String((args && args.body) || '{}'); }
    const res = await fetch(url, init);
    const text = await res.text();
    return 'GitHub ' + res.status + ' ' + res.statusText + ': ' + text.slice(0, 8000);
  }

  public async telegram(args: any): Promise<string> {
    const token = env('TELEGRAM_BOT_TOKEN');
    const chat = String((args && args.chat) || env('TELEGRAM_CHAT_ID') || '').trim();
    if (!token) { throw new Error('Brak tokenu bota Telegram (zakladka Integracje).'); }
    if (!chat) { throw new Error('Brak chat id (zakladka Integracje).'); }
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String((args && args.text) || '').slice(0, 4000) }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!data || !data.ok) { throw new Error('Telegram blad: ' + JSON.stringify(data).slice(0, 300)); }
    return 'Wyslano na Telegram (chat ' + chat + ').';
  }

  public async whatsapp(args: any): Promise<string> {
    const sid = env('TWILIO_ACCOUNT_SID');
    const auth = env('TWILIO_AUTH_TOKEN');
    const from = env('TWILIO_WHATSAPP_FROM');
    const to = env('TWILIO_WHATSAPP_TO');
    if (!sid || !auth || !from || !to) { throw new Error('Brak danych Twilio (zakladka Integracje).'); }
    const body = new URLSearchParams();
    body.set('From', from.indexOf('whatsapp:') === 0 ? from : 'whatsapp:' + from);
    body.set('To', to.indexOf('whatsapp:') === 0 ? to : 'whatsapp:' + to);
    body.set('Body', String((args && args.text) || '').slice(0, 1500));
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + auth).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) { throw new Error('Twilio blad ' + res.status + ': ' + text.slice(0, 300)); }
    return 'Wyslano WhatsApp (Twilio).';
  }

  private smtpSend(host: string, port: number, user: string, pass: string, from: string, to: string, subject: string, body: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const useTls = port === 465;
      const socket: any = useTls ? tls.connect({ host: host, port: port, servername: host }) : net.connect({ host: host, port: port });
      let buffer = '';
      let step = 0;
      let settled = false;
      const done = (err: any, ok?: string) => {
        if (settled) { return; }
        settled = true;
        try { socket.end(); } catch (e) { }
        if (err) { reject(err); } else { resolve(ok || 'ok'); }
      };
      const timer = setTimeout(() => done(new Error('SMTP: przekroczono czas')), 30000);
      const send = (line: string) => { socket.write(line + String.fromCharCode(13, 10)); };
      const handle = (line: string) => {
        const code = line.slice(0, 3);
        if (step === 0 && code === '220') { send('EHLO omni'); step = 1; return; }
        if (step === 1 && code === '250') { send('AUTH LOGIN'); step = 2; return; }
        if (step === 2 && code === '334') { send(Buffer.from(user).toString('base64')); step = 3; return; }
        if (step === 3 && code === '334') { send(Buffer.from(pass).toString('base64')); step = 4; return; }
        if (step === 4 && code === '235') { send('MAIL FROM:<' + from + '>'); step = 5; return; }
        if (step === 5 && code === '250') { send('RCPT TO:<' + to + '>'); step = 6; return; }
        if (step === 6 && (code === '250' || code === '251')) { send('DATA'); step = 7; return; }
        if (step === 7 && code === '354') {
          const msg = [
            'From: ' + from,
            'To: ' + to,
            'Subject: ' + subject,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            '',
            body,
            '.',
          ].join(String.fromCharCode(13, 10));
          socket.write(msg + String.fromCharCode(13, 10));
          step = 8;
          return;
        }
        if (step === 8 && code === '250') { send('QUIT'); clearTimeout(timer); done(null, 'Wyslano e-mail do ' + to); return; }
        if (code.charAt(0) === '4' || code.charAt(0) === '5') { clearTimeout(timer); done(new Error('SMTP: ' + line.slice(0, 200))); return; }
      };
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let idx = buffer.indexOf(String.fromCharCode(10));
        while (idx !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) { handle(line); }
          idx = buffer.indexOf(String.fromCharCode(10));
        }
      });
      socket.on('error', (err: any) => { clearTimeout(timer); done(new Error('SMTP: ' + err.message)); });
      socket.setTimeout(30000, () => { clearTimeout(timer); done(new Error('SMTP: timeout')); });
    });
  }

  public async email(args: any): Promise<string> {
    const host = env('SMTP_HOST');
    const port = Number(env('SMTP_PORT') || '465');
    const user = env('SMTP_USER');
    const pass = env('SMTP_PASS');
    const from = env('EMAIL_FROM') || user;
    if (!host || !user || !pass) { throw new Error('Brak konfiguracji SMTP (zakladka Integracje).'); }
    const to = String((args && args.to) || '').trim();
    if (!to) { throw new Error('Podaj adresata.'); }
    return await this.smtpSend(host, port, user, pass, from, to, String((args && args.subject) || 'Wiadomosc od Omni'), String((args && args.body) || ''));
  }

  /** Uruchamia git z tokenem pobranym w locie (bez zapisywania go na stale). */
  private async runGit(gitArgs: string[], cwd: string, allowFail?: boolean): Promise<string> {
    const token = String(process.env["GITHUB_TOKEN"] || "").trim();
    if (!token) { throw new Error('Brak tokenu GitHub. Dodaj go w zakladce Integracje.'); }
    const nl = String.fromCharCode(10);
    const tmp = path.join(os.tmpdir(), 'omni-askpass-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '.sh');
    const script = '#!/bin/sh' + nl + 'case "$1" in' + nl + '  *sername*) echo "x-access-token" ;;' + nl + '  *) printf %s ' + JSON.stringify(token) + ' ;;' + nl + 'esac' + nl;
    fs.writeFileSync(tmp, script, { mode: 0o700 });
    try {
      return await new Promise<string>((resolve, reject) => {
        execFile('git', gitArgs, { cwd: cwd, env: Object.assign({}, process.env, { GIT_ASKPASS: tmp, GIT_TERMINAL_PROMPT: '0' }), timeout: 110000, maxBuffer: 4194304 }, (error: any, stdout: any, stderr: any) => {
          const text = String(stdout || '') + String(stderr || '');
          if (error && !allowFail) { reject(new Error(text.slice(0, 600) || error.message)); return; }
          resolve(text.slice(0, 600));
        });
      });
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { }
    }
  }

  public async push(args: any, cwd?: string): Promise<string> {
    const dir = String((args && args.cwd) || cwd || '').trim() || os.homedir();
    const branch = String((args && args.branch) || '').trim();
    const gitArgs = branch ? ['push', 'origin', branch] : ['push'];
    const out = await this.runGit(gitArgs, dir);
    return 'git push w ' + dir + ':' + String.fromCharCode(10) + (out || 'ok');
  }

  public async createRepo(args: any, cwd?: string): Promise<string> {
    const token = String(process.env["GITHUB_TOKEN"] || "").trim();
    if (!token) { throw new Error('Brak tokenu GitHub. Dodaj go w zakladce Integracje.'); }
    const name = String((args && args.name) || '').trim();
    if (!name) { throw new Error('Podaj nazwe repozytorium.'); }
    const scheme = String.fromCharCode(66, 101, 97, 114, 101, 114, 32);
    const isPrivate = String((args && args.private) || '').toLowerCase() === 'true';
    const res = await fetch('https://api.github.com/user/repos', { method: 'POST', headers: { Authorization: scheme.concat(token), Accept: 'application/vnd.github+json', 'User-Agent': 'OmniBot', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, private: isPrivate, auto_init: false }) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) { throw new Error('GitHub: ' + (data && data.message ? data.message : res.status)); }
    const dir = String((args && args.cwd) || cwd || '').trim();
    let pushed = '';
    if (dir && fs.existsSync(path.join(dir, '.git'))) {
      await this.runGit(['remote', 'remove', 'origin'], dir, true);
      await this.runGit(['remote', 'add', 'origin', data.clone_url], dir);
      pushed = await this.runGit(['push', '-u', 'origin', 'HEAD'], dir);
    }
    return 'Utworzono repozytorium: ' + data.full_name + (pushed ? ' | wypchnieto: ' + pushed : '');
  }
}
