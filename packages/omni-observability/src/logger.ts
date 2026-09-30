import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

export interface LogContext {
  sessionId?: string;
  taskId?: string;
  agentRole?: string;
  toolName?: string;
  userId?: string;
  [key: string]: any;
}

export class Logger {
  private logger: pino.Logger;
  private logDir: string;

  constructor(logDir: string = '.omni/logs') {
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });

    this.logger = pino({
      level: process.env.OMNI_LOG_LEVEL || 'info',
      transport: {
        targets: [
          // Konsola (pretty print w development)
          {
            target: 'pino-pretty',
            level: process.env.OMNI_LOG_LEVEL || 'info',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname'
            }
          },
          // Plik JSON (structured logs)
          {
            target: 'pino/file',
            level: process.env.OMNI_LOG_LEVEL || 'info',
            options: {
              destination: path.join(logDir, `omni-${this.getDateString()}.log`),
              mkdir: true
            }
          }
        ]
      },
      base: {
        service: 'omni-agent',
        version: '1.0.0'
      },
      timestamp: pino.stdTimeFunctions.isoTime
    });
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Loguje informację debug.
   */
  public debug(message: string, context?: LogContext): void {
    this.logger.debug({ ...context }, message);
  }

  /**
   * Loguje informację info.
   */
  public info(message: string, context?: LogContext): void {
    this.logger.info({ ...context }, message);
  }

  /**
   * Loguje ostrzeżenie.
   */
  public warn(message: string, context?: LogContext): void {
    this.logger.warn({ ...context }, message);
  }

  /**
   * Loguje błąd.
   */
  public error(message: string, error?: Error, context?: LogContext): void {
    this.logger.error({ 
      ...context,
      err: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined
    }, message);
  }

  /**
   * Loguje zdarzenie agenta.
   */
  public agentEvent(event: string, context: LogContext): void {
    this.info(`Agent event: ${event}`, context);
  }

  /**
   * Loguje wywołanie narzędzia.
   */
  public toolCall(toolName: string, args: any, context?: LogContext): void {
    this.info(`Tool call: ${toolName}`, {
      ...context,
      toolName,
      toolArgs: args
    });
  }

  /**
   * Loguje wynik narzędzia.
   */
  public toolResult(toolName: string, result: any, duration: number, context?: LogContext): void {
    this.info(`Tool result: ${toolName}`, {
      ...context,
      toolName,
      toolResult: typeof result === 'string' ? result.substring(0, 500) : result,
      duration
    });
  }

  /**
   * Loguje błąd narzędzia.
   */
  public toolError(toolName: string, error: Error, context?: LogContext): void {
    this.error(`Tool error: ${toolName}`, error, {
      ...context,
      toolName
    });
  }

  /**
   * Loguje zdarzenie LLM.
   */
  public llmEvent(event: string, model: string, context?: LogContext): void {
    this.info(`LLM event: ${event}`, {
      ...context,
      model
    });
  }

  /**
   * Loguje metryki sesji.
   */
  public sessionMetrics(sessionId: string, metrics: {
    messageCount: number;
    toolCallCount: number;
    duration: number;
  }): void {
    this.info('Session metrics', {
      sessionId,
      ...metrics
    });
  }

  /**
   * Tworzy child logger z kontekstem.
   */
  public child(context: LogContext): Logger {
    const childLogger = Object.create(this) as Logger;
    childLogger.logger = this.logger.child(context);
    return childLogger;
  }

  /**
   * Zwraca ścieżkę do pliku logów.
   */
  public getLogPath(): string {
    return path.join(this.logDir, `omni-${this.getDateString()}.log`);
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}
