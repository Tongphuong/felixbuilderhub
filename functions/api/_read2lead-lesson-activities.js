/** Client-facing V2 lesson has 6 activities; backend packs may still ship 5. */

import {
  buildRetellPromptEn,
  buildRetellPromptVi,
  buildRetellTemplate,
} from './_read2lead-retell-guide.js';
import { rewriteAudioHost } from './_read2lead-audio-url.js';

export const RETELL_SUMMARY_ACTIVITY = {
  type: 'retell_summary',
  title_vi: 'Kể truyện',
  identity_vi: 'Minny muốn nghe con kể lại — con điền chỗ trống và nhìn truyện bên dưới nhé',
  instructions_vi: 'Con đọc truyện, điền các chỗ trống trong khung vàng, rồi kể bằng tiếng Anh.',
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
  const context = lessonContext || { activities: list };

  const existingIndex = list.findIndex((activity) => activity.type === 'retell_summary');
  if (existingIndex >= 0) {
    const retell = enrichRetellActivity(list[existingIndex], context);
    list[existingIndex] = retell;
    return list;
  }

  const retell = enrichRetellActivity({ ...RETELL_SUMMARY_ACTIVITY }, context);
  const speakIndex = list.findIndex((activity) => activity.type === 'listen_and_speak');
  if (speakIndex >= 0) {
    list.splice(speakIndex + 1, 0, retell);
  } else {
    list.push(retell);
  }
  return list;
}

function enrichRetellActivity(activity, lessonContext) {
  const template = buildRetellTemplate(lessonContext);
  return {
    ...activity,
    retell_template: activity.retell_template || template,
    speak_prompt_en: activity.speak_prompt_en || template.speak_prompt_en,
    prompt_vi: activity.prompt_vi || buildRetellPromptVi(lessonContext),
    prompt_en: activity.prompt_en || buildRetellPromptEn(lessonContext),
  };
}
