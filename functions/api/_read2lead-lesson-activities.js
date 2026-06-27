/** Client-facing V2 lesson has 6 activities; backend packs ship 5 (A/B/C/E + no 6th). */

import { rewriteAudioHost } from './_read2lead-audio-url.js';

export const READ_ALOUD_ACTIVITY = {
  type: 'read_aloud',
  title_vi: 'Đọc to',
  identity_vi: 'Con đọc to từng câu cho Minny nghe nhé!',
  instructions_vi: 'Con đọc từng câu trong truyện, Minny sẽ chấm điểm.',
  scoring_mode: 'whisper_stt',
};

/**
 * @param {object[]} activities
 * @param {{ story?: object, topic?: string, activities?: object[] } | null} [lessonContext]
 * @param {object} [env]
 */
export function ensureSixActivities(activities, lessonContext = null, env = undefined) {
  const list = Array.isArray(activities)
    ? activities.filter(Boolean).map((activity) => ({
        ...activity,
        ...(Array.isArray(activity.items)
          ? {
              items: activity.items.map((item) =>
                item && typeof item === 'object' && Object.hasOwn(item, 'audio_url')
                  ? { ...item, audio_url: rewriteAudioHost(item.audio_url, env) }
                  : item,
              ),
            }
          : {}),
      }))
    : [];

  if (list.some((activity) => activity.type === 'read_aloud')) return list;

  const readAloud = { ...READ_ALOUD_ACTIVITY };
  if (lessonContext?.story?.sentences?.length) {
    readAloud.items = lessonContext.story.sentences.map((sentence, i) => ({
      id: `ra_${i}`,
      text_en: sentence.text_en || '',
      text_vi: sentence.text_vi || '',
      tip_vi: 'Con đọc to, rõ ràng nhé!',
      audio_url: sentence.audio_url || '',
    }));
  }
  const speakIndex = list.findIndex((activity) => activity.type === 'listen_and_speak');
  if (speakIndex >= 0) {
    list.splice(speakIndex + 1, 0, readAloud);
  } else {
    list.push(readAloud);
  }
  return list;
}
