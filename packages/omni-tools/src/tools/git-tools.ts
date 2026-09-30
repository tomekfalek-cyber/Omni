import simpleGit, { SimpleGit } from 'simple-git';
import { ToolDefinition } from 'omni-core/types.js';
import { z } from 'zod';
import * as path from 'path';

export class GitTools {
  private getGit(cwd: string): SimpleGit {
    return simpleGit(cwd);
  }

  public getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'git_status',
        description: 'Sprawdza status repozytorium Git (zmienione, nowe, usunięte pliki).',
        parameters: {},
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 20000
      },
      {
        name: 'git_diff',
        description: 'Pokazuje różnice w niezatwierdzonych zmianach.',
        parameters: { path: 'string (opcjonalny)' },
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 50000
      },
      {
        name: 'git_add_commit',
        description: 'Dodaje pliki do stage i tworzy commit. WYMAGA zatwierdzenia.',
        parameters: { message: 'string', files: 'string[] (opcjonalne, domyślnie ".")' },
        requiresApproval: true,
        timeoutMs: 15000,
        maxOutputBytes: 5000
      }
    ];
  }

  public async getStatus(cwd: string): Promise<string> {
    const git = this.getGit(cwd);
    const status = await git.status();
    if (status.isClean()) return 'Repozytorium jest czyste (brak zmian).';
    
    return `Zmienione: ${status.modified.join(', ')}\nNowe: ${status.not_added.join(', ')}\nUsunięte: ${status.deleted.join(', ')}`;
  }

  public async getDiff(args: { path?: string }, cwd: string): Promise<string> {
    const git = this.getGit(cwd);
    const diff = await git.diff(args.path ? [args.path] : []);
    return diff || 'Brak różnic do pokazania.';
  }

  public async addAndCommit(args: { message: string, files?: string[] }, cwd: string): Promise<string> {
    const schema = z.object({ 
      message: z.string().min(5, 'Komunikat commita musi mieć min. 5 znaków'),
      files: z.array(z.string()).optional()
    });
    const validated = schema.parse(args);
    
    const git = this.getGit(cwd);
    const filesToAdd = validated.files && validated.files.length > 0 ? validated.files : ['.', '-A'];
    
    await git.add(filesToAdd);
    const result = await git.commit(validated.message);
    
    return `Commit utworzony: ${result.commit}\nZmienione pliki: ${result.summary.changes}`;
  }
}
