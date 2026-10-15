import { speakingRetiredResponse } from '../lib/read2lead/speaking-retired.mjs';

// Historical summary schema is still read by parent and teacher views.
export function buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, summary) {
  const entry = {
    at: now,
    pack_id: packId,
    prompt_id: promptId,
    score_percent: Number.isFinite(scorePercent) ? Math.round(scorePercent) : null,
    ready_for_class: readyForClass,
  };
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    entry.summary = summary;
  }
  return entry;
}

export async function onRequestPost() {
  return speakingRetiredResponse();
}
