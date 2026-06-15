export type LearningEvent = {
  type?: string;
  ts?: string;
};

export type LearningMetricEntry = {
  pack_id: string;
  started_at: string | null;
  passed_at: string | null;
  score: number;
  retry_count: number;
  attention_score: number;
  time_to_pass_ms: number;
  suspect: boolean;
};

export type LearningMetrics = {
  packs_history: LearningMetricEntry[];
  '7day_summary': LearningMetricsSummary;
};

export type LearningMetricsSummary = {
  first_try_pass_rate: number;
  avg_retry_count: number;
  avg_attention_score: number;
  suspect_count: number;
  calculated_at: string;
};

export const SUSPECT_TIME_MS = 30_000;
export const SUSPECT_SCORE_PERCENT = 50;
export const ATTENTION_EVENT_WINDOW_MS = 10_000;

export function clampPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function isSuspectPack({
  timeToPassMs,
  scorePercent,
}: {
  timeToPassMs: unknown;
  scorePercent: unknown;
}): boolean {
  const time = Number(timeToPassMs);
  const score = Number(scorePercent);
  return Number.isFinite(time)
    && Number.isFinite(score)
    && time < SUSPECT_TIME_MS
    && score >= SUSPECT_SCORE_PERCENT;
}

export function calculateAttentionScore({
  startedAt,
  endedAt,
  events,
  eventWindowMs = ATTENTION_EVENT_WINDOW_MS,
}: {
  startedAt: string | null | undefined;
  endedAt: string | null | undefined;
  events?: LearningEvent[];
  eventWindowMs?: number;
}): number {
  const start = Date.parse(String(startedAt || ''));
  const end = Date.parse(String(endedAt || ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const duration = end - start;
  const windows = (Array.isArray(events) ? events : [])
    .map((event) => {
      const ts = Date.parse(String(event?.ts || ''));
      if (!Number.isFinite(ts)) return null;
      return [Math.max(start, ts), Math.min(end, ts + eventWindowMs)] as [number, number];
    })
    .filter((window): window is [number, number] => Boolean(window && window[1] > window[0]))
    .sort((a, b) => a[0] - b[0]);

  if (!windows.length) return 0;

  let activeMs = 0;
  let [currentStart, currentEnd] = windows[0];
  for (const [from, to] of windows.slice(1)) {
    if (from <= currentEnd) {
      currentEnd = Math.max(currentEnd, to);
    } else {
      activeMs += currentEnd - currentStart;
      currentStart = from;
      currentEnd = to;
    }
  }
  activeMs += currentEnd - currentStart;

  return clampPercent((activeMs / duration) * 100);
}

export function buildLearningMetricEntry({
  packId,
  startedAt,
  passedAt,
  scorePercent,
  retryCount,
  attentionScore,
}: {
  packId: unknown;
  startedAt: string | null | undefined;
  passedAt: string | null | undefined;
  scorePercent: unknown;
  retryCount: unknown;
  attentionScore: unknown;
}): LearningMetricEntry {
  const start = Date.parse(String(startedAt || ''));
  const pass = Date.parse(String(passedAt || ''));
  const timeToPassMs = Number.isFinite(start) && Number.isFinite(pass) && pass >= start ? pass - start : 0;
  const score = clampPercent(scorePercent) / 100;
  const retry = Math.max(0, Math.floor(Number(retryCount) || 0));
  const attention = clampPercent(attentionScore);

  return {
    pack_id: String(packId || '').trim(),
    started_at: Number.isFinite(start) ? new Date(start).toISOString() : null,
    passed_at: Number.isFinite(pass) ? new Date(pass).toISOString() : null,
    score,
    retry_count: retry,
    attention_score: attention,
    time_to_pass_ms: timeToPassMs,
    suspect: isSuspectPack({ timeToPassMs, scorePercent }),
  };
}

export function summarizeLearningMetrics(
  history: LearningMetricEntry[],
  nowIso = new Date().toISOString(),
): LearningMetricsSummary {
  const now = Date.parse(nowIso);
  const cutoff = Number.isFinite(now) ? now - 7 * 24 * 60 * 60 * 1000 : 0;
  const recent = (Array.isArray(history) ? history : []).filter((entry) => {
    const ts = Date.parse(String(entry.passed_at || entry.started_at || ''));
    return Number.isFinite(ts) && (!cutoff || ts >= cutoff);
  });
  const count = recent.length || 0;
  const firstTry = count ? recent.filter((entry) => Number(entry.retry_count || 0) === 0).length / count : 0;
  const retryTotal = recent.reduce((sum, entry) => sum + Math.max(0, Number(entry.retry_count) || 0), 0);
  const attentionTotal = recent.reduce((sum, entry) => sum + clampPercent(entry.attention_score), 0);

  return {
    first_try_pass_rate: count ? round2(firstTry) : 0,
    avg_retry_count: count ? round2(retryTotal / count) : 0,
    avg_attention_score: count ? Math.round(attentionTotal / count) : 0,
    suspect_count: recent.filter((entry) => entry.suspect === true).length,
    calculated_at: Number.isFinite(now) ? new Date(now).toISOString() : new Date().toISOString(),
  };
}

export function normalizeLearningMetrics(raw: unknown, nowIso = new Date().toISOString()): LearningMetrics {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const history = Array.isArray(source.packs_history)
    ? source.packs_history.map((entry) => normalizeEntry(entry)).filter(Boolean).slice(0, 50) as LearningMetricEntry[]
    : [];
  return {
    packs_history: history,
    '7day_summary': summarizeLearningMetrics(history, nowIso),
  };
}

function normalizeEntry(raw: unknown): LearningMetricEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const packId = String(entry.pack_id || '').trim();
  if (!packId) return null;
  return {
    pack_id: packId,
    started_at: typeof entry.started_at === 'string' ? entry.started_at : null,
    passed_at: typeof entry.passed_at === 'string' ? entry.passed_at : null,
    score: Math.max(0, Math.min(1, Number(entry.score) || 0)),
    retry_count: Math.max(0, Math.floor(Number(entry.retry_count) || 0)),
    attention_score: clampPercent(entry.attention_score),
    time_to_pass_ms: Math.max(0, Math.floor(Number(entry.time_to_pass_ms) || 0)),
    suspect: entry.suspect === true,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
