import { Layer, Metric } from 'effect';

import { OtlpExportLayer } from './otlp.ts';
import { NodeRuntimeMetricsLayer } from './runtime-metrics.ts';

export { defaultSignalUrl, OtlpExportLayer, TelemetryConfig } from './otlp.ts';
export { NodeRuntimeMetricsLayer } from './runtime-metrics.ts';

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
export const TelemetryLayer = Layer.mergeAll(OtlpExportLayer, NodeRuntimeMetricsLayer, Metric.enableRuntimeMetricsLayer);
