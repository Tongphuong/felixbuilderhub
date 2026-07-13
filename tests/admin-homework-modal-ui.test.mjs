// Schema v3 (homework-tasks-contract.md, 2026-07-13): teacher-side
// paste-the-lesson authoring + editable typed task list, added to
// HomeworkModal.astro/classes.astro. Also covers the photo-upload
// silent-drop bug fix (task doc §B).
//
// No jsdom in this repo (see tests/speakup-chips-ui.test.mjs's header
// note) -- string/region assertions on the raw source, plus `new
// Function`-extracted pure helpers for the parts worth real behavioral
// coverage (task summary/edit-apply round-tripping), matching this repo's
// existing convention for .astro inline-script logic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modalSrc = readFileSync('src/components/admin/HomeworkModal.astro', 'utf-8');
const classesSrc = readFileSync('src/pages/admin/classes.astro', 'utf-8');

function extractFunctionSrc(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `function ${name} not found`);
  const parenStart = source.indexOf('(', start);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { parenEnd = i; break; }
    }
  }
  assert.notEqual(parenEnd, -1, `could not find end of parameter list for function ${name}`);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, `could not find closing brace of function ${name}`);
  return source.slice(start, end);
}

// hwTaskSummary/hwApplyTaskEdit are pure enough to extract and run against a
// fake DOM-ish `editorEl` stub (just `querySelector` over a plain object
// map) -- no real DOM needed since these only ever read `.value`/`.checked`
// off whatever `data-field` node querySelector hands back.
function loadTaskHelpers() {
  const pieces = [
    extractFunctionSrc(classesSrc, 'hwTaskId'),
    extractFunctionSrc(classesSrc, 'hwTaskSummary'),
    extractFunctionSrc(classesSrc, 'hwApplyTaskEdit'),
    extractFunctionSrc(classesSrc, 'hwEmptyTask'),
  ];
  const body = `${pieces.join('\n\n')}\n\nreturn { hwTaskSummary, hwApplyTaskEdit, hwEmptyTask };`;
  // eslint-disable-next-line no-new-func -- pure source extracted from the page itself
  return new Function(body)();
}

const { hwTaskSummary, hwApplyTaskEdit, hwEmptyTask } = loadTaskHelpers();

