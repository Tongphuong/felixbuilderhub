/** Client-facing V2 lesson has 6 activities; backend packs may still ship 5. */

export const RETELL_SUMMARY_ACTIVITY = {
  type: 'retell_summary',
  title_vi: 'Kể truyện',
  identity_vi: 'Minny muốn nghe con kể lại',
  instructions_vi: 'Con kể lại câu chuyện bằng tiếng Anh trong khoảng 1 phút nhé.',
};

export function ensureSixActivities(activities) {
  const list = Array.isArray(activities) ? activities.filter(Boolean).map((activity) => ({ ...activity })) : [];
  if (list.some((activity) => activity.type === 'retell_summary')) {
    return list;
  }

  const retell = { ...RETELL_SUMMARY_ACTIVITY };
  const speakIndex = list.findIndex((activity) => activity.type === 'listen_and_speak');
  if (speakIndex >= 0) {
    list.splice(speakIndex + 1, 0, retell);
  } else {
    list.push(retell);
  }
  return list;
}
