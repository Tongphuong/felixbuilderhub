/** Original-draft import integrity only. No datastore, publishing authority or human assessment. */
import schema from '../../../../schemas/read2lead-self-learn/lesson.v1.1.schema.json' with { type: 'json' };
import { createSchemaCheck } from './schema-check.mjs';
import { levelIssues } from './level-policy.mjs';
import { contentDigest } from './catalogue.mjs';
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
const checkSchema = createSchemaCheck(schema);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export class EditorPolicyError extends Error {
  constructor(code, issues = []) { super(code); this.code = code; this.issues = issues; }
}
const requireThat = (ok, code) => { if (!ok) throw new EditorPolicyError(code); };
/** Reject non-wire values/accessors without executing them; copy before any asynchronous hashing. */
function snapshotJSON(input) {
  let nodes = 0; const seen = new Set();
  function copy(v, depth) {
    requireThat(++nodes <= 20000 && depth <= 24, 'editor_input_limit');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { requireThat(Number.isFinite(v), 'invalid_editor_json'); return v; }
    if (typeof v === 'string') { requireThat(v.length <= 32768, 'editor_input_limit'); return v; }
    requireThat(v && typeof v === 'object' && !seen.has(v) && Object.getOwnPropertySymbols(v).length === 0, 'invalid_editor_json');
    const array = Array.isArray(v);
    requireThat(array ? Object.getPrototypeOf(v) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(v)), 'invalid_editor_json');
    const descriptors = Object.getOwnPropertyDescriptors(v); seen.add(v);
    try {
      if (array) {
        requireThat(v.length <= 2000 && Object.keys(descriptors).length === v.length + 1, 'invalid_editor_json');
        return Array.from({ length: v.length }, (_, i) => { const d = descriptors[String(i)]; requireThat(d && Object.hasOwn(d, 'value'), 'invalid_editor_json'); return copy(d.value, depth + 1); });
      }
      return Object.fromEntries(Object.entries(descriptors).map(([k, d]) => {
        requireThat(!['__proto__', 'constructor', 'prototype'].includes(k) && k.length <= 100 && d.enumerable && Object.hasOwn(d, 'value'), 'invalid_editor_json');
        return [k, copy(d.value, depth + 1)];
      }));
    } finally { seen.delete(v); }
  }
  const value = copy(input, 0);
  requireThat(new TextEncoder().encode(JSON.stringify(value)).length <= 262144, 'editor_input_limit'); return value;
}
const TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'title', 'desc']);
const NUMERIC_ATTRS = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewBox', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'letter-spacing', 'stroke-dasharray']);
/** Deliberately small passive SVG grammar: no URLs, CSS, references, entities or executable elements. */
export function passiveSvg(svg) {
  if (typeof svg !== 'string' || svg.length > 32768 || /[&\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(svg)) return false;
  const stack = []; let offset = 0, roots = 0, count = 0;
  const token = /<[^<>]*>/g; let match;
  while ((match = token.exec(svg))) {
    const text = svg.slice(offset, match.index); offset = token.lastIndex;
    if (/[<>]/.test(text) || (text.trim() && !['text', 'title', 'desc'].includes(stack.at(-1)))) return false;
    const tag = /^<(\/)?([a-zA-Z]+)([\s\S]*?)(\/?)>$/.exec(match[0]);
    if (!tag || !TAGS.has(tag[2]) || ++count > 500) return false;
    const [, closing, name, tail, selfClosing] = tag;
    if (closing) { if (tail.trim() || selfClosing || stack.pop() !== name) return false; continue; }
    if (!stack.length) { if (name !== 'svg' || ++roots !== 1) return false; }
    else if (name === 'svg') return false;
    const attrs = new Map(); const attr = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/gy;
    let consumed = 0, item;
    while ((item = attr.exec(tail))) {
      consumed = attr.lastIndex; const key = item[1], value = item[2] ?? item[3];
      if (attrs.has(key)) return false; attrs.set(key, value);
      if (key === 'xmlns') { if (name !== 'svg' || value !== 'http://www.w3.org/2000/svg') return false; }
      else if (NUMERIC_ATTRS.has(key)) { if (!/^[0-9eE+.,\s-]+$/.test(value) || !/\d/.test(value)) return false; }
      else if (['fill', 'stroke', 'color'].includes(key)) { if (!/^(?:none|#[a-fA-F0-9]{3,8}|black|white|transparent|currentColor)$/.test(value)) return false; }
      else if (key === 'd') { if (name !== 'path' || !/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/.test(value)) return false; }
      else if (key === 'points') { if (!['polyline', 'polygon'].includes(name) || !/^[0-9eE+.,\s-]+$/.test(value)) return false; }
      else if (key === 'transform') { if (!/^(?:(?:translate|scale|rotate|matrix|skewX|skewY)\([0-9eE+.,\s-]+\)\s*)+$/.test(value)) return false; }
      else if (key === 'role') { if (value !== 'img') return false; }
      else if (key === 'stroke-linecap') { if (!['butt', 'round', 'square'].includes(value)) return false; }
      else if (key === 'stroke-linejoin') { if (!['miter', 'round', 'bevel'].includes(value)) return false; }
      else if (key === 'text-anchor') { if (!['start', 'middle', 'end'].includes(value)) return false; }
      else if (key === 'font-family') { if (!['sans-serif', 'serif', 'monospace'].includes(value)) return false; }
      else if (key === 'font-weight') { if (!/^(?:normal|bold|[1-9]00)$/.test(value)) return false; }
      else return false;
    }
    if (tail.slice(consumed).trim() || (name === 'svg' && attrs.get('xmlns') !== 'http://www.w3.org/2000/svg')) return false;
    if (!selfClosing) stack.push(name);
  }
  return roots === 1 && stack.length === 0 && !svg.slice(offset).trim();
}
export async function validateEditorLesson({ mode, lesson } = {}) {
  requireThat(mode === 'synthetic-local', 'editor_local_only');
  const candidate = snapshotJSON(lesson);
  const schemaIssues = checkSchema({ contract_version: '1.1.0', lessons: [candidate] });
  if (schemaIssues.length) throw new EditorPolicyError('invalid_editor_draft', schemaIssues);
  const issues = await levelIssues(candidate);
  const issue = code => issues.push(code);
  const unique = values => new Set(values).size === values.length;
  const ids = [candidate.id, ...candidate.story.sentences.map(s => s.id), ...candidate.illustrations.map(i => i.id),
    ...candidate.questions.map(q => q.id), ...candidate.minny.turns.map(t => t.id), candidate.independent_followup.id];
  if (!ids.every(validId)) issue('invalid_editor_id');
  if (!unique(candidate.illustrations.map(i => i.id)) || !unique([...candidate.questions.map(q => q.id), ...candidate.minny.turns.map(t => t.id), candidate.independent_followup.id])) issue('duplicate_item_id');
  const sentences = new Map(candidate.story.sentences.map(s => [s.id, s.text_en]));
  if (candidate.shadowing.sentence_ids.some(id => !sentences.has(id))) issue('unknown_sentence_reference');
  const spans = [...candidate.minny.facts, ...candidate.retell.essential_facts];
  for (const q of candidate.questions) {
    const normalized = q.options_en.map(o => o.trim().toLocaleLowerCase('en'));
    if (!unique(normalized)) issue('ambiguous_duplicate_options');
    const expected = normalized.map((_, i) => i).filter(i => i !== q.correct_index);
    const actual = q.distractors.map(d => d.option_index).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) issue('distractor_key_mismatch');
    if (q.source === 'story' && !q.evidence_spans.length) issue('missing_story_evidence');
    spans.push(...q.evidence_spans);
  }
  if (JSON.stringify([...new Set(candidate.questions.map(q => q.dimension))].sort()) !== JSON.stringify(['evidence', 'meaning', 'transfer'])) issue('missing_rubric_dimension');
  if (spans.some(s => sentences.get(s.sentence_id) !== s.quote)) issue('invalid_evidence_quote');
  if (candidate.minny.max_turns !== candidate.minny.turns.length) issue('turn_budget_mismatch');
  if (candidate.independent_followup.version !== candidate.version) issue('item_version_mismatch');
  if (!unique(candidate.independent_followup.options_en.map(o => o.trim().toLocaleLowerCase('en')))) issue('ambiguous_followup_options');
  if (candidate.minny.turns.some(t => t.prompt_en === candidate.independent_followup.prompt_en)) issue('followup_exposed_in_practice');
  if (candidate.illustrations.some(i => !passiveSvg(i.svg))) issue('unsafe_svg');
  if (issues.length) throw new EditorPolicyError('invalid_editor_integrity', [...new Set(issues)]);
  const content_sha256 = await contentDigest(candidate);
  return { lesson: candidate, content_sha256, contract_version: '1.1.0', human_review: false, independent_review: false, publication: 'not_authorized' };
}
export async function technicalReviewFor(snapshot, { revision, reviewer_id, reviewed_at } = {}) {
  requireThat(Number.isSafeInteger(revision) && revision > 0 && revision < Number.MAX_SAFE_INTEGER && validId(reviewer_id) && reviewer_id.startsWith('synthetic-') && typeof reviewed_at === 'string' && Number.isFinite(Date.parse(reviewed_at)), 'invalid_technical_review');
  // Revalidate instead of trusting a caller-supplied digest or a mutable prior snapshot.
  const verified = await validateEditorLesson({ mode: 'synthetic-local', lesson: snapshot?.lesson });
  requireThat(verified.content_sha256 === snapshot.content_sha256, 'stale_technical_review');
  return { lesson_id: verified.lesson.id, revision, content_sha256: verified.content_sha256, reviewer_id, reviewed_at,
    verification: 'solo_technical', independent_review: false, human_review: false, suitability: 'pending_human_review', rights: 'pending_owner_review', publication: 'not_authorized' };
}
export function matchesTechnicalReview(review, { lesson_id, revision, content_sha256 } = {}) {
  return exact(review, ['lesson_id', 'revision', 'content_sha256', 'reviewer_id', 'reviewed_at', 'verification', 'independent_review', 'human_review', 'suitability', 'rights', 'publication']) &&
    review.lesson_id === lesson_id && review.revision === revision && review.content_sha256 === content_sha256 &&
    validId(lesson_id) && Number.isSafeInteger(revision) && revision > 0 && revision < Number.MAX_SAFE_INTEGER && typeof content_sha256 === 'string' && /^[a-f0-9]{64}$/.test(content_sha256) && validId(review.reviewer_id) && review.reviewer_id.startsWith('synthetic-') &&
    typeof review.reviewed_at === 'string' && Number.isFinite(Date.parse(review.reviewed_at)) && review.verification === 'solo_technical' && review.independent_review === false && review.human_review === false &&
    review.suitability === 'pending_human_review' && review.rights === 'pending_owner_review' && review.publication === 'not_authorized';
}
