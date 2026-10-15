/** Allowlisted child/parent practice views. No automatic mastery or open-speech grading. */
import { practiceSummary } from './assessment.mjs';
export { practiceSummary } from './assessment.mjs';
export function publicCheckpoint(s) {
  const keys = ['schema_version', 'session_id', 'child_id', 'lesson_id', 'content_version', 'content_sha256', 'rubric_version',
    'engine_version', 'revision', 'stage', 'input_mode', 'status', 'created_at', 'updated_at', 'question_cursor', 'dialogue_cursor'];
  return { ...Object.fromEntries(keys.map(k => [k, s[k]])), input_order: [...s.input_order],
    acknowledged_request_ids: [...s.acknowledged_request_ids], evidence_ids: [...s.evidence_ids],
    ...(['1.2.0','1.3.0'].includes(s.schema_version) ? { repair_state: s.repair_state, followup_state: s.followup_state } : {}),
    ...(s.schema_version === '1.3.0' ? { input_audio_used: s.input_audio_used === true } : {}) };
}
export function lessonCard(lesson) {
  return { id: lesson.id, version: lesson.version, level: lesson.level, level_label_vi: lesson.level_label_vi,
    title_en: lesson.title_en, theme: lesson.theme, practice_only: true, audio_available: lesson.audio.asset_status === 'ready' };
}
export function publicLesson(lesson) {
  return {
    ...lessonCard(lesson), rubric_version: lesson.rubric_version,
    difficulty: { reasoning: lesson.difficulty.reasoning, independence: lesson.difficulty.independence, language: lesson.difficulty.language },
    input: { order: lesson.input.order, break_after_sentence_ids: [...lesson.input.break_after_sentence_ids] },
    pre_read: { prediction_vi: lesson.pre_read.prediction_vi, vocabulary: lesson.pre_read.vocabulary.map(v => ({ word_en: v.word_en, meaning_vi: v.meaning_vi })) },
    story: { sentences: lesson.story.sentences.map(s => ({ id: s.id, text_en: s.text_en })), text_sha256: lesson.story.text_sha256 },
    illustrations: lesson.illustrations.map(i => ({ id: i.id, kind: i.kind, alt_en: i.alt_en, svg: i.svg })),
    audio: { asset_status: lesson.audio.asset_status, content_version: lesson.audio.content_version, script_sha256: lesson.audio.script_sha256 },
    questions: lesson.questions.map(q => ({ id: q.id, version: q.version, kind: q.kind, dimension: q.dimension, prompt_en: q.prompt_en,
      options_en: [...q.options_en], scenario_visual_description: q.scenario_visual_description,
      ...(q.option_illustration_ids ? { option_illustration_ids: [...q.option_illustration_ids] } : {}),
      evidence_requested: q.evidence_spans.length > 0, support_available: true })),
    shadowing: { sentence_ids: [...lesson.shadowing.sentence_ids], mode: lesson.shadowing.mode, capture_optional: true },
    minny: { identity_vi: lesson.minny.identity_vi, max_turns: lesson.minny.max_turns,
      turns: lesson.minny.turns.map(t => ({ id: t.id, prompt_en: t.prompt_en, fallback_vi: t.fallback_vi })) },
    retell: { prompt_en: lesson.retell.prompt_en, support_form: lesson.retell.support_form },
    source: { kind: lesson.source.kind, attribution: lesson.source.attribution },
    policy: { practice_only: true, automatic_promotion: false, real_rewards: false, open_response_scoring: 'pending_validated_assessor' },
  };
}
function supportView(record) {
  return record.support.map(s => {
    const q = record.lesson.questions.find(q => q.id === s.item_id);
    return { item_id: s.item_id, kind: s.kind,
      text_vi: s.kind === 'revealing_hint' ? 'Con xem lại chi tiết này rồi thử giải thích bằng ý của mình nhé.' :
        s.kind === 'question_audio' ? 'Bản nghe chưa sẵn sàng. Con vẫn có thể đọc câu hỏi.' : 'Con có thể dùng khung này để bắt đầu.',
      frame_en: s.kind === 'frame' ? (record.lesson.version === '1.0.0' ? (record.lesson.level === 'L0' ? 'It is …' : 'I think … because …') :
        { L0: '… does …', L1: 'First … Next … Finally …', L2: 'At first … Then … because … In the end …', L3: 'Problem … Attempt … Outcome … Evidence …', L4: 'From this viewpoint … Compared with … The story shows …', L5: 'My claim … My evidence … My reason … An alternative … What I still need to know …' }[record.lesson.level]) : null,
      sentences: s.kind === 'revealing_hint' && q ? q.evidence_spans.map(e => ({ id: e.sentence_id, text_en: e.quote })) :
        s.kind === 'reference_script' ? record.lesson.story.sentences.filter(x => record.lesson.shadowing.sentence_ids.includes(x.id)).map(x => ({ id: x.id, text_en: x.text_en })) : [],
    };
  });
}
export function sessionView(record) {
  const repair = record.lesson.misconception_repair, follow = record.lesson.independent_followup;
  const steps = record.session.schema_version === '1.2.0' ? {
    repair: { state: record.session.repair_state, prompt: ['shown', 'answered'].includes(record.session.repair_state) ?
      { id: repair.id, hint_vi: repair.hint_vi, prompt_en: repair.fresh_prompt_en, options_en: [...repair.options_en], practice_only: true } : null },
    followup: { state: record.session.followup_state, prompt: record.retell_received ?
      { id: follow.id, prompt_en: follow.prompt_en, options_en: [...follow.options_en] } : null },
  } : null;
  return { session: publicCheckpoint(record.session), lesson: publicLesson(record.lesson), summary: practiceSummary(record),
    retell_received: record.retell_received, support: supportView(record), learning_steps: steps };
}
