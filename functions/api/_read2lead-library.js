const TOPIC_EMOJI = {
  animals: '🐾',
  school: '🏫',
  family: '👨‍👩‍👧',
  sports: '⚽',
  food: '🍎',
  nature: '🌳',
  friends: '🤝',
  adventure: '🗺️',
  music: '🎵',
  space: '🚀',
};

export function topicEmoji(topic = '') {
  const normalized = String(topic || '').trim().toLowerCase();
  if (!normalized) return '📖';
  for (const [key, emoji] of Object.entries(TOPIC_EMOJI)) {
    if (normalized.includes(key)) return emoji;
  }
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash + normalized.charCodeAt(index) * (index + 1)) % Object.keys(TOPIC_EMOJI).length;
  }
  return Object.values(TOPIC_EMOJI)[hash] || '📖';
}

export function listCompletedStories(reviewHistory = []) {
  return (Array.isArray(reviewHistory) ? reviewHistory : [])
    .filter((entry) => entry?.pack_id && String(entry.status || '').includes('reviewed'))
    .map((entry) => ({
      pack_id: String(entry.pack_id),
      title: String(entry.title || 'Câu chuyện').trim() || 'Câu chuyện',
      topic: String(entry.topic || '').trim(),
      level: String(entry.level || 'L1').trim() || 'L1',
      completed_at: entry.reviewed_at || entry.completed_at || null,
      ...(entry.score_percent != null && Number.isFinite(Number(entry.score_percent)) ? { score_percent: Math.max(0, Math.min(100, Math.round(Number(entry.score_percent)))) } : {}),
      emoji: topicEmoji(entry.topic),
    }));
}

function childDisplayName(studentName = '') {
  const trimmed = String(studentName || '').trim();
  if (!trimmed) return 'Con';
  return trimmed.split(/\s+/)[0];
}

function lessonPath(accessCode, packId) {
  const code = String(accessCode || '').trim().toUpperCase();
  const pack = String(packId || '').trim();
  if (!code || !pack) return null;
  return `/read2lead/lesson?code=${encodeURIComponent(code)}&pack_id=${encodeURIComponent(pack)}`;
}

/** Parent-friendly story progress for the student profile (review page). */
export function buildStoryProgressForProfile({
  reviewHistory = [],
  studentName = '',
  currentLevel = 'L1',
  packsCompletedInLevel = 0,
  packsNeededForLevelUp = 0,
  accessCode = '',
} = {}) {
  const stories = listCompletedStories(reviewHistory);
  const totalCompleted = stories.length;
  const childName = childDisplayName(studentName);
  const inLevel = Math.max(0, Number(packsCompletedInLevel) || 0);
  const needed = Math.max(0, Number(packsNeededForLevelUp) || 0);

  const headline = totalCompleted === 0
    ? `${childName} chưa có truyện nào hoàn thành`
    : `${childName} đã học xong ${totalCompleted} truyện`;

  let level_hint = '';
  if (needed > 0 && inLevel < needed) {
    const remaining = needed - inLevel;
    level_hint = `Còn ${remaining} truyện nữa để mở level tiếp theo (${currentLevel}).`;
  }

  return {
    total_completed: totalCompleted,
    headline,
    parent_hint: 'Bấm "Cho con làm lại" để nghe truyện và luyện bài một lần nữa.',
    empty_hint: 'Khi con làm xong một bài trên web, truyện sẽ hiện ở đây để bố mẹ cho con đọc lại.',
    level_hint,
    stories: stories.map((story) => ({
      ...story,
      lesson_path: lessonPath(accessCode, story.pack_id),
    })),
  };
}

/** @deprecated Use buildStoryProgressForProfile — kept for legacy API callers. */
export function buildLibraryPayload(options = {}) {
  const progress = buildStoryProgressForProfile(options);
  return {
    ...progress,
    student_name: String(options.studentName || '').trim(),
    progress_message: progress.headline,
    chapters: [],
  };
}
