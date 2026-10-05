import { ToolDefinition, ToolCall } from 'omni-core/types.js';
import { ApprovalManager } from 'omni-core/approval-manager.js';
import * as fs from 'fs';
import * as path from 'path';
import { FileTools } from './tools/file-tools.js';
import { GitTools } from './tools/git-tools.js';
import { ShellSandbox } from './tools/shell-sandbox.js';
import { WebTools } from './tools/web-tools.js';
import { IntegrationTools } from './tools/integration-tools.js';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileP = promisify(execFile);

export class ToolRegistry {
  private tools: Map<string, {
    definition: ToolDefinition;
    execute: (args: any, cwd: string) => Promise<any>;
  }> = new Map();

  public approvalManager: ApprovalManager;

  constructor() {
    this.approvalManager = new ApprovalManager();
    this.initializeTools();
  }

  private initializeTools() {
    const fileTools = new FileTools();
    const gitTools = new GitTools();
    const shellSandbox = new ShellSandbox();

    // Rejestracja File Tools
    this.registerTool(fileTools.getDefinitions()[0], (args, cwd) => fileTools.readFile(args, cwd));
    this.registerTool(fileTools.getDefinitions()[1], (args, cwd) => fileTools.writeFile(args, cwd));
    this.registerTool(fileTools.getDefinitions()[2], (args, cwd) => fileTools.listFiles(args, cwd));

    // Rejestracja Git Tools
    this.registerTool(gitTools.getDefinitions()[0], (args, cwd) => gitTools.getStatus(cwd));
    this.registerTool(gitTools.getDefinitions()[1], (args, cwd) => gitTools.getDiff(args, cwd));
    this.registerTool(gitTools.getDefinitions()[2], (args, cwd) => gitTools.addAndCommit(args, cwd));

    // Rejestracja Shell Sandbox
    this.registerTool(shellSandbox.getDefinitions()[0], (args, cwd) => shellSandbox.execute(args, cwd));
    this.registerTool(shellSandbox.getDefinitions()[1], (args: any, cwd: string) => shellSandbox.runCode(args, cwd));
    this.registerTool(shellSandbox.getDefinitions()[2], (args: any, cwd: string) => shellSandbox.runBackground(args, cwd));
    // Codebase awareness: mapa projektu + szukanie symbolu jednym narzedziem.
    this.registerTool({
      name: 'code_map',
      description: 'Mapa projektu do zrozumienia kodu przed zmiana: struktura katalogow, pliki kluczowe, statystyki i szukanie symbolu/tekstu. Podaj path (katalog) i opcjonalnie query.',
      parameters: { path: 'string', query: 'string' },
      requiresApproval: false,
      timeoutMs: 20000,
      maxOutputBytes: 40000,
    }, async (args: any, cwd: string) => {
      const base = path.resolve(cwd, String((args && args.path) || '.'));
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.cache', '.venv', 'venv']);
      const extCount: any = {};
      const dirs: string[] = [];
      let files = 0;
      const walk = (dir: string, depth: number) => {
        if (depth > 3) { return; }
        let entries: any[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) as any[]; } catch (e) { return; }
        for (const e of entries) {
          if (skip.has(e.name)) { continue; }
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { dirs.push(full.replace(base, '.')); walk(full, depth + 1); }
          else { files++; const ext = path.extname(e.name) || '(brak)'; extCount[ext] = (extCount[ext] || 0) + 1; }
        }
      };
      walk(base, 0);
      const out: string[] = [];
      out.push('KATALOG: ' + base);
      out.push('PLIKI: ' + files + ' | katalogi: ' + dirs.length);
      out.push('TYPY: ' + Object.keys(extCount).sort((a, b) => extCount[b] - extCount[a]).slice(0, 12).map((k) => k + '=' + extCount[k]).join(', '));
      out.push('STRUKTURA: ' + dirs.slice(0, 60).join(' '));
      const keyFiles = ['package.json', 'tsconfig.json', 'README.md', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Makefile', 'docker-compose.yml'];
      for (const kf of keyFiles) { const p = path.join(base, kf); if (fs.existsSync(p)) { out.push('--- ' + kf + ' ---'); try { out.push(fs.readFileSync(p, 'utf8').slice(0, 800)); } catch (e) { } } }
      // A3: glebsza swiadomosc codebase - symbole (funkcje/klasy) i importy.
      const symExts = new Set(['.py', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs']);
      const symLines: string[] = [];
      let scanned = 0;
      const scanSyms = (dir: string, depth: number) => {
        if (depth > 3 || scanned >= 40 || symLines.length >= 200) { return; }
        let es: any[] = [];
        try { es = fs.readdirSync(dir, { withFileTypes: true }) as any[]; } catch (e) { return; }
        for (const e of es) {
          if (skip.has(e.name) || scanned >= 40 || symLines.length >= 200) { continue; }
          const full2 = path.join(dir, e.name);
          if (e.isDirectory()) { scanSyms(full2, depth + 1); continue; }
          if (!symExts.has(path.extname(e.name))) { continue; }
          scanned++;
          try {
            const txt = fs.readFileSync(full2, 'utf8').slice(0, 20000);
            const ls = txt.split(String.fromCharCode(10));
            const syms: string[] = []; const imps: string[] = [];
            for (const ln of ls) {
              const t = ln.trim();
              const m = t.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/) || t.match(/^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/) || t.match(/^def\s+([A-Za-z0-9_]+)/) || t.match(/^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
              if (m) { syms.push(m[1]); continue; }
              if (/^(?:import\s|from\s+[A-Za-z0-9_.]+\s+import\s)/.test(t)) { imps.push(t.slice(0, 70)); }
            }
            if (syms.length || imps.length) { symLines.push(full2.replace(base, '.') + ': ' + (syms.length ? '[' + syms.slice(0, 12).join(', ') + ']' : '') + (imps.length ? '  <- ' + imps.slice(0, 3).join(' ; ') : '')); }
          } catch (e) { }
        }
      };
      scanSyms(base, 0);
      if (symLines.length) { out.push('--- SYMBOLE (funkcje/klasy/importy) ---'); out.push.apply(out, symLines); }
      const q = String((args && args.query) || '').trim();
      if (q) {
        const hits: string[] = [];
        const grep = (dir: string, depth: number) => {
          if (depth > 4 || hits.length >= 30) { return; }
          let es: any[] = [];
          try { es = fs.readdirSync(dir, { withFileTypes: true }) as any[]; } catch (e) { return; }
          for (const e of es) {
            if (skip.has(e.name) || hits.length >= 30) { continue; }
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { grep(full, depth + 1); continue; }
            try {
              const txt = fs.readFileSync(full, 'utf8');
              if (txt.indexOf(q) !== -1) {
                const lines = txt.split(String.fromCharCode(10));
                for (let i = 0; i < lines.length && hits.length < 30; i++) { if (lines[i].indexOf(q) !== -1) { hits.push(full.replace(base, '.') + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 140)); } }
              }
            } catch (e) { }
          }
        };
        grep(base, 0);
        out.push('--- SZUKANO: ' + q + ' (trafien: ' + hits.length + ') ---');
        out.push(hits.join(String.fromCharCode(10)) || 'brak trafien');
      }
      return out.join(String.fromCharCode(10)).slice(0, 39000);
    });
    // Przypomnienia: bot naprawde ustawia je z czatu (ten sam plik, ktory czyta harmonogram)
    const remFile = () => path.join(process.env.HOME || '/home/openclaw', '.omni', 'reminders.json');
    const readRem = () => { try { const f = remFile(); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; } catch (e) { return []; } };
    const writeRem = (list: any[]) => { const f = remFile(); try { fs.mkdirSync(path.dirname(f), { recursive: true }); } catch (e) { } fs.writeFileSync(f, JSON.stringify(list, null, 2), 'utf8'); };
    this.registerTool({
      name: 'reminder_set',
      description: 'Ustawia przypomnienie. Podaj text oraz czas: at (ISO, np. 2026-10-01T16:30:00) albo inMinutes (za ile minut).',
      parameters: { text: 'string', at: 'string', inMinutes: 'number' },
      requiresApproval: false,
      timeoutMs: 5000,
      maxOutputBytes: 4000,
    }, async (args: any) => {
      const text = String((args && args.text) || '').trim();
      if (!text) { return 'BLAD: podaj tresc przypomnienia.'; }
      let at = 0;
      if (args && args.at) { at = Date.parse(String(args.at)); }
      else if (args && args.inMinutes !== undefined) { at = Date.now() + Number(args.inMinutes) * 60000; }
      if (!at || isNaN(at)) { return 'BLAD: podaj czas (at ISO albo inMinutes).'; }
      if (at <= Date.now()) { return 'BLAD: czas musi byc w przyszlosci. Teraz jest ' + new Date().toLocaleString('pl-PL') + '.'; }
      const list = readRem();
      list.push({ id: 'r' + Date.now(), text: text.slice(0, 400), at: at, done: false });
      writeRem(list);
      return 'Przypomnienie ustawione na ' + new Date(at).toLocaleString('pl-PL') + ': ' + text + '. Powiadomienie przyjdzie do panelu (popup), a przy ustawionym Telegramie takze na telefon.';
    });
    this.registerTool({
      name: 'reminder_list',
      description: 'Wypisuje ustawione przypomnienia.',
      parameters: {},
      requiresApproval: false,
      timeoutMs: 5000,
      maxOutputBytes: 6000,
    }, async () => {
      const list = readRem();
      if (!list.length) { return 'Brak przypomnien.'; }
      return list.map((r: any) => (r.done ? '[x] ' : '[ ] ') + new Date(Number(r.at)).toLocaleString('pl-PL') + ' - ' + String(r.text || '')).join(String.fromCharCode(10));
    });


    // Narzedzia internetowe (bez kluczy API)
    const webTools = new WebTools();
    this.registerTool(webTools.getDefinitions()[0], (args) => webTools.search(args));
    this.registerTool(webTools.getDefinitions()[1], (args) => webTools.fetchUrl(args));
    this.registerTool(webTools.getDefinitions()[2], (args) => webTools.crypto(args));
    this.registerTool(webTools.getDefinitions()[3], (args) => webTools.news(args));
    this.registerTool(webTools.getDefinitions()[4], (args) => webTools.image(args));

    // Narzedzia diagnostyczne READ-ONLY (bez zmian w systemie).
    this.registerTool({
      name: 'log_tail',
      description: 'Pokazuje ostatnie linie pliku logu (read-only). Parametry: path (sciezka), lines (ile, max 200).',
      parameters: { path: 'string', lines: 'number' },
      requiresApproval: false, timeoutMs: 8000, maxOutputBytes: 20000,
    }, async (args: any) => {
      const p = String((args && args.path) || '').trim();
      if (!p) { throw new Error('Podaj sciezke pliku logu.'); }
      const n = Math.min(Math.max(1, Number((args && args.lines) || 50)), 200);
      const st = fs.statSync(p);
      const start = Math.max(0, st.size - 262144);
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      const lines = buf.toString('utf8').split(String.fromCharCode(10));
      return 'Ostatnie ' + n + ' linii z ' + p + ':' + String.fromCharCode(10) + lines.slice(-n).join(String.fromCharCode(10));
    });
    this.registerTool({
      name: 'proc_inspect',
      description: 'Lista procesow (read-only): PID, CPU%, RAM%, czas, komenda. Parametr: filter (opcjonalny fragment nazwy).',
      parameters: { filter: 'string' },
      requiresApproval: false, timeoutMs: 8000, maxOutputBytes: 20000,
    }, async (args: any) => {
      const filter = String((args && args.filter) || '').trim();
      const rr = await execFileP('ps', ['-eo', 'pid,pcpu,pmem,etime,args', '--sort=-pcpu'], { timeout: 6000, maxBuffer: 2000000 });
      const all = String(rr.stdout).split(String.fromCharCode(10));
      const rest = all.slice(1).filter((l) => !filter || l.toLowerCase().indexOf(filter.toLowerCase()) !== -1);
      return 'Procesy' + (filter ? ' (filtr: ' + filter + ')' : '') + ':' + String.fromCharCode(10) + all[0] + String.fromCharCode(10) + rest.slice(0, 40).join(String.fromCharCode(10));
    });
    this.registerTool({
      name: 'net_summary',
      description: 'Stan sieci i nasluchujacych portow (read-only): ss -tuln lub netstat.',
      parameters: {},
      requiresApproval: false, timeoutMs: 8000, maxOutputBytes: 20000,
    }, async () => {
      let out = '';
      try { const rr = await execFileP('ss', ['-tuln'], { timeout: 6000, maxBuffer: 1000000 }); out = String(rr.stdout); }
      catch (e) { const rr2 = await execFileP('netstat', ['-tuln'], { timeout: 6000, maxBuffer: 1000000 }); out = String(rr2.stdout); }
      return 'Nasluchujace porty/sockety (read-only):' + String.fromCharCode(10) + out.slice(0, 19000);
    });
    this.registerTool({
      name: 'file_hash',
      description: 'Liczy SHA-256 pliku (read-only). Parametr: path.',
      parameters: { path: 'string' },
      requiresApproval: false, timeoutMs: 15000, maxOutputBytes: 2000,
    }, async (args: any) => {
      const p = String((args && args.path) || '').trim();
      if (!p) { throw new Error('Podaj sciezke pliku.'); }
      const st = fs.statSync(p);
      const h = crypto.createHash('sha256');
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(65536);
      let n = 0;
      do { n = fs.readSync(fd, buf, 0, buf.length, null); if (n > 0) { h.update(buf.subarray(0, n)); } } while (n > 0);
      fs.closeSync(fd);
      return 'SHA-256 ' + p + ' (' + st.size + ' B): ' + h.digest('hex');
    });
    this.registerTool({
      name: 'http_request',
      description: 'Wywoluje dowolny HTTP API (GET/POST/PUT/DELETE). Parametry: url, method, headers (JSON), body.',
      parameters: { url: 'string', method: 'string', headers: 'string', body: 'string' },
      requiresApproval: false, timeoutMs: 30000, maxOutputBytes: 30000,
    }, async (args: any) => {
      const url = String((args && args.url) || '').trim();
      if (url.indexOf('http') !== 0) { throw new Error('Podaj poprawny url (http/https).'); }
      const method = String((args && args.method) || 'GET').toUpperCase();
      let headers: any = { 'User-Agent': 'OmniBot' };
      if (args && args.headers) { try { headers = Object.assign(headers, JSON.parse(String(args.headers))); } catch (e) { } }
      const init: any = { method: method, headers: headers };
      if (method !== 'GET' && method !== 'HEAD' && args && args.body !== undefined) { init.body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body); }
      const res = await fetch(url, init);
      const text = await res.text();
      return 'HTTP ' + res.status + ' ' + res.statusText + String.fromCharCode(10) + text.slice(0, 25000);
    });
    this.registerTool({
      name: 'analyze_image',
      description: 'Analizuje obrazek (plik lokalny lub URL) modelem wizyjnym: opisuje, odpowiada na pytanie o zawartosc.',
      parameters: { path: 'string', question: 'string' },
      requiresApproval: false, timeoutMs: 45000, maxOutputBytes: 4000,
    }, async (args: any) => {
      const key = String(process.env.GEMINI_API_KEY || '').trim();
      if (!key) { throw new Error('Brak GEMINI_API_KEY (dodaj w panelu, grupa Modele i mowa).'); }
      const p = String((args && args.path) || '').trim();
      if (!p) { throw new Error('Podaj path (sciezka lub URL obrazka).'); }
      let base64 = ''; let mime = 'image/png';
      if (p.indexOf('http') === 0) {
        const rr = await fetch(p); const buf = Buffer.from(await rr.arrayBuffer()); base64 = buf.toString('base64'); mime = String(rr.headers.get('content-type') || 'image/png').split(';')[0];
      } else {
        const buf = fs.readFileSync(p); base64 = buf.toString('base64'); mime = /\.jpe?g$/i.test(p) ? 'image/jpeg' : 'image/png';
      }
      const q = String((args && args.question) || 'Opisz dokladnie, co widzisz na obrazku.').slice(0, 300);
      const r2 = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: q }, { inline_data: { mime_type: mime, data: base64 } }] }] }),
      });
      const j: any = await r2.json().catch(() => null);
      if (!r2.ok) { throw new Error('Gemini ' + r2.status + ': ' + JSON.stringify(j).slice(0, 200)); }
      const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      return String((parts[0] && parts[0].text) || '(brak odpowiedzi)').slice(0, 3500);
    });

    // Integracje: GitHub, Telegram, e-mail, WhatsApp
    const integrations = new IntegrationTools();
    for (const def of integrations.getDefinitions()) {
      const toolName = def.name;
      this.registerTool(def, (args, cwd) => {
        if (toolName === 'github_api') { return integrations.github(args); }
        if (toolName === 'telegram_send') { return integrations.telegram(args); }
        if (toolName === 'email_send') { return integrations.email(args); }
        if (toolName === 'git_push') { return integrations.push(args, cwd); }
        if (toolName === 'github_create_repo') { return integrations.createRepo(args, cwd); }
        if (toolName === 'jira_search') { return integrations.jiraSearch(args); }
        if (toolName === 'jira_get_issue') { return integrations.jiraGet(args); }
        if (toolName === 'jira_create_issue') { return integrations.jiraCreate(args); }
        if (toolName === 'jira_update_issue') { return integrations.jiraUpdate(args); }
        if (toolName === 'jira_comment') { return integrations.jiraComment(args); }
        if (toolName === 'jira_boards') { return integrations.jiraBoards(args); }
        if (toolName === 'jira_sprints') { return integrations.jiraSprints(args); }
        if (toolName === 'jira_report') { return integrations.jiraReport(args); }
        return integrations.whatsapp(args);
      });
    }
  }

  private registerTool(definition: ToolDefinition, executor: (args: any, cwd: string) => Promise<any>) {
    this.tools.set(definition.name, { definition, execute: executor });
  }

  /** Public registration used by SwarmManager and external plugins. */
  public register(tool: any) {
    const definition: ToolDefinition = tool?.definition ?? tool;
    const execute = tool?.execute ?? (async () => {
      throw new Error("Tool " + String(definition?.name) + " has no executor registered.");
    });
    this.registerTool(definition, execute);
  }

  public getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  public async executeTool(toolName: string, args: any, cwd: string): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Nieznane narzędzie: ${toolName}`);
    }

    // 1. Sprawdź, czy narzędzie wymaga zatwierdzenia
    if (tool.definition.requiresApproval) {
      console.log(`[ToolRegistry] Oczekiwanie na zatwierdzenie dla: ${toolName}`);
      const approved = await this.approvalManager.requestApproval(
        toolName, 
        args, 
        tool.definition.timeoutMs
      );
      
      if (!approved) {
        throw new Error(`Użytkownik odrzucił wykonanie narzędzia: ${toolName}`);
      }
    }

    // 2. Wykonaj narzędzie z timeoutem
    const timeoutMs = tool.definition.timeoutMs;
    const executePromise = tool.execute(args, cwd);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Przekroczono limit czasu narzędzia (${timeoutMs}ms)`)), timeoutMs);
    });

    try {
      const result = await Promise.race([executePromise, timeoutPromise]);
      
      // 3. Walidacja rozmiaru wyjścia
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      if (tool.definition.maxOutputBytes > 0 && resultStr.length > tool.definition.maxOutputBytes) {
        return resultStr.substring(0, tool.definition.maxOutputBytes) + '\n...[UCIĘTO WYJŚCZE Z POWODU LIMITU ROZMIARU]...';
      }
      
      return result;
    } catch (error: any) {
      throw new Error(`Błąd wykonania narzędzia ${toolName}: ${error.message}`);
    }
  }
}
