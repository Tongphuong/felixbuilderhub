// Teacher practice-tracker column on the class dashboard (Task 3, SpeakUp
// diamond/tracker packet, 2026-07-17): a compact 🟢/🟡/🔴 line per child on
// src/pages/admin/classes.astro, built from the enrichClass fields Mark
// shipped (practice_status, minny_practice.sessions_this_week,
// r2l_weekly_completed, last_activity_at — see functions/api/admin/_classes.js
// and tests/speakup-diamond-award.test.mjs's enrichClass coverage).
//
// Honesty requirement (the whole point of this packet): SpeakUp's
// sessions_this_week is a Mon-Sun calendar week; R2L's r2l_weekly_completed
// is a rolling 7 days. The rendered line must label them differently
// ("tuần này" vs "(7 ngày)") so a teacher is never misled into thinking
// they're the same window.
//
// Same no-jsdom convention as the sibling speakup-*-ui.test.mjs files: pure
// DOM-free functions are extracted from admin/classes.astro's inline script
// and evaluated via `new Function` for real behavioral coverage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const classesPage = readFileSync('src/pages/admin/classes.astro', 'utf-8');

function extractFunctionSrc(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `function ${name} not found in admin/classes.astro`);
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

function extractConstSrc(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `const ${name} not found in admin/classes.astro`);
  const end = source.indexOf(';', start);
  assert.notEqual(end, -1, `could not find end of const ${name}`);
  return source.slice(start, end + 1);
}

