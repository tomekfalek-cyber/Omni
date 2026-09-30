import { ToolDefinition, ToolCall } from 'omni-core/types.js';
import { ApprovalManager } from 'omni-core/approval-manager.js';
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
      this.registerTool(def, (args) => {
        if (toolName === 'github_api') { return integrations.github(args); }
        if (toolName === 'telegram_send') { return integrations.telegram(args); }
        if (toolName === 'email_send') { return integrations.email(args); }
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
