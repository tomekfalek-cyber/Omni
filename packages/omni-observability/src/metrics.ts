import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export class Metrics {
  private registry: Registry;
  
  // Counters
  public readonly tasksTotal: Counter;
  public readonly toolCallsTotal: Counter;
  public readonly llmRequestsTotal: Counter;
  public readonly errorsTotal: Counter;
  public readonly approvalsTotal: Counter;

  // Histograms
  public readonly taskDuration: Histogram;
  public readonly toolCallDuration: Histogram;
  public readonly llmRequestDuration: Histogram;

  // Gauges
  public readonly activeSessions: Gauge;
  public readonly pendingApprovals: Gauge;
  public readonly memoryUsageMB: Gauge;

  constructor() {
    this.registry = new Registry();
    
    // Zbieraj domyślne metryki Node.js
    collectDefaultMetrics({ register: this.registry });

    // Counters
    this.tasksTotal = new Counter({
      name: 'omni_tasks_total',
      help: 'Total number of tasks processed',
      labelNames: ['status', 'agent_role'],
      registers: [this.registry]
    });

    this.toolCallsTotal = new Counter({
      name: 'omni_tool_calls_total',
      help: 'Total number of tool calls',
      labelNames: ['tool_name', 'status'],
      registers: [this.registry]
    });

    this.llmRequestsTotal = new Counter({
      name: 'omni_llm_requests_total',
      help: 'Total number of LLM requests',
      labelNames: ['provider', 'model', 'status'],
      registers: [this.registry]
    });

    this.errorsTotal = new Counter({
      name: 'omni_errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'component'],
      registers: [this.registry]
    });

    this.approvalsTotal = new Counter({
      name: 'omni_approvals_total',
      help: 'Total number of approval requests',
      labelNames: ['status'],
      registers: [this.registry]
    });

    // Histograms
    this.taskDuration = new Histogram({
      name: 'omni_task_duration_seconds',
      help: 'Task duration in seconds',
      labelNames: ['agent_role', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [this.registry]
    });

    this.toolCallDuration = new Histogram({
      name: 'omni_tool_call_duration_seconds',
      help: 'Tool call duration in seconds',
      labelNames: ['tool_name'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry]
    });

    this.llmRequestDuration = new Histogram({
      name: 'omni_llm_request_duration_seconds',
      help: 'LLM request duration in seconds',
      labelNames: ['provider', 'model'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30],
      registers: [this.registry]
    });

    // Gauges
    this.activeSessions = new Gauge({
      name: 'omni_active_sessions',
      help: 'Number of active sessions',
      registers: [this.registry]
    });

    this.pendingApprovals = new Gauge({
      name: 'omni_pending_approvals',
      help: 'Number of pending approval requests',
      registers: [this.registry]
    });

    this.memoryUsageMB = new Gauge({
      name: 'omni_memory_usage_mb',
      help: 'Memory usage in MB',
      registers: [this.registry]
    });
  }

  /**
   * Zwraca wszystkie metryki w formacie Prometheus.
   */
  public async getMetrics(): Promise<string> {
    // Aktualizuj memory usage
    const memUsage = process.memoryUsage();
    this.memoryUsageMB.set(memUsage.heapUsed / 1024 / 1024);

    return await this.registry.metrics();
  }

  /**
   * Zwraca content-type dla metryk.
   */
  public getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * Resetuje wszystkie metryki (do testów).
   */
  public reset(): void {
    this.registry.resetMetrics();
  }
}

// Singleton instance
let metricsInstance: Metrics | null = null;

export function getMetrics(): Metrics {
  if (!metricsInstance) {
    metricsInstance = new Metrics();
  }
  return metricsInstance;
}
