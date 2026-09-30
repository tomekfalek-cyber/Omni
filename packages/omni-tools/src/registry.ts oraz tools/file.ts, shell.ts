import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolCall } from 'omni-core/types.js';

const execAsync = promisify(exec);

export class ToolRegistry {
  private tools: Map<string, ToolDefinition & { execute: (args: any, cwd: string) => Promise<any> }> = new Map();

  constructor() {
    this.registerFileTools();
    this.registerShellTools();
  }

  public register(tool: any) {
    this.tools.set(tool.name, tool);
  }

  public get(name: string) {
    return this.tools.get(name);
  }

  public getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(({ execute, ...def }) => def);
  }

  private registerFileTools() {
    this.tools.set('file_read', {
      name: 'file_read',
      description: 'Odczytuje zawartość pliku tekstowego.',
      parameters: { path: 'string' },
      requiresApproval: false,
      timeoutMs: 5000,
      maxOutputBytes: 50000,
      execute: async (args: { path: string }, cwd: string) => {
        const safePath = this.sanitizePath(args.path, cwd);
        const content = await fs.readFile(safePath, 'utf-8');
        return content.substring(0, this.tools.get('file_read')!.maxOutputBytes);
      }
    });

    this.tools.set('file_write', {
      name: 'file_write',
      description: 'Zapisuje lub nadpisuje plik tekstowy.',
      parameters: { path: 'string', content: 'string' },
      requiresApproval: true,
      timeoutMs: 5000,
      maxOutputBytes: 0,
      execute: async (args: { path: string, content: string }, cwd: string) => {
        const safePath = this.sanitizePath(args.path, cwd);
        await fs.writeFile(safePath, args.content, 'utf-8');
        return `Plik zapisany: ${safePath}`;
      }
    });
  }

  private registerShellTools() {
    this.tools.set('shell_exec', {
      name: 'shell_exec',
      description: 'Wykonuje polecenie w terminalu (tylko bezpieczne komendy).',
      parameters: { command: 'string' },
      requiresApproval: true,
      timeoutMs: 15000,
      maxOutputBytes: 20000,
      execute: async (args: { command: string }, cwd: string) => {
        if (this.isDangerousCommand(args.command)) {
          throw new Error('Zablokowano niebezpieczne polecenie (blacklist).');
        }
        const { stdout, stderr } = await execAsync(args.command, { 
          cwd, 
          timeout: 15000,
          maxBuffer: 20000
        });
        return stderr ? `Błąd: ${stderr}\nWyjście: ${stdout}` : stdout;
      }
    });
  }

  private sanitizePath(userPath: string, cwd: string): string {
    const resolved = path.resolve(cwd, userPath);
    if (!resolved.startsWith(cwd)) {
      throw new Error(`Naruszenie bezpieczeństwa: próba dostępu poza katalog roboczy (${userPath})`);
    }
    return resolved;
  }

  private isDangerousCommand(cmd: string): boolean {
    const blacklist = ['rm -rf /', 'mkfs', 'dd if=', '> /dev/sda', 'chmod 777 /', 'sudo'];
    return blacklist.some(dangerous => cmd.toLowerCase().includes(dangerous));
  }
}
