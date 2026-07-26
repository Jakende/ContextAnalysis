export const PERFORMANCE_TIMING_SCHEMA_VERSION = "0.1.0" as const;

export type AnalysisTimingMarkId =
  | "analysis-start"
  | "local-data-lookup-start"
  | "local-data-lookup-complete"
  | "first-usable-structured-result"
  | "live-enrichment-complete";

export type AnalysisTimingMark = {
  id: AnalysisTimingMarkId;
  elapsedMs: number;
};

export type AnalysisTimingSummary = {
  schemaVersion: typeof PERFORMANCE_TIMING_SCHEMA_VERSION;
  startedAt: string;
  clock: "monotonic-relative-ms";
  bounded: true;
  marks: AnalysisTimingMark[];
  durations: {
    localDataLookupMs?: number;
    firstUsableStructuredResultMs?: number;
    liveEnrichmentCompleteMs?: number;
  };
};

export type AnalysisTimingStart = {
  startedAt: string;
  monotonicMs: number;
};

export type ExportTimingEvent = {
  id: string;
  kind: string;
  startedAt: string;
  completedAt?: string;
  elapsedMs?: number;
  status: "running" | "ok" | "failed";
  error?: string;
};

export type RuntimePerformanceSnapshot = {
  schemaVersion: typeof PERFORMANCE_TIMING_SCHEMA_VERSION;
  bounded: {
    maxAnalysisMarks: number;
    maxExportEvents: number;
  };
  app: {
    runtimeStartedAt: string;
    appReadyAt?: string;
    appReadyElapsedMs?: number;
  };
  latestAnalysis?: AnalysisTimingSummary;
  exports: ExportTimingEvent[];
};

export type ExportPerformanceSummary = {
  schemaVersion: typeof PERFORMANCE_TIMING_SCHEMA_VERSION;
  analysis: AnalysisTimingSummary;
};

export const ANALYSIS_TIMING_CONTRACT = {
  schemaVersion: PERFORMANCE_TIMING_SCHEMA_VERSION,
  maxAnalysisMarks: 8,
  maxExportEvents: 20,
  requiredMarks: [
    "analysis-start",
    "local-data-lookup-start",
    "local-data-lookup-complete",
    "first-usable-structured-result",
    "live-enrichment-complete",
  ] as AnalysisTimingMarkId[],
  provisionalTargetsMs: {
    firstUsableMedian: 2_000,
    firstUsableP95: 5_000,
  },
} as const;

type MonotonicClock = () => number;
type WallClock = () => string;

