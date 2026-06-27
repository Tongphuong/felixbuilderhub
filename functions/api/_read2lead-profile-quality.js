const DAY_MS = 24 * 60 * 60 * 1000;

export const PROFILE_SKILLS = [
  { key: 'reading', label_vi: 'Đọc hiểu', emoji: '📖', types: ['reading_comprehension'] },
  { key: 'listening', label_vi: 'Nghe', emoji: '🎧', types: ['guided_listening', 'listening_fill_blank'] },
  { key: 'pronunciation', label_vi: 'Phát âm', emoji: '🗣️', types: ['listen_and_speak', 'read_aloud'] },
  { key: 'vocabulary', label_vi: 'Từ vựng', emoji: '📚', types: ['listening_fill_blank'] },
  { key: 'grammar', label_vi: 'Ngữ pháp', emoji: '✍️', types: ['listen_and_order', 'written_response'] },
];

function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

export function activityScore(result) {
  if (!result || typeof result !== 'object' || !result.type) return null;
  const explicit = clampPercent(result.score_percent);
  if (explicit != null) return { type: String(result.type), score_percent: explicit };
  const correct = Number(result.correct_count);
  const total = Number(result.total_count);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0) return null;
  return {
    type: String(result.type),
    score_percent: clampPercent((correct / total) * 100),
  };
}

export function compactActivityScores(activityResults) {
  return (Array.isArray(activityResults) ? activityResults : [])
    .map(activityScore)
    .filter(Boolean);
}

export function buildSkillQuality({ packHistory = [], currentPack = null, nowIso = new Date().toISOString() } = {}) {
  const cutoff = Date.parse(nowIso) - 30 * DAY_MS;
  const rows = [];
  const seenPackIds = new Set();

  const addRow = (packId, completedAt, scores) => {
    const id = String(packId || '').trim();
    const timestamp = Date.parse(completedAt || '');
    if (!id || seenPackIds.has(id) || !Number.isFinite(timestamp) || timestamp < cutoff) return;
    const validScores = (Array.isArray(scores) ? scores : []).filter(
      (score) => activityScore(score) != null,
    );
    if (!validScores.length) return;
    seenPackIds.add(id);
    rows.push(...validScores);
  };

  for (const entry of Array.isArray(packHistory) ? packHistory : []) {
    addRow(entry?.pack_id, entry?.completed_at, entry?.activity_scores);
  }

  const summary = currentPack?.review_summary || currentPack?.web_lesson_summary;
  addRow(
    currentPack?.pack_id,
    currentPack?.reviewed_at || summary?.completed_at || summary?.submitted_at,
    compactActivityScores(summary?.activity_results),
  );

  return {
    window_days: 30,
    skills: PROFILE_SKILLS.map((skill) => {
      const values = rows
        .filter((row) => skill.types.includes(String(row?.type || '')))
        .map((row) => clampPercent(row?.score_percent))
        .filter((value) => value != null);
      return {
        key: skill.key,
        label_vi: skill.label_vi,
        emoji: skill.emoji,
        score_percent: values.length
          ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
          : null,
        sample_count: values.length,
      };
    }),
  };
}
