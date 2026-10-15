/** Explicit local draft catalogue. A review digest binds content; it does not validate pedagogy. */
import { canonical } from './session.mjs';
import { requireLevelCatalogue } from './level-policy.mjs';

const keys = (object, expected) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).sort().join('|') === [...expected].sort().join('|');
export async function contentDigest(lesson) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(lesson)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function composeLocalCatalogue({ mode, base, additional, review } = {}) {
  if (mode !== 'synthetic-local') throw Error('local_catalogue_only');
  // Snapshot before any await so the caller cannot mutate between validation and return.
  const candidate = structuredClone({ base, additional, review });
  ({ base, additional, review } = candidate);
  for (const source of [base, additional]) {
    if (!keys(source, ['contract_version', 'lessons']) || source.contract_version !== '1.1.0' || !Array.isArray(source.lessons)) throw Error('invalid_catalogue');
  }
  if (base.lessons.length !== 6 || additional.lessons.length !== 24) throw Error('invalid_catalogue_count');
  const catalogue = { contract_version: '1.1.0', lessons: [...base.lessons, ...additional.lessons] };
  for (let i = 0; i <= 5; i++) {
    if (base.lessons.filter(l => l.level === 'L' + i).length !== 1 || additional.lessons.filter(l => l.level === 'L' + i).length !== 4) throw Error('invalid_level_count');
  }
  await requireLevelCatalogue(catalogue);
  if (new Set(catalogue.lessons.map(l => l.story.text_sha256)).size !== 30) throw Error('duplicate_story');
  if (!keys(review, ['format', 'environment', 'reviews']) || review.format !== 1 || review.environment !== mode || !Array.isArray(review.reviews) || review.reviews.length !== 30) throw Error('invalid_review');
  const reviews = new Map(review.reviews.map(r => [r.lesson_id, r]));
  if (reviews.size !== 30) throw Error('invalid_review');
  for (const lesson of catalogue.lessons) {
    const r = reviews.get(lesson.id);
    if (!keys(r, ['lesson_id', 'version', 'content_sha256', 'reviewer', 'verification', 'independent_review', 'human_review', 'status', 'publication', 'narration', 'focus']) ||
        r.version !== lesson.version || r.reviewer !== 'Codex' || r.verification !== 'solo' || r.independent_review !== false || r.human_review !== false ||
        r.status !== 'local_candidate_pending_human_review' || r.publication !== 'not_authorized' || r.narration !== 'not_recorded' ||
        canonical(r.focus) !== canonical(lesson.objectives)) throw Error('invalid_review');
    if (lesson.status !== 'draft' || lesson.source?.kind !== 'original' || lesson.source.publication_rights_review !== 'pending_owner_review' ||
        lesson.source.external_assets?.length !== 0 || lesson.review?.independent_review !== false || lesson.review.publication !== 'not_authorized' ||
        lesson.audio.asset_status !== 'not_recorded' || lesson.audio.asset_uri !== null || lesson.policy.real_rewards !== false) throw Error('invalid_candidate_policy');
    if (r.content_sha256 !== await contentDigest(lesson)) throw Error('stale_content_review');
  }
  return catalogue;
}
