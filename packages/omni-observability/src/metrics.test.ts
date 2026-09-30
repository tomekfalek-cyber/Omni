import { describe, it, expect, beforeEach } from 'vitest';
import { Metrics } from './metrics.js';

describe('Metrics', () => {
  let metrics: Metrics;

  beforeEach(() => {
    metrics = new Metrics();
    metrics.reset();
  });

  it('should increment task counter', async () => {
    metrics.tasksTotal.inc({ status: 'completed', agent_role: 'executor' });
    
    const metricsOutput = await metrics.getMetrics();
    expect(metricsOutput).toContain('omni_tasks_total');
    expect(metricsOutput).toContain('status="completed"');
  });

  it('should record task duration', async () => {
    metrics.taskDuration.observe({ agent_role: 'planner', status: 'completed' }, 2.5);
    
    const metricsOutput = await metrics.getMetrics();
    expect(metricsOutput).toContain('omni_task_duration_seconds');
  });

  it('should set active sessions gauge', async () => {
    metrics.activeSessions.set(5);
    
    const metricsOutput = await metrics.getMetrics();
    expect(metricsOutput).toContain('omni_active_sessions 5');
  });

  it('should return Prometheus content type', () => {
    const contentType = metrics.getContentType();
    expect(contentType).toContain('text/plain');
  });
});
