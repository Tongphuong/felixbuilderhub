const list = value => Array.isArray(value) ? value : [];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
const text = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Small allowlist: no audio, transcripts, provider payloads or inferred scores. */
export function safeStoryAssessment(state) {
  const retell = state?.pictureRetellResult;
  const assessed = ['complete', 'needs_practice'].includes(retell?.status);
  const savedPronunciation = retell?.pronunciation;
  // Current retelling stores acoustic scores with the provider on the result.
  // Keep the legacy scorer shape readable, without deriving scores from text.
  const acoustic = retell?.speech === 'azure'
    && percent(savedPronunciation?.accuracy) !== null
    && percent(savedPronunciation?.fluency) !== null
    && Number.isFinite(savedPronunciation?.seconds) && savedPronunciation.seconds > 0
    ? { scorer: 'azure_pronunciation_unscripted', accuracy_percent: percent(savedPronunciation.accuracy) }
    : savedPronunciation;
  const pronunciation = assessed && ['azure_pronunciation', 'azure_pronunciation_unscripted'].includes(acoustic?.scorer)
    && percent(acoustic?.accuracy_percent) !== null
    ? { scorer: acoustic.scorer, accuracy_percent: percent(acoustic.accuracy_percent) } : null;
  return {
    question_score: state?.missionResult?.assessment?.status === 'complete' ? percent(state.missionResult.assessment.scorePercent) : null,
    retell_status: ['complete', 'needs_practice', 'unassessed'].includes(retell?.status) ? retell.status : null,
    content_points: assessed ? list(retell.meanings).slice(0, 12).filter(p => typeof p?.met === 'boolean' && text(p.label)).map(p => ({ label: text(p.label), met: p.met })) : [],
    pronunciation,
  };
}

/** Read-only projection of this account's existing records. Unknown is not zero. */
export function buildParentSummary(account, state, currentPack = account?.progress?.current_pack) {
  const records = new Map();
  const add = row => {
    const id = text(row?.pack_id);
    if (!id) return;
    records.set(id, { ...records.get(id), ...row });
  };
  const assignedSources = new Set([currentPack, ...Object.values(account?.story_pack_history || {}), ...list(account?.progress?.review_history)].map(p => p?.story_reference?.source_id || p?.story_source_id).filter(Boolean));
  for (const row of list(state?.pack_history)) {
    if (String(row?.pack_id || '').startsWith('story:') && assignedSources.has(row.pack_id.slice(6))) continue;
    add(row);
  }
  for (const row of [...list(account?.progress?.review_history)].reverse()) add(row);
  for (const row of Object.values(account?.story_pack_history || {})) add(row);
  add(currentPack);
  const entries = [...records.values()].map(pack => {
    const story = pack.schema_version === 'story-mission-v1' || Boolean(pack.story_id || pack.story_source_id || pack.story_reference);
    const session = pack.story_session || {};
    const assessment = session.assessment_summary || {};
    const original = pack.web_lesson_summary || pack.review_summary || {};
    const questionsComplete = story && (session.complete === true || pack.story_complete === true);
    const retellComplete = story && session.picture_retell_complete === true;
    const retellRequired = pack.picture_retell_required === true;
    const originalComplete = !story && (original.completed === true || original.passed === true || String(pack.status || '').startsWith('reviewed_pass'));
    const content = list(assessment.content_points).filter(p => typeof p?.met === 'boolean' && text(p.label)).slice(0, 12).map(p => ({ label: text(p.label), met: p.met }));
    const pron = assessment.pronunciation;
    const pronunciation = ['azure_pronunciation', 'azure_pronunciation_unscripted'].includes(pron?.scorer) && percent(pron?.accuracy_percent) !== null
      ? { accuracy_percent: percent(pron.accuracy_percent) } : null;
    return {
      id: pack.pack_id, title: text(pack.story_title || pack.title) || 'Truyện đã lưu',
      kind: story ? 'story' : 'original', date: date(pack.completed_at || pack.reviewed_at || original.submitted_at || pack.created_at || pack.generated_at),
      current: pack.pack_id === currentPack?.pack_id, review_only: pack.review_only === true,
      stage: retellComplete ? 'retelling_completed' : questionsComplete ? 'questions_completed' : originalComplete ? 'lesson_completed' : count(session.question_count) > 0 ? 'questions_in_progress' : 'opened',
      question_count: story ? count(session.question_count) : count(original.total_count),
      question_total: story ? count(session.question_total) : count(original.total_count),
      question_score: questionsComplete ? percent(assessment.question_score ?? pack.score_percent) : originalComplete ? percent(original.score_percent ?? pack.score_percent) : null,
      retell: retellComplete ? 'complete' : assessment.retell_status === 'needs_practice' ? 'needs_practice' : assessment.retell_status === 'unassessed' ? 'unassessed' : retellRequired ? 'pending' : story && pack.picture_retell_required !== false ? 'unknown' : 'not_applicable',
      content_points: content, pronunciation,
    };
  }).sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.date || '1970-01-01') - Date.parse(a.date || '1970-01-01') || a.id.localeCompare(b.id)).slice(0, 8);
  const latest = entries.find(e => e.current) || entries[0];
  let next = { kind: 'start', text: 'Anh chị cùng con mở câu chuyện đầu tiên nhé.' };
  if (latest) {
    const missing = latest.content_points.find(p => !p.met);
    if (latest.retell === 'needs_practice' && missing) next = { kind: 'retry_content', text: `Cùng con kể lại ý còn thiếu: ${missing.label}` };
    else if (['pending', 'needs_practice', 'unassessed'].includes(latest.retell) && latest.stage === 'questions_completed') next = { kind: 'retell', text: 'Con đã hoàn thành phần câu hỏi. Anh chị cùng con kể lại truyện qua tranh nhé.' };
    else if (latest.stage === 'questions_in_progress') next = { kind: 'questions', text: 'Anh chị cùng con tiếp tục những câu hỏi còn lại trong truyện đang mở.' };
    else if (latest.stage === 'opened') next = { kind: 'resume', text: 'Anh chị cùng con tiếp tục truyện đang mở. Chưa có kết quả hoàn thành được lưu.' };
    else if (latest.retell === 'unknown') next = { kind: 'check_retell', text: 'Phần câu hỏi đã được lưu; chưa có kết quả kể qua tranh. Anh chị mở lại truyện cùng con để xem bước tiếp theo.' };
    else next = { kind: 'next_story', text: 'Kết quả đã được lưu. Khi sẵn sàng, con có thể mở câu chuyện tiếp theo.' };
  }
  return { version: 1, entries, next_step: next, completed_count: count(state?.completed_packs) ?? count(account?.progress?.completed_packs) ?? 0 };
}
