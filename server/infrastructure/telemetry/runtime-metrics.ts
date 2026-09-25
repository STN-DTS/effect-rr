import { availableParallelism } from 'node:os';
import type { PerformanceEntry } from 'node:perf_hooks';
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

import { Config, Effect, Layer, Metric, Schedule } from 'effect';

// Names and units follow the OpenTelemetry semantic conventions for Node.js,
// V8 and process runtime metrics. `unit` becomes the Prometheus name suffix.

const SECONDS = { unit: 's' } as const;
const BYTES = { unit: 'By' } as const;

const eventLoopDelay = (stat: string) =>
  Metric.gauge(`nodejs.eventloop.delay.${stat}`, { description: `Event loop delay (${stat})`, attributes: SECONDS });
const delayMin = eventLoopDelay('min');
const delayMean = eventLoopDelay('mean');
const delayMax = eventLoopDelay('max');
const delayP50 = eventLoopDelay('p50');
const delayP90 = eventLoopDelay('p90');
const delayP99 = eventLoopDelay('p99');

const eventLoopUtilization = Metric.gauge('nodejs.eventloop.utilization', {
  description: 'Fraction of time the event loop was busy since the previous sample (0..1)',
});

const heapUsed = Metric.gauge('v8js.memory.heap.used', {
  description: 'V8 heap memory used, per heap space',
  attributes: BYTES,
});
const heapSpaceSize = Metric.gauge('v8js.memory.heap.space.available_size', {
  description: 'V8 heap space available, per heap space',
  attributes: BYTES,
});
const heapLimit = Metric.gauge('v8js.memory.heap.limit', {
  description: 'V8 heap size limit',
  attributes: BYTES,
});

const memoryUsage = Metric.gauge('process.memory.usage', {
  description: 'Process memory by kind: rss, heap_total, heap_used, external, array_buffers',
  attributes: BYTES,
});

const cpuTime = Metric.counter('process.cpu.time', {
  description: 'CPU time consumed by the process, by mode (user, system)',
  incremental: true,
  attributes: SECONDS,
});
const cpuUtilization = Metric.gauge('process.cpu.utilization', {
  description: 'CPU used since the previous sample, divided by the number of cores (0..1)',
});

const uptime = Metric.gauge('process.uptime', { description: 'Process uptime', attributes: SECONDS });

const activeResources = Metric.gauge('nodejs.active_resources', {
  description: 'Resources keeping the event loop alive, by type (Timeout, TCPWRAP, FSReqCallback, ...)',
  attributes: { unit: '{resource}' },
});

const gcDuration = Metric.histogram('v8js.gc.duration', {
  description: 'Garbage collection pause duration, by kind (major, minor, incremental, weakcb)',
  boundaries: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  attributes: SECONDS,
});

const GC_KINDS: Record<number, string> = { 1: 'minor', 2: 'major', 4: 'incremental', 8: 'weakcb', 16: 'minor' };

/** `detail.kind` is documented for "gc" entries, but the typings don't carry it. */
const gcKind = (entry: PerformanceEntry): number =>
  'detail' in entry
  && typeof entry.detail === 'object'
  && entry.detail !== null
  && 'kind' in entry.detail
  && typeof entry.detail.kind === 'number'
    ? entry.detail.kind
    : 0;

const nanosToSeconds = (nanos: number) => nanos / 1e9;
const microsToSeconds = (micros: number) => micros / 1e6;
const tagged = <I, S>(metric: Metric.Metric<I, S>, attributes: Record<string, string>) =>
  Metric.withAttributes(metric, attributes);

/**
 * Samples Node.js runtime health on a fixed interval: event loop delay and
 * utilization, V8 heap per space, process memory and CPU, active handles and
 * GC pauses. `RUNTIME_METRICS_INTERVAL` (default 5 seconds) sets the period.
 *
 * GC entries arrive on a `PerformanceObserver` callback, outside any fiber;
 * they are buffered and recorded on the next sample.
 */
