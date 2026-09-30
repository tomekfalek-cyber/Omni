import * as fs from 'fs/promises';
import * as path from 'path';

export interface AuditEntry {
  timestamp: number;
  userId: string;
  sessionId?: string;
  action: string;
  resource: string;
  details?: Record<string, any>;
  success: boolean;
  error?: string;
  ip?: string;
  userAgent?: string;
}

export class AuditLogger {
  private logDir: string;
  private buffer: AuditEntry[] = [];
  private flushInterval: NodeJS.Timeout;
  private readonly FLUSH_INTERVAL_MS = 5000; // 5 sekund
  private readonly MAX_BUFFER_SIZE = 100;

  constructor(logDir: string = '.omni/audit') {
    this.logDir = logDir;
    
    // Okresowe opróżnianie bufora
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => console.error('[AuditLogger] Błąd flush:', err));
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Inicjalizuje katalog audit.
   */
  public async initialize(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    console.log('[AuditLogger] Audit logger zainicjalizowany');
  }

  /**
   * Loguje zdarzenie audit.
   */
  public async log(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: Date.now()
    };

    this.buffer.push(fullEntry);

    // Opróżnij bufor jeśli osiągnął limit
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      await this.flush();
    }
  }

  /**
   * Opróżnia bufor do pliku.
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `audit-${date}.jsonl`);

    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    
    await fs.appendFile(logFile, lines, 'utf-8');
    console.log(`[AuditLogger] Zapisano ${entries.length} wpisów do ${logFile}`);
  }

  /**
   * Wyszukuje wpisy audit.
   */
  public async search(criteria: {
    userId?: string;
    action?: string;
    resource?: string;
    from?: number;
    to?: number;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `audit-${date}.jsonl`);

    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      const entries: AuditEntry[] = lines.map(line => JSON.parse(line));

      let filtered = entries;

      if (criteria.userId) {
        filtered = filtered.filter(e => e.userId === criteria.userId);
      }
      if (criteria.action) {
        filtered = filtered.filter(e => e.action === criteria.action);
      }
      if (criteria.resource) {
        filtered = filtered.filter(e => e.resource === criteria.resource);
      }
      if (criteria.from) {
        filtered = filtered.filter(e => e.timestamp >= criteria.from!);
      }
      if (criteria.to) {
        filtered = filtered.filter(e => e.timestamp <= criteria.to!);
      }

      // Sortuj malejąco według timestamp
      filtered.sort((a, b) => b.timestamp - a.timestamp);

      if (criteria.limit) {
        filtered = filtered.slice(0, criteria.limit);
      }

      return filtered;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Generuje raport audit.
   */
  public async generateReport(from: number, to: number): Promise<{
    totalActions: number;
    uniqueUsers: number;
    actionsByType: Record<string, number>;
    failedActions: number;
  }> {
    const entries = await this.search({ from, to });

    const actionsByType: Record<string, number> = {};
    const uniqueUsers = new Set<string>();
    let failedActions = 0;

    for (const entry of entries) {
      actionsByType[entry.action] = (actionsByType[entry.action] || 0) + 1;
      uniqueUsers.add(entry.userId);
      if (!entry.success) {
        failedActions++;
      }
    }

    return {
      totalActions: entries.length,
      uniqueUsers: uniqueUsers.size,
      actionsByType,
      failedActions
    };
  }

  /**
   * Zamyka audit logger (flush i cleanup).
   */
  public async shutdown(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flush();
    console.log('[AuditLogger] Audit logger zamknięty');
  }
}

// Singleton instance
let auditLoggerInstance: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger();
  }
  return auditLoggerInstance;
}