// Brace-matched region extraction from an arbitrary marker (e.g. an
// addEventListener call) rather than a `function name(` -- needed for the
// anonymous-callback handlers below, where a naive indexOf('});') would
// stop at the FIRST nested call's closing (e.g. the inner fetch(...) options
// object), not the handler's own end.
function extractRegionByBraceMatch(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `marker not found: ${marker}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, `could not find closing brace for: ${marker}`);
  return source.slice(start, end);
}

// A tiny stand-in for the editor DOM node: `querySelector('[data-field="x"]')`
// returns an object with a mutable `.value`/`.checked`, matching what
// hwApplyTaskEdit's `get(field)` helper calls into.
function fakeEditor(fields) {
  return {
    querySelector(selector) {
      const m = selector.match(/data-field="([^"]+)"/);
      const key = m && m[1];
      return key in fields ? { value: fields[key], checked: !!fields[key] } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// hwEmptyTask: manually-added tasks match the contract's exact schema shape
// ---------------------------------------------------------------------------

test('hwEmptyTask produces a valid skeleton per type, matching the contract\'s field names', () => {
  assert.deepEqual(hwEmptyTask('read').items, [{ id: 's1', text_en: '' }]);
  assert.deepEqual(hwEmptyTask('present').stems, [{ id: 'f1', text_en: '' }]);
  assert.equal(hwEmptyTask('present').duration_s, 60);
  assert.equal(hwEmptyTask('story').type, 'story');
  assert.deepEqual(hwEmptyTask('story').must_use, []);
  assert.equal(hwEmptyTask('build').columns.length, 1);
  assert.equal(hwEmptyTask('build').sentences_required, 1);
  assert.deepEqual(hwEmptyTask('picture').anchors, []);
  assert.equal(hwEmptyTask('qa').cards.length, 1);
  assert.equal(hwEmptyTask('nonsense'), null);
});

// ---------------------------------------------------------------------------
// hwApplyTaskEdit: round-trips teacher edits back into the task object
// ---------------------------------------------------------------------------

test('hwApplyTaskEdit(read): splits the textarea into items[], one per non-empty line', () => {
  const task = { id: 't1', type: 'read', items: [] };
  hwApplyTaskEdit(task, fakeEditor({ items_text: 'I have two cats.\n\nShe is happy.' }));
  assert.deepEqual(task.items, [
    { id: 's1', text_en: 'I have two cats.' },
    { id: 's2', text_en: 'She is happy.' },
  ]);
});

test('hwApplyTaskEdit(story): must_use is lowercased, trimmed, comma-split', () => {
  const task = { id: 't2', type: 'story' };
  hwApplyTaskEdit(task, fakeEditor({
    prompt_en: 'Tell the story of your best friend.',
    prompt_vi: '',
    must_use_text: 'Because, Friend ,  HAPPY',
    duration_s: '90',
    use_photo: true,
  }));
  assert.equal(task.prompt_en, 'Tell the story of your best friend.');
  assert.deepEqual(task.must_use, ['because', 'friend', 'happy']);
  assert.equal(task.duration_s, 90);
  assert.equal(task.use_photo, true);
});

test('hwApplyTaskEdit(build): "Label: opt1 | opt2" mini-format parses into columns[]', () => {
  const task = { id: 't3', type: 'build' };
  hwApplyTaskEdit(task, fakeEditor({
    columns_text: 'We…: play football | draw pictures\nAt…: school | the park',
    sentences_required: '2',
  }));
  assert.deepEqual(task.columns, [
    { id: 'c1', label_en: 'We…', options: ['play football', 'draw pictures'] },
    { id: 'c2', label_en: 'At…', options: ['school', 'the park'] },
  ]);
  assert.equal(task.sentences_required, 2);
});

test('hwApplyTaskEdit(qa): "question || stem" mini-format parses into cards[]', () => {
  const task = { id: 't4', type: 'qa' };
  hwApplyTaskEdit(task, fakeEditor({
    cards_text: 'Is your friend funny? || Yes, my friend is ___ because ___.',
  }));
  assert.deepEqual(task.cards, [
    { id: 'q1', question_en: 'Is your friend funny?', stem: { text_en: 'Yes, my friend is ___ because ___.' } },
  ]);
});

test('hwApplyTaskEdit(picture): anchors normalized the same way as must_use', () => {
  const task = { id: 't5', type: 'picture' };
  hwApplyTaskEdit(task, fakeEditor({ anchors_text: 'Dog, Park , BALL', duration_s: '45' }));
  assert.deepEqual(task.anchors, ['dog', 'park', 'ball']);
  assert.equal(task.duration_s, 45);
});

// ---------------------------------------------------------------------------
// hwTaskSummary: human-readable, escaped by the caller (renderTaskList),
// not itself -- so this only has to prove the content is right.
// ---------------------------------------------------------------------------

test('hwTaskSummary produces a short human-readable line per type', () => {
  assert.match(hwTaskSummary({ type: 'read', items: [{ text_en: 'Hi.' }, { text_en: 'Bye.' }] }), /2 câu/);
  assert.match(hwTaskSummary({ type: 'build', columns: [{}, {}], sentences_required: 3 }), /2 cột.*3 câu/);
  assert.match(hwTaskSummary({ type: 'picture', anchors: [] }), /chưa có từ khoá/);
  assert.match(hwTaskSummary({ type: 'story', prompt_en: 'Tell a story', must_use: ['because'] }), /Tell a story/);
});

// ---------------------------------------------------------------------------
// draft:null -> calm state, never an error dialog (contract §5 / task §A.2)
// ---------------------------------------------------------------------------

test('hwRunExtract renders the calm "Minny chưa đọc được" state on draft:null AND on any thrown/parse failure, never alert()', () => {
  const src = extractFunctionSrc(classesSrc, 'hwRunExtract');
  assert.match(src, /Minny chưa đọc được bài này, thầy nhập tay nhé\./);
  // Appears in both the else-branch (draft falsy) and the catch block.
  const occurrences = src.match(/Minny chưa đọc được bài này, thầy nhập tay nhé\./g) || [];
  assert.ok(occurrences.length >= 2, 'the calm message must cover both draft:null and a network/parse failure');
  assert.doesNotMatch(src, /\balert\(/, 'extraction failures must never pop an error dialog');
});

test('hwRunExtract is the single call site for /homework-extract, driven by both lesson_text and r2_key', () => {
  assert.match(classesSrc, /homework-extract`/);
  const callSites = classesSrc.match(/hwRunExtract\(\{[^}]*\}\)/g) || [];
  assert.ok(callSites.some((c) => c.includes('lesson_text')), 'paste-lesson must call hwRunExtract with lesson_text');
  assert.ok(callSites.some((c) => c.includes('r2_key')), 'photo picker must call hwRunExtract with r2_key');
});

// ---------------------------------------------------------------------------
// Save payload: task list wins when non-empty; old two-textarea path still
// works when it's empty (task doc §A.4)
// ---------------------------------------------------------------------------

test('save payload sends {tasks:[...]} when the task list has entries, else falls back to the old sentences_text/frame_text shape', () => {
  const idx = classesSrc.indexOf("document.getElementById('homework-form')?.addEventListener('submit'");
  assert.notEqual(idx, -1);
  const region = classesSrc.slice(idx, idx + 1500);
  assert.match(region, /hwTasksState\.length/);
  assert.match(region, /tasks:\s*hwTasksState/);
  assert.match(region, /sentences_text:/);
  assert.match(region, /frame_text:/);
});

// ---------------------------------------------------------------------------
// BUG FIX (task doc §B): a failed photo upload must not silently clear the
// photo before telling the teacher it will save without one
// ---------------------------------------------------------------------------

