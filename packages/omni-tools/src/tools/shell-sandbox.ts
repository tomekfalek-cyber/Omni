import Docker from 'dockerode';
import { ToolDefinition } from 'omni-core/types.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs/promises';

export class ShellSandbox {
  private docker: Docker;
  private readonly IMAGE = process.env.OMNI_SANDBOX_IMAGE || 'node:22-alpine';
  private readonly MAX_OUTPUT_BYTES = 50_000;

  constructor() {
    this.docker = new Docker({ socketPath: process.env.DOCKER_HOST || '/var/run/docker.sock' });
  }

  public getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'shell_exec',
        description: 'Wykonuje polecenie powłoki w bezpiecznym, odizolowanym kontenerze Docker. WYMAGA zatwierdzenia.',
        parameters: { command: 'string' },
        requiresApproval: true,
        timeoutMs: 30000,
        maxOutputBytes: this.MAX_OUTPUT_BYTES
      }
    ];
  }

  public async execute(args: { command: string }, cwd: string): Promise<string> {
    const schema = z.object({ command: z.string().min(1).max(2000) });
    const validated = schema.parse(args);

    // 1. Walidacja blacklisty (głęboka obrona, mimo sandboxa)
    this.validateCommand(validated.command);

    // 2. Przygotowanie kontenera
    const containerName = `omni-sandbox-${Date.now()}`;
    const hostCwd = path.resolve(cwd);
    
    // Upewnij się, że katalog istnieje, zanim go zamontujemy
    await fs.mkdir(hostCwd, { recursive: true });

    try {
      const container: any = await this.docker.createContainer({
        Image: this.IMAGE,
        name: containerName,
        Cmd: ['sh', '-c', validated.command],
        HostConfig: ({
          AutoRemove: true, // Automatyczne sprzątanie
          Binds: [`${hostCwd}:/workspace`], // Montuj tylko katalog roboczy (read-write)
          WorkingDir: '/workspace',
          Memory: 512 * 1024 * 1024, // 512 MB limit
          NanoCpus: 500_000_000, // 0.5 CPU limit
          NetworkMode: 'none', // BRAK dostępu do sieci (izolacja!)
          ReadonlyRootfs: false,
          SecurityOpt: ['no-new-privileges:true']
        } as any),
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      });

      await container.start();

      // 3. Pobranie logów z timeoutem
      const timeoutMs = 30000;
      const logPromise = new Promise<string>((resolve, reject) => {
        container.logs({
          follow: true,
          stdout: true,
          stderr: true,
          timestamps: false
        }, (err, stream) => {
          if (err) return reject(err);
          
          let output = '';
          stream?.on('data', (chunk: Buffer) => {
            // Docker dodaje 8-bajtowy nagłówek do każdego strumienia, pomijamy go
            const cleanChunk = chunk.slice(8).toString('utf-8');
            output += cleanChunk;
            
            if (output.length > this.MAX_OUTPUT_BYTES) {
              stream.destroy();
              reject(new Error(`Przekroczono limit wyjścia (${this.MAX_OUTPUT_BYTES} bajtów)`));
            }
          });
          
          stream?.on('end', async () => {
            const info = await container.inspect();
            if (info.State.ExitCode !== 0) {
              reject(new Error(`Proces zakończył się z kodem ${info.State.ExitCode}\nWyjście: ${output}`));
            } else {
              resolve(output);
            }
          });
        });
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Przekroczono limit czasu wykonania (30s)')), timeoutMs);
      });

      return await Promise.race([logPromise, timeoutPromise]);

    } catch (error: any) {
      throw new Error(`Błąd Sandbox Docker: ${error.message}. Upewnij się, że Docker jest uruchomiony.`);
    } finally {
      // 4. Gwarancja sprzątania (gdyby AutoRemove z jakiegoś powodu nie zadziałał)
      try {
        const container: any = this.docker.getContainer(containerName);
        await container.remove({ force: true });
      } catch (e) {
        // Ignoruj, jeśli kontener już nie istnieje
      }
    }
  }

  private validateCommand(cmd: string): void {
    const dangerousPatterns = [
      /rm\s+-rf\s+\//i,
      /mkfs/i,
      />\s*\/dev\/sd/i,
      /chmod\s+777\s+\//i,
      /:\(\)\{\s*:\|:\s*&\s*\}\s*;/i, // Fork bomb
      /wget|curl/i // Blokada pobierania z sieci w trybie 'none'
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(cmd)) {
        throw new Error(`Zablokowano niebezpieczne polecenie: dopasowanie do wzorca ${pattern}`);
      }
    }
  }
}
