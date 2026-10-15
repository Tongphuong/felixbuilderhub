/** Conservative practice evidence; no general semantic or acoustic assessor. */
const normal = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
const revealing = new Set(['revealing_hint', 'frame', 'repeated_item', 'reference_script']);
function readingItem(attempt, lesson) {
  const q = lesson.questions.find(q => q.id === attempt.item_id), p = attempt.payload;
  const correct = p.choice_index === q.correct_index, selected = new Set(p.evidence_sentence_ids);
  const relevant = new Set(q.evidence_spans.map(x => x.sentence_id));
  const evidence = !relevant.size ? 'not_requested' : !selected.size ? 'missing' :
    [...selected].every(id => relevant.has(id)) ? 'supported' : 'needs_review';
  const text = normal(p.text);
  const accepted = [q.options_en[q.correct_index], ...q.accepted_meanings].map(normal);
  const wrong = q.options_en.filter((_, i) => i !== q.correct_index).map(normal);
  const explanation = !text ? 'not_provided' : accepted.includes(text) ? 'known_supported' : wrong.includes(text) ? 'contradictory' : 'pending';
  const support = [...p.support_used];
  let status = !correct || explanation === 'contradictory' || evidence === 'needs_review' ? 'needs_support' :
    evidence === 'missing' || explanation === 'pending' ? 'pending' : support.some(x => revealing.has(x)) ? 'assisted' : 'provisional';
  return { attempt_id: attempt.request_id, item_id: q.id, dimension: q.dimension,
    choice_result: correct ? 'correct' : 'needs_support', evidence_result: evidence, explanation_result: explanation,
    status, support_used: support, independent_mastery: false, score: null,
    feedback_vi: status === 'needs_support' ? 'Mình cùng tìm lại chi tiết trong câu chuyện nhé.' :
      status === 'pending' ? 'Ý của con đã được lưu. Phần giải thích này cần được xem thêm.' :
      status === 'assisted' ? 'Con đã thử với gợi ý. Lần sau mình có thể thử một ý mới nhé.' : 'Con đã nối được một ý. Mình tiếp tục với câu hỏi mới nhé.' };
}
export function practiceSummary(record) {
  const reading = record.attempts.filter(a => a.event === 'answer').map(a => readingItem(a, record.lesson));
  const speech = record.attempts.filter(a => ['shadow_complete', 'minny_turn', 'retell'].includes(a.event)).map(a => ({
    attempt_id: a.request_id, activity: a.event, item_id: a.item_id,
    content_state: a.payload.text.trim() ? 'pending' : 'unassessable',
    oral_language_state: a.payload.capture_status === 'valid' ? 'pending' : 'unassessable',
    capture_status: a.payload.capture_status, support_used: [...a.payload.support_used],
    essential_facts: null, order_causality: null, language_intelligibility: null, score: null,
  }));
  const fresh_probes = record.attempts.filter(a => ['repair_answer', 'skip_repair', 'followup_answer', 'skip_followup'].includes(a.event)).map(a => {
    const repair = ['repair_answer', 'skip_repair'].includes(a.event), q = repair ? record.lesson.misconception_repair : record.lesson.independent_followup;
    const skipped = a.payload.choice_index === null, correct = a.payload.choice_index === q.correct_index;
    const text = normal(a.payload.text), accepted = [q.options_en[q.correct_index], ...(q.accepted_meanings || [])].map(normal);
    const contradiction = text && q.options_en.filter((_, i) => i !== q.correct_index).map(normal).includes(text);
    const status = skipped ? 'unassessable' : !correct || contradiction ? 'needs_support' :
      text && !accepted.includes(text) ? 'pending' : repair ? 'practice_only' : a.payload.support_used.some(x => revealing.has(x)) ? 'assisted' : 'provisional';
    return { attempt_id: a.request_id, item_id: a.item_id, activity: repair ? 'repair' : 'followup', status,
      choice_result: skipped ? 'not_attempted' : correct ? 'correct' : 'needs_support', support_used: [...a.payload.support_used], independent_mastery: false, score: null };
  });
  return { rubric_version: record.session.rubric_version, reading, speech, fresh_probes,
    reading_mode: record.session.input_mode, reading_preserved: true,
    automatic_mastery: false, automatic_promotion: false,
    note_vi: 'Đây là bằng chứng luyện tập, chưa phải kết luận thành thạo. Phần đọc và phần nói được theo dõi riêng.' };
}