export const NodeRuntimeMetricsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const interval = yield* Config.Duration('RUNTIME_METRICS_INTERVAL').pipe(Config.withDefault('5 seconds'));
    const cores = availableParallelism();

    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();

    let pendingGc: Array<PerformanceEntry> = [];
    const gcObserver = new PerformanceObserver((list) => {
      pendingGc.push(...list.getEntries());
    });
    gcObserver.observe({ entryTypes: ['gc'] });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        delay.disable();
        gcObserver.disconnect();
      }),
    );

    let previousElu = performance.eventLoopUtilization();
    let previousCpu = process.cpuUsage();
    let previousSampleAt = performance.now();

    const sample = Effect.gen(function* () {
      // Event loop delay since the previous sample (the histogram is reset after reading).
      if (delay.count > 0) {
        yield* Metric.update(delayMin, nanosToSeconds(delay.min));
        yield* Metric.update(delayMean, nanosToSeconds(delay.mean));
        yield* Metric.update(delayMax, nanosToSeconds(delay.max));
        yield* Metric.update(delayP50, nanosToSeconds(delay.percentile(50)));
        yield* Metric.update(delayP90, nanosToSeconds(delay.percentile(90)));
        yield* Metric.update(delayP99, nanosToSeconds(delay.percentile(99)));
      }
      delay.reset();

      const elu = performance.eventLoopUtilization();
      yield* Metric.update(eventLoopUtilization, performance.eventLoopUtilization(elu, previousElu).utilization);
      previousElu = elu;

      // CPU: counters take the delta, utilization is relative to wall time and cores.
      const now = performance.now();
      const cpu = process.cpuUsage();
      const userDelta = microsToSeconds(cpu.user - previousCpu.user);
      const systemDelta = microsToSeconds(cpu.system - previousCpu.system);
      const wallSeconds = (now - previousSampleAt) / 1000;
      yield* Metric.update(tagged(cpuTime, { 'cpu.mode': 'user' }), userDelta);
      yield* Metric.update(tagged(cpuTime, { 'cpu.mode': 'system' }), systemDelta);
      if (wallSeconds > 0) {
        yield* Metric.update(cpuUtilization, (userDelta + systemDelta) / wallSeconds / cores);
      }
      previousCpu = cpu;
      previousSampleAt = now;

      const memory = process.memoryUsage();
      yield* Metric.update(tagged(memoryUsage, { 'process.memory.type': 'rss' }), memory.rss);
      yield* Metric.update(tagged(memoryUsage, { 'process.memory.type': 'heap_total' }), memory.heapTotal);
      yield* Metric.update(tagged(memoryUsage, { 'process.memory.type': 'heap_used' }), memory.heapUsed);
      yield* Metric.update(tagged(memoryUsage, { 'process.memory.type': 'external' }), memory.external);
      yield* Metric.update(tagged(memoryUsage, { 'process.memory.type': 'array_buffers' }), memory.arrayBuffers);

      for (const space of getHeapSpaceStatistics()) {
        const attributes = { 'v8js.heap.space.name': space.space_name };
        yield* Metric.update(tagged(heapUsed, attributes), space.space_used_size);
        yield* Metric.update(tagged(heapSpaceSize, attributes), space.space_available_size);
      }
      yield* Metric.update(heapLimit, getHeapStatistics().heap_size_limit);

      const resources = new Map<string, number>();
      for (const type of process.getActiveResourcesInfo()) {
        resources.set(type, (resources.get(type) ?? 0) + 1);
      }
      for (const [type, count] of resources) {
        yield* Metric.update(tagged(activeResources, { 'nodejs.resource.type': type }), count);
      }

      yield* Metric.update(uptime, process.uptime());

      const gcEntries = pendingGc;
      pendingGc = [];
      for (const entry of gcEntries) {
        yield* Metric.update(
          tagged(gcDuration, { 'v8js.gc.type': GC_KINDS[gcKind(entry)] ?? 'unknown' }),
          entry.duration / 1000,
        );
      }
    });

    yield* sample.pipe(Effect.repeat(Schedule.spaced(interval)), Effect.forkScoped);
    yield* Effect.logDebug('Node.js runtime metrics enabled').pipe(Effect.annotateLogs({ interval: String(interval) }));
  }),
);
