import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { MCPRequest, MCPResponse } from '../types.js';

export class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null;
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private pendingRequests: Map<number | string, {
    resolve: (response: MCPResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private requestId = 0;
  private buffer = '';

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}) {
    super();
    this.command = command;
    this.args = args;
    this.env = { ...process.env, ...env };
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[StdioTransport] Uruchamiam: ${this.command} ${this.args.join(' ')}`);
      
      this.process = spawn(this.command, this.args, {
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout?.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data) => {
        console.error(`[StdioTransport:${this.command}] stderr:`, data.toString());
      });

      this.process.on('error', (err) => {
        reject(new Error(`Błąd uruchomienia procesu: ${err.message}`));
      });

      this.process.on('exit', (code) => {
        console.log(`[StdioTransport] Proces zakończony z kodem: ${code}`);
        this.cleanup();
      });

      // Daj procesowi chwilę na uruchomienie
      setTimeout(() => resolve(), 500);
    });
  }

  public async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
      this.process = null;
    }
    this.cleanup();
  }

  public async send(request: MCPRequest): Promise<MCPResponse> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Proces nie jest uruchomiony');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Timeout żądania ${request.method}`));
      }, 30000);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + '\n';
      this.process.stdin!.write(message, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(request.id);
          reject(err);
        }
      });
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line) as MCPResponse;
          const pending = this.pendingRequests.get(response.id);
          
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
          } else {
            this.emit('notification', response);
          }
        } catch (err) {
          console.error(`[StdioTransport] Błąd parsowania JSON:`, line);
        }
      }
    }
  }

  private cleanup(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Transport zamknięty'));
    }
    this.pendingRequests.clear();
  }

  public getNextRequestId(): number {
    return ++this.requestId;
  }
}
