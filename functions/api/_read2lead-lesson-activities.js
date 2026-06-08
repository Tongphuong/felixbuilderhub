/** Client-facing V2 lesson has 6 activities; backend packs may still ship 5. */

import {
  buildRetellGuideQuestions,
  buildRetellPromptEn,
  buildRetellPromptVi,
} from './_read2lead-retell-guide.js';

export const RETELL_SUMMARY_ACTIVITY = {
  type: 'retell_summary',
  title_vi: 'Kể truyện',
  identity_vi: 'Minny muốn nghe con kể lại — dùng câu gợi ý bên dưới nhé',
  instructions_vi: 'Con xem các câu gợi ý, rồi kể lại câu chuyện bằng tiếng Anh trong khoảng 1 phút.',
};

/**
 * @param {object[]} activities
 * @param {{ story?: object, topic?: string, activities?: object[] } | null} [lessonContext]
 */
export function ensureSixActivities(activities, lessonContext = null) {
  const list = Array.isArray(activities) ? activities.filter(Boolean).map((activity) => ({ ...activity })) : [];
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
  const guide = buildRetellGuideQuestions(lessonContext);
  return {
    ...activity,
    guide_questions_vi: Array.isArray(activity.guide_questions_vi) && activity.guide_questions_vi.length
      ? activity.guide_questions_vi
      : guide,
    prompt_vi: activity.prompt_vi || buildRetellPromptVi(lessonContext),
    prompt_en: activity.prompt_en || buildRetellPromptEn(lessonContext),
  };
}
