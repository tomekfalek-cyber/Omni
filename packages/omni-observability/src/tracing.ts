import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { trace, Span, SpanStatusCode, context } from '@opentelemetry/api';

export class Tracing {
  private sdk: NodeSDK | null = null;
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.OMNI_TRACING_ENABLED === 'true';
  }

  /**
   * Inicjalizuje OpenTelemetry SDK.
   */
  public initialize(): void {
    if (!this.enabled) {
      console.log('[Tracing] Tracing jest wyłączone');
      return;
    }

    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    });

    this.sdk = new NodeSDK({
      traceExporter: exporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-ws': { enabled: true },
        })
      ]
    });

    this.sdk.start();
    console.log('[Tracing] OpenTelemetry SDK zainicjalizowane');
  }

  /**
   * Tworzy nowy span.
   */
  public createSpan(name: string, attributes?: Record<string, any>): Span {
    const tracer = trace.getTracer('omni-agent');
    const span = tracer.startSpan(name);

    if (attributes) {
      span.setAttributes(attributes);
    }

    return span;
  }

  /**
   * Wykonuje funkcję w kontekście spanu.
   */
  public async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes?: Record<string, any>
  ): Promise<T> {
    const span = this.createSpan(name, attributes);

    try {
      const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Zamyka SDK (graceful shutdown).
   */
  public async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown();
      console.log('[Tracing] OpenTelemetry SDK zamknięte');
    }
  }
}

// Singleton instance
let tracingInstance: Tracing | null = null;

export function getTracing(): Tracing {
  if (!tracingInstance) {
    tracingInstance = new Tracing();
  }
  return tracingInstance;
}