test('BUG FIX: photo upload failure alerts the CONCRETE consequence before clearing, not after', () => {
  const region = extractRegionByBraceMatch(classesSrc, "document.getElementById('homework-photo-input')?.addEventListener('change'");
  const catchIdx = region.indexOf('} catch (err) {');
  assert.notEqual(catchIdx, -1);
  const catchBlock = region.slice(catchIdx);
  const alertIdx = catchBlock.indexOf('alert(');
  const clearIdx = catchBlock.indexOf('hwPhotoClear();');
  assert.notEqual(alertIdx, -1);
  assert.notEqual(clearIdx, -1);
  assert.ok(alertIdx < clearIdx, 'alert() must run BEFORE hwPhotoClear() so the teacher is told before the state resets');
  assert.match(catchBlock, /KHÔNG có ảnh/, 'the message must spell out the concrete consequence, not just "upload failed"');
});

test('BUG FIX: the photo-upload handler no longer auto-fills the old two-textarea quick path (superseded by the typed task-list draft)', () => {
  const region = extractRegionByBraceMatch(classesSrc, "document.getElementById('homework-photo-input')?.addEventListener('change'");
  assert.doesNotMatch(region, /homework-photo-extract/, 'photo extraction now drives hwRunExtract (schema v3), not the old two-textarea endpoint');
  assert.match(region, /hwRunExtract\(\{ r2_key: upResult\.photo\.r2_key \}\)/);
});

// ---------------------------------------------------------------------------
// Markup: paste-lesson box, task list, add-task control all present; modal
// scrolls internally now that it's much taller
// ---------------------------------------------------------------------------

test('markup: paste-lesson textarea/button and the editable task list container exist', () => {
  assert.match(modalSrc, /id="homework-lesson-paste"/);
  assert.match(modalSrc, /id="homework-lesson-extract-btn"/);
  assert.match(modalSrc, /id="homework-task-list"/);
  assert.match(modalSrc, /id="homework-task-empty"/);
  assert.match(modalSrc, /id="homework-task-add-type"/);
  assert.match(modalSrc, /id="homework-task-add-btn"/);
});

test('markup: modal content scrolls internally (max-h + overflow-y-auto) now that it carries much more content', () => {
  assert.match(modalSrc, /max-h-\[75vh\]\s+space-y-4\s+overflow-y-auto/);
});

test('old two-textarea quick path markup is untouched (sentences/frame/duration/note fields still present)', () => {
  assert.match(modalSrc, /id="homework-sentences"[\s\S]*name="sentences_text"/);
  assert.match(modalSrc, /id="homework-frame"[\s\S]*name="frame_text"/);
  assert.match(modalSrc, /id="homework-duration"/);
  assert.match(modalSrc, /id="homework-note"/);
});

// ---------------------------------------------------------------------------
// XSS: teacher-authored / model-drafted strings are escaped
// ---------------------------------------------------------------------------

test('renderTaskList escapes the task summary and type label (XSS: teacher text and model draft both flow through here)', () => {
  const src = extractFunctionSrc(classesSrc, 'renderTaskList');
  assert.match(src, /escapeHtml\(hwTaskSummary\(task\)\)/);
  assert.match(src, /escapeHtml\(meta\.label\)/);
});

test('hwRenderTaskEditor field helpers escape every interpolated value', () => {
  const helpers = ['hwFieldWrap', 'hwTextareaField', 'hwInputField', 'hwCheckboxField'].map((n) => extractFunctionSrc(classesSrc, n)).join('\n');
  // Every template literal that echoes a caller-supplied string does so
  // through escapeHtml(...) -- spot-check the field/value/placeholder/label
  // interpolations specifically.
  assert.match(helpers, /escapeHtml\(field\)/);
  assert.match(helpers, /escapeHtml\(value/);
  assert.match(helpers, /escapeHtml\(placeholder/);
  assert.match(helpers, /escapeHtml\(label\)/);
});

// ---------------------------------------------------------------------------
// Prefill: deep-clones stored tasks (never mutates shared classState), and
// clears the paste box / status when opening for a new target
// ---------------------------------------------------------------------------

test('hwCloneTask deep-clones rather than reusing the stored object reference', () => {
  const src = extractFunctionSrc(classesSrc, 'hwCloneTask');
  assert.match(src, /JSON\.parse\(JSON\.stringify\(task\)\)/);
});

test('assign-homework prefill deep-clones hw.tasks into hwTasksState and clears the lesson-paste box', () => {
  const region = extractRegionByBraceMatch(classesSrc, "if (action === 'assign-homework')");
  assert.match(region, /hwTasksState = Array\.isArray\(hw\?\.tasks\) \? hw\.tasks\.map\(hwCloneTask\) : \[\]/);
  assert.match(region, /homework-lesson-paste'\)/);
  assert.match(region, /renderTaskList\(\)/);
});

test('assign-class-homework (blank form) resets hwTasksState and the lesson-paste box', () => {
  const region = extractRegionByBraceMatch(classesSrc, "document.getElementById('assign-class-homework')?.addEventListener('click'");
  assert.match(region, /hwTasksState = \[\]/);
  assert.match(region, /renderTaskList\(\)/);
});
