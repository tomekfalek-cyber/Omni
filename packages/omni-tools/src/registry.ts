import { ToolDefinition, ToolCall } from 'omni-core/types.js';
import { ApprovalManager } from 'omni-core/approval-manager.js';
import * as fs from 'fs';
import * as path from 'path';
import { FileTools } from './tools/file-tools.js';
import { GitTools } from './tools/git-tools.js';
import { ShellSandbox } from './tools/shell-sandbox.js';
import { WebTools } from './tools/web-tools.js';
import { IntegrationTools } from './tools/integration-tools.js';

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
