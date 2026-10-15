import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSchemaCheck } from '../functions/lib/read2lead/self-learn/schema-check.mjs';
import { validateEditorLesson, technicalReviewFor, matchesTechnicalReview, passiveSvg } from '../functions/lib/read2lead/self-learn/editor-policy.mjs';
const fixture = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name, import.meta.url), 'utf8'));
const lessons = [...fixture('level-lessons.json').lessons, ...fixture('library-lessons.json').lessons];
const schema = JSON.parse(readFileSync(new URL('../schemas/read2lead-self-learn/lesson.v1.1.schema.json', import.meta.url), 'utf8'));
const check = createSchemaCheck(schema);
const validate = lesson => validateEditorLesson({ mode: 'synthetic-local', lesson });
const base = () => structuredClone(lessons[2]);
const wrap = lesson => ({ contract_version: '1.1.0', lessons: [lesson] });
for (const lesson of lessons) test('editor accepts original draft integrity: ' + lesson.id, async () => {
  const result = await validate(lesson); assert.deepEqual(result.lesson, lesson); assert.notEqual(result.lesson, lesson);
  assert.match(result.content_sha256, /^[a-f0-9]{64}$/); assert.equal(result.human_review, false); assert.equal(result.publication, 'not_authorized');
});
for (const c of fixture('editor-schema-cases.json').cases) test('shared schema case: ' + c.id, () => {
  const value = base(); let parent = value;
  for (const key of c.path.slice(0, -1)) parent = parent[key];
  if (c.op === 'delete') delete parent[c.path.at(-1)]; else parent[c.path.at(-1)] = c.value;
  assert.equal(check(wrap(value)).length === 0, c.valid);
});
test('all required schema fields and closed objects reject missing or extra values', () => {
  const original = wrap(base()); let tested = 0;
  function valueAt(root, path) { return path.reduce((v, k) => v[k], root); }
  function visit(s, path) {
    if (s.$ref) { visit(schema.definitions[s.$ref.split('/').at(-1)], path); return; }
    const value = valueAt(original, path);
    if (value && !Array.isArray(value) && typeof value === 'object') {
      for (const key of s.required || []) { const copy = structuredClone(original); delete valueAt(copy, path)[key]; assert.ok(check(copy).some(i => i.code === 'required'), path + ':' + key); tested++; }
      if (s.additionalProperties === false) { const copy = structuredClone(original); valueAt(copy, path).injected = 'synthetic'; assert.ok(check(copy).some(i => i.code === 'additionalProperties'), path.join('/')); tested++; }
      for (const [key, child] of Object.entries(s.properties || {})) if (Object.hasOwn(value, key)) visit(child, [...path, key]);
    } else if (Array.isArray(value) && s.items) value.forEach((_, i) => visit(s.items, [...path, i]));
  }
  visit(schema, []); assert.ok(tested > 200, tested);
});
test('unsupported schema features and mutable caller schemas cannot weaken validation', () => {
  for (const extra of [{ anyOf: [] }, { $ref: 'https://example.invalid/schema' }, { additionalProperties: true }, { type: 'mystery' }, { pattern: '[' }]) {
    assert.throws(() => createSchemaCheck({ type: 'string', ...extra }), /unsupported_schema/);
  }
  const input = { type: 'object', properties: { safe: { type: 'boolean', const: false } }, required: ['safe'], additionalProperties: false };
  const saved = createSchemaCheck(input); input.properties.safe.const = true;
  assert.equal(saved({ safe: false }).length, 0); assert.ok(saved({ safe: true }).length);
});
const mutations = [
  ['duplicate followup options', l => { l.independent_followup.options_en[1] = l.independent_followup.options_en[0]; }, 'ambiguous_followup_options'],
  ['invented evidence quote', l => { l.questions[0].evidence_spans[0].quote = 'Invented synthetic fact.'; }, 'invalid_evidence_quote'],
  ['missing story evidence', l => { l.questions[0].evidence_spans = []; }, 'missing_story_evidence'],
  ['duplicate options', l => { l.questions[0].options_en[1] = l.questions[0].options_en[0].toUpperCase(); }, 'ambiguous_duplicate_options'],
  ['distractor includes correct answer', l => { l.questions[0].distractors[0].option_index = l.questions[0].correct_index; }, 'distractor_key_mismatch'],
  ['duplicate distractor', l => { l.questions[0].distractors[1].option_index = l.questions[0].distractors[0].option_index; }, 'distractor_key_mismatch'],
  ['unknown shadowing reference', l => { l.shadowing.sentence_ids = ['absent']; }, 'unknown_sentence_reference'],
  ['duplicate item id', l => { l.minny.turns[0].id = l.questions[0].id; }, 'duplicate_item_id'],
  ['duplicate image id', l => { l.illustrations.push(structuredClone(l.illustrations[0])); }, 'duplicate_item_id'],
  ['unsafe ID', l => { l.id = '../../private'; }, 'invalid_editor_id'],
  ['missing dimension', l => { l.questions[2].dimension = 'meaning'; }, 'missing_rubric_dimension'],
  ['turn count mismatch', l => { l.minny.max_turns = 5; }, 'turn_budget_mismatch'],
  ['followup leaked in practice', l => { l.independent_followup.prompt_en = l.minny.turns[0].prompt_en; }, 'followup_exposed_in_practice'],
  ['stale followup version', l => { l.independent_followup.version = '1.0.0'; }, 'item_version_mismatch'],
  ['changed story hash', l => { l.story.sentences[0].text_en += ' Synthetic edit.'; }, 'story_hash_mismatch'],
  ['unsafe SVG', l => { l.illustrations[0].svg = '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'; }, 'unsafe_svg'],
];
for (const [name, mutate, code] of mutations) test('editor rejects ' + name, async () => {
  const value = base(); mutate(value); await assert.rejects(validate(value), e => e.code === 'invalid_editor_integrity' && e.issues.includes(code));
});
test('editor refuses nonlocal, claimed publication and unsupported live data', async () => {
  await assert.rejects(validateEditorLesson({ mode: 'production', lesson: base() }), { code: 'editor_local_only' });
  for (const change of [l => { l.review.independent_review = true; }, l => { l.source.publication_rights_review = 'approved'; }, l => { l.audio.asset_uri = 'https://example.invalid/audio'; }, l => { l.status = 'published'; }]) {
    const l = base(); change(l); await assert.rejects(validate(l), { code: 'invalid_editor_draft' });
  }
});
test('editor snapshots before asynchronous checks and does not share caller objects', async () => {
  const input = base(), title = input.title_en; const pending = validate(input); input.title_en = 'Later synthetic mutation';
  const snapshot = await pending; assert.equal(snapshot.lesson.title_en, title); assert.notEqual(snapshot.lesson.questions, input.questions);
  snapshot.lesson.questions[0].prompt_en = 'Local returned copy'; assert.notEqual(snapshot.lesson.questions[0].prompt_en, input.questions[0].prompt_en);
});
test('editor JSON boundary rejects accessors, cycles, prototypes and size abuse', async () => {
  let touched = false; const getter = base(); Object.defineProperty(getter, 'title_en', { enumerable: true, get() { touched = true; return 'unsafe'; } });
  await assert.rejects(validate(getter), { code: 'invalid_editor_json' }); assert.equal(touched, false);
  for (const build of [() => { const v = base(); v.cycle = v; return v; }, () => new Date(), () => { const v = base(); v.title_en = undefined; return v; }, () => { const v = base(); v.questions = Array(3); return v; }, () => { const v = base(); v[Symbol('secret')] = true; return v; }, () => ({ ...base(), constructor: 'synthetic' }), () => ({ ...base(), extra: Infinity })]) {
    await assert.rejects(validate(build()), { code: 'invalid_editor_json' });
  }
  await assert.rejects(validate({ ...base(), title_en: 'x'.repeat(32769) }), { code: 'editor_input_limit' });
});
test('passive SVG grammar rejects executable, remote and malformed markup', () => {
  for (const svg of ['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/private"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://example.invalid)"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#x)"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>', '<svg xmlns="http://www.w3.org/2000/svg"><text>&#65;</text></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', '<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" width="2"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><use href="#x"/></svg>']) assert.equal(passiveSvg(svg), false, svg);
  assert.equal(passiveSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g color="#fff"><path d="M0 0L5 5" stroke="currentColor" stroke-dasharray="2 2"/></g></svg>'), true);
});
test('technical review binds exact revision and content and cannot claim human approval', async () => {
  const snapshot = await validate(base()); const args = { revision: 1, reviewer_id: 'synthetic-editor-qa', reviewed_at: '2026-09-19T00:00:00.000Z' };
  const review = await technicalReviewFor(snapshot, args); const key = { lesson_id: snapshot.lesson.id, revision: 1, content_sha256: snapshot.content_sha256 };
  assert.equal(matchesTechnicalReview(review, key), true);
  for (const altered of [{ ...key, revision: 2 }, { ...key, content_sha256: '0'.repeat(64) }, { ...key, lesson_id: 'another-story' }]) assert.equal(matchesTechnicalReview(review, altered), false);
  for (const altered of [{ ...review, human_review: true }, { ...review, independent_review: true }, { ...review, publication: 'approved' }, { ...review, hidden: 'injected' }]) assert.equal(matchesTechnicalReview(altered, key), false);
  for (const invalid of [{ lesson_id: '../invalid' }, { revision: Number.MAX_SAFE_INTEGER }, { revision: 0 }]) assert.equal(matchesTechnicalReview({ ...review, ...invalid }, { ...key, ...invalid }), false);
  snapshot.lesson.title_en = 'Changed after technical verification'; await assert.rejects(technicalReviewFor(snapshot, args), { code: 'stale_technical_review' });
});
