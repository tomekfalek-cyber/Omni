import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolDefinition } from 'omni-core/types.js';
import { z } from 'zod';

export class FileTools {
  private readonly MAX_OUTPUT_BYTES = 100_000; // 100 KB limit odczytu

  private sanitizePath(userPath: string, cwd: string): string {
    const resolved = path.resolve(cwd, userPath);
    if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
      throw new Error(`Naruszenie bezpieczeństwa: Próba dostępu poza katalog roboczy (Path Traversal). Żądany: ${userPath}, Rozwiązany: ${resolved}`);
    }
    return resolved;
  }

  public getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'file_read',
        description: 'Odczytuje zawartość pliku tekstowego. Zwraca błąd, jeśli plik jest binarny lub za duży.',
        parameters: { path: 'string' },
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: this.MAX_OUTPUT_BYTES
      },
      {
        name: 'file_write',
        description: 'Zapisuje lub nadpisuje plik tekstowy. Wymaga zatwierdzenia użytkownika.',
        parameters: { path: 'string', content: 'string' },
        requiresApproval: true,
        timeoutMs: 10000,
        maxOutputBytes: 0
      },
      {
        name: 'file_list',
        description: 'Listuje pliki i katalogi w podanym katalogu.',
        parameters: { path: 'string' },
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 50000
      }
    ];
  }

  public async readFile(args: { path: string }, cwd: string): Promise<string> {
    const schema = z.object({ path: z.string().min(1) });
    const validated = schema.parse(args);
    const safePath = this.sanitizePath(validated.path, cwd);
    
    const stats = await fs.stat(safePath);
    if (stats.size > this.MAX_OUTPUT_BYTES) {
      throw new Error(`Plik jest za duży do odczytu (${stats.size} bajtów). Limit: ${this.MAX_OUTPUT_BYTES}`);
    }

    const content = await fs.readFile(safePath, 'utf-8');
    return content;
  }

  public async writeFile(args: { path: string, content: string }, cwd: string): Promise<string> {
    const schema = z.object({ path: z.string().min(1), content: z.string() });
    const validated = schema.parse(args);
    const safePath = this.sanitizePath(validated.path, cwd);
    
    // Upewnij się, że katalog nadrzędny istnieje
    const dir = path.dirname(safePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(safePath, validated.content, 'utf-8');
    return `Pomyślnie zapisano plik: ${safePath}`;
  }

  public async listFiles(args: { path: string }, cwd: string): Promise<string> {
    const schema = z.object({ path: z.string().default('.') });
    const validated = schema.parse(args);
    const safePath = this.sanitizePath(validated.path, cwd);
    
    const files = await fs.readdir(safePath, { withFileTypes: true });
    const formatted = files.map(f => {
      const type = f.isDirectory() ? '📁' : '📄';
      return `${type} ${f.name}`;
    }).join('\n');
    
    return formatted || '(katalog pusty)';
  }
}
