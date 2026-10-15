/** Local catalogue integrity checks, not a validated semantic/CEFR or health assessor. */
const REASONING = ['actor_action_object', 'sequence_reference', 'cause_feeling', 'motive_causal_chain', 'comparison_viewpoint', 'claim_evidence_uncertainty'];
const BOUNDS = [[20, 70], [45, 160], [75, 240], [110, 330], [150, 450], [190, 550]];
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
export async function levelIssues(lesson, requestedLevel = lesson?.level) {
  const issues = [], level = /^L[0-5]$/.test(lesson?.level) ? Number(lesson.level[1]) : -1;
  if (!/^L[0-5]$/.test(requestedLevel) || lesson?.level !== requestedLevel) issues.push('requested_level_mismatch');
  if (level < 0) return [...issues, 'unknown_level'];
  if (lesson.difficulty?.reasoning !== REASONING[level]) issues.push('level_reasoning');
  const sentences = lesson.story?.sentences || [], text = sentences.map(s => s.text_en).join(' '), count = text.trim().split(/\s+/u).length;
  if (count < BOUNDS[level][0] || count > BOUNDS[level][1]) issues.push('level_load');
  const hash = await digest(text);
  if (hash !== lesson.story?.text_sha256) issues.push('story_hash_mismatch');
  if (hash !== lesson.audio?.script_sha256 || text !== lesson.audio?.script_en) issues.push('audio_text_mismatch');
  if (lesson.audio?.content_version !== lesson.version) issues.push('audio_version_mismatch');
  const ids = new Set(sentences.map(s => s.id)), breaks = lesson.input?.break_after_sentence_ids || [];
  const positions = breaks.map(id => sentences.findIndex(s => s.id === id));
  if (ids.size !== sentences.length || breaks.some(id => !ids.has(id)) || positions.some((p, i) => i > 0 && p <= positions[i - 1]) || new Set(breaks).size !== breaks.length || breaks.at(-1) !== sentences.at(-1)?.id) issues.push('invalid_reading_groups');
  if (level === 0 && (lesson.shadowing?.mode !== 'echo_with_pause' || lesson.input?.order !== 'listen_then_read')) issues.push('l0_support_required');
  const pictures = new Map((lesson.illustrations || []).map(i => [i.id, i]));
  for (const q of lesson.questions || []) {
    if (q.version !== lesson.version) issues.push('item_version_mismatch');
    if (q.kind === 'picture_choice' && (q.option_illustration_ids?.length !== q.options_en?.length || new Set(q.option_illustration_ids).size !== q.options_en.length || q.option_illustration_ids.some(id => !pictures.has(id)))) issues.push('missing_picture_choices');
  }
  if (level === 0 && !lesson.questions?.some(q => q.kind === 'picture_choice')) issues.push('l0_picture_choice_required');
  if (level <= 1 && lesson.version === '1.1.0' && [1, 2, 3].some(i => !pictures.has(lesson.id + '-retell-' + i))) issues.push('retell_picture_missing');
  if (lesson.policy?.automatic_promotion !== false || lesson.policy?.unassessable_is_zero !== false || lesson.retell?.missing_speech_preserves_reading !== true) issues.push('unsafe_assessment_policy');
  return [...new Set(issues)];
}
export async function requireLevelLesson(lesson, requestedLevel) {
  const issues = await levelIssues(lesson, requestedLevel);
  if (issues.length) { const error = Error('unsuitable_content'); error.issues = issues; throw error; }
  return lesson; // No lower-level fallback, relabel, repair or provider call here.
}
export async function requireLevelCatalogue(collection) {
  if (!['1.0.0', '1.1.0'].includes(collection?.contract_version) || !Array.isArray(collection.lessons) || !collection.lessons.length || new Set(collection.lessons.map(l => l.id)).size !== collection.lessons.length || collection.lessons.some(l => l.version !== collection.contract_version)) throw Error('invalid_catalogue');
  for (const lesson of collection.lessons) await requireLevelLesson(lesson, lesson.level);
  return collection;
}
