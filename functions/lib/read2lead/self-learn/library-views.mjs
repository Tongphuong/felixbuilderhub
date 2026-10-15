/** Explicit public library projections. Pinned assessment content stays inside the store. */
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
import { lessonCard } from './views.mjs';
export function publicPracticeHistory(session) {
  const keys = ['session_id', 'child_id', 'lesson_id', 'title_en', 'level', 'content_version', 'content_sha256',
    'revision', 'stage', 'status', 'created_at', 'updated_at'];
  return Object.fromEntries(keys.map(key => [key, session[key]]));
}
export function publicReading(reading) {
  const keys = ['reading_id', 'child_id', 'lesson_id', 'title_en', 'level', 'content_version', 'content_sha256',
    'revision', 'sentence_id', 'marked_finished', 'created_at', 'updated_at'];
  return { ...Object.fromEntries(keys.map(key => [key, reading[key]])), evidence_kind: 'self_reported_free_reading', rewards_awarded: false };
}
export function publicPreferences(preferences) { return { revision: preferences.revision, interest_ids: [...preferences.interest_ids] }; }
export function publicLibrary(view) {
  return { child_id: view.child_id, level: view.level, preferences: publicPreferences(view.preferences),
    groups: view.groups.map(g => ({ id: g.id, label_vi: g.label_vi })),
    favorites: view.favorites.map(f => ({ lesson_id: f.lesson_id, added_at: f.added_at })),
    reading_history: view.reading_history.map(publicReading), history_limit: 100,
    suggestions: view.suggestions.map(s => ({ lesson_id: s.lesson_id, reason: s.reason,
      ...(s.reason==='publisher_continue_practice'&&validId(s.session_id)?{session_id:s.session_id}:{}),
      ...(s.reason==='publisher_continue_reading'&&validId(s.reading_id)?{reading_id:s.reading_id}:{}) })),
    automatic_mastery: false, automatic_promotion: false, real_rewards: false };
}
export function freeReadingView({ reading, lesson }) {
  return { reading: publicReading(reading), lesson: {
    ...lessonCard(lesson),
    story: { sentences: lesson.story.sentences.map(s => ({ id: s.id, text_en: s.text_en })), text_sha256: lesson.story.text_sha256 },
    input: { order: lesson.input.order, break_after_sentence_ids: [...lesson.input.break_after_sentence_ids] },
    illustrations: lesson.illustrations.map(i => ({ id: i.id, kind: i.kind, alt_en: i.alt_en, svg: i.svg })),
    audio: { asset_status: lesson.audio.asset_status, content_version: lesson.audio.content_version, script_sha256: lesson.audio.script_sha256 },
    source: { kind: lesson.source.kind, attribution: lesson.source.attribution },
    policy: { mode: 'free_reading', completion: 'self_reported', compulsory_tasks: false, rewards_awarded: false, automatic_mastery: false, automatic_promotion: false },
  } };
}
