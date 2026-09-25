import { Layer, Metric } from 'effect';
import * as OtlpExport from '~server/infrastructure/telemetry/otlp.ts';
import * as NodeRuntimeMetrics from '~server/infrastructure/telemetry/runtime-metrics.ts';

export { defaultSignalUrl, TelemetryConfig } from '~server/infrastructure/telemetry/otlp.ts';
export * as OtlpExport from '~server/infrastructure/telemetry/otlp.ts';
export * as NodeRuntimeMetrics from '~server/infrastructure/telemetry/runtime-metrics.ts';

/**
 * Everything observability needs at the process level:
 *
 * - OTLP export of traces, metrics and logs (`OTEL_*` configuration);
 * - Node.js runtime metrics (event loop, heap, CPU, GC, handles);
 * - Effect fiber metrics (`child_fibers_active`, `child_fibers_started`,
 *   `child_fiber_successes`, `child_fiber_failures`).
 *
 * Metrics are recorded even when export is disabled; they are simply not sent.
 */
export const layer = Layer.mergeAll(OtlpExport.layer, NodeRuntimeMetrics.layer, Metric.enableRuntimeMetricsLayer);
