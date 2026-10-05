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
  jira: ['JIRA_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
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
      { name: 'github_create_repo', description: 'Tworzy nowe repozytorium na GitHubie i wypycha do niego projekt.', parameters: { name: 'string', private: 'string' }, requiresApproval: true, timeoutMs: 120000, maxOutputBytes: 6000 },
      { name: 'jira_search', description: 'Jira: szuka zadan jezykiem JQL (np. "project = ABC AND status != Done"). Parametry: jql, limit, fields.', parameters: { jql: 'string', limit: 'number', fields: 'string' }, requiresApproval: false, timeoutMs: 25000, maxOutputBytes: 30000 },
      { name: 'jira_get_issue', description: 'Jira: szczegoly zadania po kluczu (np. ABC-123).', parameters: { key: 'string' }, requiresApproval: false, timeoutMs: 20000, maxOutputBytes: 20000 },
      { name: 'jira_create_issue', description: 'Jira: zaklada nowe zadanie (Task/Story/Bug). Parametry: project, summary, type, description, priority, labels, assignee.', parameters: { project: 'string', summary: 'string', type: 'string', description: 'string', priority: 'string', labels: 'string', assignee: 'string' }, requiresApproval: false, timeoutMs: 25000, maxOutputBytes: 4000 },
      { name: 'jira_update_issue', description: 'Jira: aktualizuje zadanie (pola) i/lub zmienia status (transition, np. "In Progress").', parameters: { key: 'string', summary: 'string', priority: 'string', assignee: 'string', labels: 'string', transition: 'string' }, requiresApproval: false, timeoutMs: 25000, maxOutputBytes: 4000 },
      { name: 'jira_comment', description: 'Jira: dodaje komentarz do zadania.', parameters: { key: 'string', text: 'string' }, requiresApproval: false, timeoutMs: 20000, maxOutputBytes: 3000 },
      { name: 'jira_boards', description: 'Jira: lista tablic agile (board) w Jira.', parameters: {}, requiresApproval: false, timeoutMs: 20000, maxOutputBytes: 10000 },
      { name: 'jira_sprints', description: 'Jira: lista sprintow tablicy. Parametry: boardId, state (active,future,closed).', parameters: { boardId: 'string', state: 'string' }, requiresApproval: false, timeoutMs: 20000, maxOutputBytes: 10000 },
      { name: 'jira_report', description: 'Jira: agreguje dane z JQL do raportu (liczby wg statusu, osoby, typu, priorytetu).', parameters: { jql: 'string' }, requiresApproval: false, timeoutMs: 30000, maxOutputBytes: 20000 },
    ];
  }

  public status(): Array<{ id: string, name: string, ready: boolean, missing: string[] }> {
    const names: Record<string, string> = { github: 'GitHub', telegram: 'Telegram', email: 'E-mail (SMTP)', whatsapp: 'WhatsApp (Twilio)', jira: 'Jira (Atlassian)' };
    const out: Array<{ id: string, name: string, ready: boolean, missing: string[] }> = [];
    for (const id of Object.keys(REQUIRED)) {
      const missing = REQUIRED[id].filter((k) => !env(k));
      out.push({ id: id, name: names[id] || id, ready: missing.length === 0, missing: missing });
    }
    return out;
  }

  // ---- JIRA (Atlassian Cloud) ----
  private jiraAuth(): { base: string, headers: any } {
    const base = env('JIRA_URL').replace(/\/+$/, '');
    const email = env('JIRA_EMAIL');
    const token = env('JIRA_API_TOKEN');
    if (!base || !email || !token) { throw new Error('Brak danych Jira (JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN). Dodaj je w zakladce Integracje.'); }
    const auth = Buffer.from(email + ':' + token).toString('base64');
    return { base: base, headers: { Authorization: 'Basic ' + auth, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'OmniBot' } };
  }
  private async jiraFetch(path: string, method: string, body?: any): Promise<any> {
    const a = this.jiraAuth();
    const res = await fetch(a.base + path, { method: method, headers: a.headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch (e) { json = null; }
    if (!res.ok) { throw new Error('Jira ' + res.status + ': ' + (json && json.errorMessages ? json.errorMessages.join('; ') : text.slice(0, 300))); }
    return json === null ? text : json;
  }
  public async jiraSearch(args: any): Promise<string> {
    const jql = String((args && args.jql) || '').trim() || 'order by updated DESC';
    const limit = Math.min(Math.max(1, Number((args && args.limit) || 30)), 100);
    const fields = String((args && args.fields) || 'summary,status,assignee,priority,issuetype,updated');
    const data = await this.jiraFetch('/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&maxResults=' + limit + '&fields=' + encodeURIComponent(fields), 'GET');
    const issues = (data.issues || []).map((i: any) => { const f = i.fields || {}; return { key: i.key, summary: f.summary, status: f.status && f.status.name, type: f.issuetype && f.issuetype.name, priority: f.priority && f.priority.name, assignee: (f.assignee && (f.assignee.displayName || f.assignee.name)) || null }; });
    return JSON.stringify({ jql: jql, total: data.total, zwrocono: issues.length, issues: issues }, null, 2);
  }
  public async jiraGet(args: any): Promise<string> {
    const key = String((args && args.key) || '').trim();
    if (!key) { throw new Error('Podaj klucz zadania (np. PROJ-123).'); }
    const data = await this.jiraFetch('/rest/api/2/issue/' + encodeURIComponent(key) + '?fields=summary,description,status,assignee,reporter,priority,issuetype,created,updated,labels,comment,parent', 'GET');
    const f = data.fields || {};
    const desc = typeof f.description === 'string' ? f.description : (f.description ? '(opis ADF - szczegoly w Jira)' : '');
    return JSON.stringify({ key: data.key, summary: f.summary, type: f.issuetype && f.issuetype.name, status: f.status && f.status.name, assignee: f.assignee && f.assignee.displayName, reporter: f.reporter && f.reporter.displayName, priority: f.priority && f.priority.name, labels: f.labels, parent: f.parent && f.parent.key, description: desc, komentarze: ((f.comment && f.comment.comments) || []).length }, null, 2);
  }
  public async jiraCreate(args: any): Promise<string> {
    const project = String((args && args.project) || '').trim();
    const summary = String((args && args.summary) || '').trim();
    const type = String((args && args.type) || 'Task').trim();
    const description = String((args && args.description) || '').trim();
    const priority = String((args && args.priority) || '').trim();
    const assignee = String((args && args.assignee) || '').trim();
    const labels = String((args && args.labels) || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    if (!project || !summary) { throw new Error('Podaj project (klucz projektu) i summary.'); }
    const fields: any = { project: { key: project }, summary: summary, issuetype: { name: type } };
    if (description) { fields.description = description; }
    if (priority) { fields.priority = { name: priority }; }
    if (labels.length) { fields.labels = labels; }
    if (assignee) { fields.assignee = { name: assignee }; }
    const data = await this.jiraFetch('/rest/api/2/issue', 'POST', { fields: fields });
    return 'Utworzono zadanie: ' + data.key + ' -> ' + this.jiraAuth().base + '/browse/' + data.key;
  }
  public async jiraUpdate(args: any): Promise<string> {
    const key = String((args && args.key) || '').trim();
    if (!key) { throw new Error('Podaj key zadania.'); }
    const fields: any = {};
    if (args && args.summary) { fields.summary = String(args.summary); }
    if (args && args.priority) { fields.priority = { name: String(args.priority) }; }
    if (args && args.assignee) { fields.assignee = { name: String(args.assignee) }; }
    if (args && args.labels) { fields.labels = String(args.labels).split(',').map((s: string) => s.trim()).filter(Boolean); }
    let msg = 'Zaktualizowano ' + key;
    if (Object.keys(fields).length) { await this.jiraFetch('/rest/api/2/issue/' + encodeURIComponent(key), 'PUT', { fields: fields }); }
    if (args && args.transition) {
      const t = await this.jiraFetch('/rest/api/2/issue/' + encodeURIComponent(key) + '/transitions', 'GET');
      const wanted = String(args.transition).toLowerCase();
      const tr = (t.transitions || []).find((x: any) => String(x.name).toLowerCase() === wanted || String(x.id) === wanted);
      if (!tr) { throw new Error('Nie znaleziono przejscia "' + args.transition + '". Dostepne: ' + (t.transitions || []).map((x: any) => x.name).join(', ')); }
      await this.jiraFetch('/rest/api/2/issue/' + encodeURIComponent(key) + '/transitions', 'POST', { transition: { id: tr.id } });
      msg += ' + przejscie na "' + tr.name + '"';
    }
    return msg;
  }
  public async jiraComment(args: any): Promise<string> {
    const key = String((args && args.key) || '').trim();
    const body = String((args && args.text) || '').trim();
    if (!key || !body) { throw new Error('Podaj key i text.'); }
    await this.jiraFetch('/rest/api/2/issue/' + encodeURIComponent(key) + '/comment', 'POST', { body: body });
    return 'Dodano komentarz do ' + key;
  }
  public async jiraBoards(_args: any): Promise<string> {
    const data = await this.jiraFetch('/rest/agile/1.0/board?maxResults=50', 'GET');
    const boards = (data.values || []).map((b: any) => ({ id: b.id, name: b.name, type: b.type, project: b.location && b.location.projectKey }));
    return JSON.stringify({ boards: boards }, null, 2);
  }
  public async jiraSprints(args: any): Promise<string> {
    const boardId = String((args && args.boardId) || '').trim();
    if (!boardId) { throw new Error('Podaj boardId (z narzedzia jira_boards).'); }
    const state = String((args && args.state) || 'active,future').trim();
    const data = await this.jiraFetch('/rest/agile/1.0/board/' + encodeURIComponent(boardId) + '/sprint?state=' + encodeURIComponent(state) + '&maxResults=50', 'GET');
    const sprints = (data.values || []).map((s: any) => ({ id: s.id, name: s.name, state: s.state, start: s.startDate, end: s.endDate }));
    return JSON.stringify({ sprints: sprints }, null, 2);
  }
  public async jiraReport(args: any): Promise<string> {
    const jql = String((args && args.jql) || '').trim();
    if (!jql) { throw new Error('Podaj jql, np. "project = ABC AND sprint in openSprints()".'); }
    const data = await this.jiraFetch('/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&maxResults=100&fields=status,assignee,priority,issuetype', 'GET');
    const issues = data.issues || [];
    const byStatus: any = {}; const byAssignee: any = {}; const byType: any = {}; const byPriority: any = {};
    for (const i of issues) {
      const f = i.fields || {};
      const st = (f.status && f.status.name) || '-';
      const as = (f.assignee && f.assignee.displayName) || 'Nieprzypisane';
      const ty = (f.issuetype && f.issuetype.name) || '-';
      const pr = (f.priority && f.priority.name) || '-';
      byStatus[st] = (byStatus[st] || 0) + 1; byAssignee[as] = (byAssignee[as] || 0) + 1; byType[ty] = (byType[ty] || 0) + 1; byPriority[pr] = (byPriority[pr] || 0) + 1;
    }
    return JSON.stringify({ jql: jql, total: data.total, przebadano: issues.length, wgStatusu: byStatus, wgOsoby: byAssignee, wgTypu: byType, wgPriorytetu: byPriority }, null, 2);
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
