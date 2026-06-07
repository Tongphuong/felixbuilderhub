export const PACKS_PER_CHAPTER = 5;
export const CHAPTER_THEME = 'Rừng kỳ diệu';

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
    hash = (hash + normalized.charCodeAt(index) * (index + 1)) % TOPIC_EMOJI.length;
  }
  return Object.values(TOPIC_EMOJI)[hash] || '📖';
}

export function normalizeReviewEntries(reviewHistory = []) {
  return (Array.isArray(reviewHistory) ? reviewHistory : [])
    .filter((entry) => entry?.pack_id && String(entry.status || '').includes('reviewed'))
    .map((entry) => ({
      pack_id: String(entry.pack_id),
      title: String(entry.title || 'Câu chuyện').trim() || 'Câu chuyện',
      topic: String(entry.topic || '').trim(),
      level: String(entry.level || 'L1').trim() || 'L1',
      completed_at: entry.reviewed_at || entry.completed_at || null,
      emoji: topicEmoji(entry.topic),
    }))
    .reverse();
}

export function buildLibraryPayload({ reviewHistory = [], studentName = '' } = {}) {
  const completed = normalizeReviewEntries(reviewHistory);
  const totalCompleted = completed.length;
  const chapterCount = Math.max(1, Math.ceil(Math.max(totalCompleted, 1) / PACKS_PER_CHAPTER));
  const packsIntoCurrentChapter = totalCompleted % PACKS_PER_CHAPTER;
  const packsUntilNextChapter = packsIntoCurrentChapter === 0
    ? (totalCompleted === 0 ? PACKS_PER_CHAPTER : 0)
    : PACKS_PER_CHAPTER - packsIntoCurrentChapter;

  const chapters = [];
  for (let chapterIndex = 0; chapterIndex < chapterCount; chapterIndex += 1) {
    const slots = [];
    for (let slotIndex = 0; slotIndex < PACKS_PER_CHAPTER; slotIndex += 1) {
      const globalIndex = chapterIndex * PACKS_PER_CHAPTER + slotIndex;
      const pack = completed[globalIndex];
      if (pack) {
        slots.push({
          status: 'completed',
          pack_id: pack.pack_id,
          title: pack.title,
          topic: pack.topic,
          level: pack.level,
          completed_at: pack.completed_at,
          emoji: pack.emoji,
        });
        continue;
      }
      slots.push({
        status: globalIndex === totalCompleted ? 'next' : 'locked',
        pack_id: null,
        title: '',
        topic: '',
        level: '',
        completed_at: null,
        emoji: '📖',
      });
    }

    const completedInChapter = slots.filter((slot) => slot.status === 'completed').length;
    chapters.push({
      chapter_index: chapterIndex + 1,
      title: CHAPTER_THEME,
      completed_count: completedInChapter,
      total_count: PACKS_PER_CHAPTER,
      unlocked: chapterIndex === 0 || completedInChapter > 0 || chapterIndex * PACKS_PER_CHAPTER <= totalCompleted,
      slots,
    });
  }

  let progress_message = '';
  if (totalCompleted === 0) {
    progress_message = `Hoàn thành ${PACKS_PER_CHAPTER} bài đầu tiên để mở chương "${CHAPTER_THEME}".`;
  } else if (packsUntilNextChapter === 0 && totalCompleted > 0 && totalCompleted % PACKS_PER_CHAPTER === 0) {
    progress_message = `Chương ${Math.floor(totalCompleted / PACKS_PER_CHAPTER)} "${CHAPTER_THEME}" đã mở!`;
  } else {
    progress_message = `Còn ${packsUntilNextChapter} bài để mở chương "${CHAPTER_THEME}".`;
  }

  return {
    student_name: String(studentName || '').trim(),
    total_completed: totalCompleted,
    packs_per_chapter: PACKS_PER_CHAPTER,
    chapter_theme: CHAPTER_THEME,
    packs_until_next_chapter: packsUntilNextChapter,
    progress_message,
    chapters,
  };
}