function defaultMonotonicClock(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function defaultWallClock(): string {
  return new Date().toISOString();
}

export function createAnalysisTimingStart(
  now: MonotonicClock = defaultMonotonicClock,
  wallNow: WallClock = defaultWallClock,
): AnalysisTimingStart {
  return { startedAt: wallNow(), monotonicMs: now() };
}

export function createAnalysisTimer(
  start = createAnalysisTimingStart(),
  now: MonotonicClock = defaultMonotonicClock,
) {
  const marks = new Map<AnalysisTimingMarkId, AnalysisTimingMark>();
  marks.set("analysis-start", { id: "analysis-start", elapsedMs: 0 });

  function mark(id: AnalysisTimingMarkId): AnalysisTimingMark {
    const existing = marks.get(id);
    if (existing) return existing;
    const timingMark = {
      id,
      elapsedMs: boundedElapsed(now() - start.monotonicMs),
    };
    if (marks.size < ANALYSIS_TIMING_CONTRACT.maxAnalysisMarks) {
      marks.set(id, timingMark);
    }
    return timingMark;
  }

  function has(id: AnalysisTimingMarkId): boolean {
    return marks.has(id);
  }

  function snapshot(): AnalysisTimingSummary {
    const orderedMarks = [...marks.values()];
    const elapsedById = new Map(orderedMarks.map((item) => [item.id, item.elapsedMs]));
    const localStart = elapsedById.get("local-data-lookup-start");
    const localComplete = elapsedById.get("local-data-lookup-complete");
    return {
      schemaVersion: PERFORMANCE_TIMING_SCHEMA_VERSION,
      startedAt: start.startedAt,
      clock: "monotonic-relative-ms",
      bounded: true,
      marks: orderedMarks,
      durations: {
        ...(localStart !== undefined && localComplete !== undefined
          ? { localDataLookupMs: Math.max(0, localComplete - localStart) }
          : {}),
        ...(elapsedById.has("first-usable-structured-result")
          ? {
              firstUsableStructuredResultMs: elapsedById.get(
                "first-usable-structured-result",
              ),
            }
          : {}),
        ...(elapsedById.has("live-enrichment-complete")
          ? {
              liveEnrichmentCompleteMs: elapsedById.get(
                "live-enrichment-complete",
              ),
            }
          : {}),
      },
    };
  }

  return { mark, has, snapshot };
}

export function evaluateAnalysisTimingContract(summary: AnalysisTimingSummary): {
  valid: boolean;
  missingMarks: AnalysisTimingMarkId[];
  firstUsableWithinProvisionalP95: boolean | null;
} {
  const present = new Set(summary.marks.map((mark) => mark.id));
  const missingMarks = ANALYSIS_TIMING_CONTRACT.requiredMarks.filter(
    (id) => !present.has(id),
  );
  const firstUsable = summary.durations.firstUsableStructuredResultMs;
  return {
    valid:
      summary.schemaVersion === ANALYSIS_TIMING_CONTRACT.schemaVersion &&
      summary.bounded &&
      summary.marks.length <= ANALYSIS_TIMING_CONTRACT.maxAnalysisMarks &&
      missingMarks.length === 0,
    missingMarks,
    firstUsableWithinProvisionalP95:
      firstUsable === undefined
        ? null
        : firstUsable <= ANALYSIS_TIMING_CONTRACT.provisionalTargetsMs.firstUsableP95,
  };
}

export function createExportTimingStore(
  options: {
    now?: MonotonicClock;
    wallNow?: WallClock;
    maxEvents?: number;
  } = {},
) {
  const now = options.now ?? defaultMonotonicClock;
  const wallNow = options.wallNow ?? defaultWallClock;
  const maxEvents = Math.max(1, options.maxEvents ?? ANALYSIS_TIMING_CONTRACT.maxExportEvents);
  const events: Array<ExportTimingEvent & { monotonicStart: number }> = [];
  let sequence = 0;

  function begin(kind: string): string {
    sequence += 1;
    const id = `export-${sequence}`;
    events.push({
      id,
      kind: kind.slice(0, 48),
      startedAt: wallNow(),
      status: "running",
      monotonicStart: now(),
    });
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    return id;
  }

  function finish(id: string, status: "ok" | "failed", error?: unknown): void {
    const event = events.find((candidate) => candidate.id === id);
    if (!event || event.status !== "running") return;
    event.status = status;
    event.completedAt = wallNow();
    event.elapsedMs = boundedElapsed(now() - event.monotonicStart);
    if (status === "failed" && error !== undefined) {
      event.error = (error instanceof Error ? error.message : String(error)).slice(0, 240);
    }
  }

  function snapshot(): ExportTimingEvent[] {
    return events.map(({ monotonicStart: _monotonicStart, ...event }) => ({ ...event }));
  }

  return { begin, finish, snapshot };
}

const runtimeStart = createAnalysisTimingStart();
const exportTimingStore = createExportTimingStore();
let appReady: { at: string; elapsedMs: number } | undefined;
let latestAnalysis: AnalysisTimingSummary | undefined;

export function markAppReady(): void {
  if (appReady) return;
  appReady = {
    at: defaultWallClock(),
    elapsedMs: boundedElapsed(defaultMonotonicClock() - runtimeStart.monotonicMs),
  };
  publishRuntimeSnapshot();
}

export function publishAnalysisTimings(summary: AnalysisTimingSummary): void {
  latestAnalysis = summary;
  publishRuntimeSnapshot();
}

export function beginExportTiming(kind: string): string {
  const id = exportTimingStore.begin(kind);
  publishRuntimeSnapshot();
  return id;
}

export function finishExportTiming(
  id: string,
  status: "ok" | "failed",
  error?: unknown,
): void {
  exportTimingStore.finish(id, status, error);
  publishRuntimeSnapshot();
}

export function getRuntimePerformanceSnapshot(): RuntimePerformanceSnapshot {
  return {
    schemaVersion: PERFORMANCE_TIMING_SCHEMA_VERSION,
    bounded: {
      maxAnalysisMarks: ANALYSIS_TIMING_CONTRACT.maxAnalysisMarks,
      maxExportEvents: ANALYSIS_TIMING_CONTRACT.maxExportEvents,
    },
    app: {
      runtimeStartedAt: runtimeStart.startedAt,
      ...(appReady
        ? { appReadyAt: appReady.at, appReadyElapsedMs: appReady.elapsedMs }
        : {}),
    },
    ...(latestAnalysis ? { latestAnalysis } : {}),
    exports: exportTimingStore.snapshot(),
  };
}

export function createExportPerformanceSummary(
  analysis: AnalysisTimingSummary,
): ExportPerformanceSummary {
  return {
    schemaVersion: PERFORMANCE_TIMING_SCHEMA_VERSION,
    analysis,
  };
}

function publishRuntimeSnapshot(): void {
  if (typeof window === "undefined") return;
  (
    window as Window & {
      __UCA_PERFORMANCE__?: RuntimePerformanceSnapshot;
    }
  ).__UCA_PERFORMANCE__ = getRuntimePerformanceSnapshot();
}

function boundedElapsed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(86_400_000, Math.round(value)));
}