function loadPureHelpers() {
  // renderPracticeTracker calls the imported escapeHtml() (../../lib/admin-
  // shared.mjs) on the humanized text -- inlined verbatim (byte-identical to
  // the real file) rather than re-imported, same reason the sibling
  // *-ui.test.mjs files inline escapeHtml's own source instead of importing
  // it. Not this packet's file to fix, but noted here for the record: the
  // real implementation's replace patterns use literal characters as their
  // replacement (e.g. /&/g -> '&'), not HTML entities, so it is a no-op on
  // any input containing none of & < > " -- true of every string
  // humanizeLastActive() can produce, so it doesn't affect this test.
  const escapeHtmlSrc = readFileSync('src/lib/admin-shared.mjs', 'utf-8').match(/export function escapeHtml\([\s\S]*?\n\}/)[0].replace('export function', 'function');
  const pieces = [
    escapeHtmlSrc,
    extractConstSrc(classesPage, 'PRACTICE_STATUS_DOT'),
    extractFunctionSrc(classesPage, 'practiceStatusDot'),
    extractFunctionSrc(classesPage, 'humanizeLastActive'),
    extractFunctionSrc(classesPage, 'renderPracticeTracker'),
  ];
  const body = `${pieces.join('\n\n')}\n\nreturn { practiceStatusDot, humanizeLastActive, renderPracticeTracker };`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const { practiceStatusDot, humanizeLastActive, renderPracticeTracker } = loadPureHelpers();

// ---------------------------------------------------------------------------
// practiceStatusDot
// ---------------------------------------------------------------------------

test('practiceStatusDot: today -> green, recent -> yellow, inactive -> red, unknown -> red (safe default)', () => {
  assert.equal(practiceStatusDot('today'), '🟢');
  assert.equal(practiceStatusDot('recent'), '🟡');
  assert.equal(practiceStatusDot('inactive'), '🔴');
  assert.equal(practiceStatusDot('bogus'), '🔴');
  assert.equal(practiceStatusDot(undefined), '🔴');
});

// ---------------------------------------------------------------------------
// humanizeLastActive — VN calendar-day buckets (UTC+7), matching
// enrichClass's own practiceStatus() day math
// ---------------------------------------------------------------------------

// All fixtures below use 04:00:00.000Z, which lands at 11:00 VN (UTC+7) --
// solidly mid-day, never near a VN calendar-day boundary -- so `diffDays`
// between two dates is exactly the plain calendar-date difference, with no
// off-by-one risk from the UTC+7 shift.

test('humanizeLastActive: same VN calendar day -> "hôm nay"', () => {
  assert.equal(
    humanizeLastActive('2026-07-17T04:00:00.000Z', '2026-07-17T04:00:00.000Z'),
    'hôm nay',
  );
});

test('humanizeLastActive: previous VN calendar day -> "hôm qua"', () => {
  assert.equal(
    humanizeLastActive('2026-07-16T04:00:00.000Z', '2026-07-17T04:00:00.000Z'),
    'hôm qua',
  );
});

test('humanizeLastActive: N days ago -> "N ngày trước"', () => {
  assert.equal(
    humanizeLastActive('2026-07-12T04:00:00.000Z', '2026-07-17T04:00:00.000Z'),
    '5 ngày trước',
  );
});

test('humanizeLastActive: never practiced (null/missing) -> "chưa luyện"', () => {
  assert.equal(humanizeLastActive(null), 'chưa luyện');
  assert.equal(humanizeLastActive(undefined), 'chưa luyện');
  assert.equal(humanizeLastActive(''), 'chưa luyện');
  assert.equal(humanizeLastActive('not-a-date'), 'chưa luyện');
});

test('humanizeLastActive: clock-skew guard — a "future" timestamp never reads as a negative day count', () => {
  assert.equal(
    humanizeLastActive('2026-07-18T02:00:00.000Z', '2026-07-17T14:00:00.000Z'),
    'hôm nay',
  );
});

// ---------------------------------------------------------------------------
// renderPracticeTracker — the honesty requirement: two DIFFERENT windows,
// labeled distinctly
// ---------------------------------------------------------------------------

test('renderPracticeTracker: renders the dot, both counts with their OWN distinct window labels, and the humanized last-active text', () => {
  const html = renderPracticeTracker({
    practice_status: 'today',
    minny_practice: { sessions_this_week: 3, last_at: '2026-07-17T10:00:00.000Z' },
    r2l_weekly_completed: 5,
    last_activity_at: '2026-07-17T10:00:00.000Z',
  });
  assert.match(html, />🟢</);
  assert.match(html, /SpeakUp: <strong>3<\/strong> tuần này/);
  assert.match(html, /R2L: <strong>5<\/strong> \(7 ngày\)/);
  assert.match(html, /hoạt động: hôm nay/);
  // The two windows must never share a label -- "tuần này" (SpeakUp,
  // Mon-Sun) and "(7 ngày)" (R2L, rolling) are the whole point.
  assert.doesNotMatch(html, /SpeakUp:.*\(7 ngày\)/);
  assert.doesNotMatch(html, /R2L:.*tuần này/);
});

test('renderPracticeTracker: missing/zero fields render honestly as 0, never crash', () => {
  const html = renderPracticeTracker({});
  assert.match(html, />🔴</, 'no practice_status -> inactive/red default');
  assert.match(html, /SpeakUp: <strong>0<\/strong> tuần này/);
  assert.match(html, /R2L: <strong>0<\/strong> \(7 ngày\)/);
  assert.match(html, /hoạt động: chưa luyện/);
});

test('renderPracticeTracker: fits without introducing horizontal scroll (flex-wrap, no fixed/overflow-hidden widths)', () => {
  const src = extractFunctionSrc(classesPage, 'renderPracticeTracker');
  assert.match(src, /flex flex-wrap/);
  assert.doesNotMatch(src, /overflow-x/);
  assert.doesNotMatch(src, /white-space:\s*nowrap/);
});

// ---------------------------------------------------------------------------
// Wiring: the tracker line is part of the student card, inside the existing grid
// ---------------------------------------------------------------------------

test('renderStudentCard calls renderPracticeTracker(student) inside the stats grid, after the attendance cell', () => {
  const src = extractFunctionSrc(classesPage, 'renderStudentCard');
  const attendanceIdx = src.indexOf('Điểm danh lớp');
  const trackerIdx = src.indexOf('${renderPracticeTracker(student)}');
  const gridCloseIdx = src.indexOf('</div>', trackerIdx);
  assert.ok(attendanceIdx > -1 && trackerIdx > -1 && gridCloseIdx > -1);
  assert.ok(attendanceIdx < trackerIdx, 'the tracker row must render after the existing coins/diamonds/rank/XP/streak/attendance cells');
});

test('the tracker row spans both grid columns (col-span-2), matching the XP row\'s full-width treatment', () => {
  const src = extractFunctionSrc(classesPage, 'renderPracticeTracker');
  assert.match(src, /class="col-span-2/);
});
