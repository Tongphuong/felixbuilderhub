import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  extractYoutubeId,
  cuesFromJson3,
  segmentCuesIntoSentences,
  mergeShortFragments,
  padAndClamp,
  markShadowFlag,
  buildSegments,
} from '../scripts/prep-shadowing-video.mjs';

// Four non-speech marker fixtures -- both bracket and paren forms, mixed
// casing/content -- regression coverage for the bug found and fixed during
// packet 1 dev verification: a short marker cue getting merged into
// neighboring sentence text (and so silently inheriting shadow:true)
// because the marker regex only matches when a segment's WHOLE text is the
// marker, and merging happened before that check ran.
const MARKER_FIXTURES = ['[Music]', '[Applause]', '(Laughter)', '[inaudible]'];

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs: parses every flag', () => {
  const args = parseArgs([
    '--url', 'https://youtu.be/abc12345678',
    '--slug', 'my-slug',
    '--level', 'L2',
    '--captions', 'f.json3',
    '--no-llm',
    '--keep-questions',
    '--title-en', 'Title',
    '--title-vi', 'Tieu de',
  ]);
  assert.equal(args.url, 'https://youtu.be/abc12345678');
  assert.equal(args.slug, 'my-slug');
  assert.equal(args.level, 'L2');
  assert.equal(args.captions, 'f.json3');
  assert.equal(args.noLlm, true);
  assert.equal(args.keepQuestions, true);
  assert.equal(args.titleEn, 'Title');
  assert.equal(args.titleVi, 'Tieu de');
  assert.equal(args.help, false);
});

test('parseArgs: --help / -h sets help true', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: sensible defaults when flags are omitted', () => {
  const args = parseArgs([]);
  assert.equal(args.url, null);
  assert.equal(args.slug, null);
  assert.equal(args.level, null);
  assert.equal(args.captions, null);
  assert.equal(args.noLlm, false);
  assert.equal(args.keepQuestions, false);
  assert.equal(args.titleEn, null);
  assert.equal(args.titleVi, null);
});

// ---------------------------------------------------------------------------
// extractYoutubeId
// ---------------------------------------------------------------------------

test('extractYoutubeId: handles every supported URL form plus a bare id', () => {
  assert.equal(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('extractYoutubeId: null for unrecognizable input', () => {
  assert.equal(extractYoutubeId('not a url'), null);
  assert.equal(extractYoutubeId(''), null);
  assert.equal(extractYoutubeId(undefined), null);
});

// ---------------------------------------------------------------------------
// cuesFromJson3
// ---------------------------------------------------------------------------

test('cuesFromJson3: parses events into {text,start,end}, skipping empty/malformed ones', () => {
  const data = {
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello' }] },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: '   ' }] }, // whitespace-only -> skipped
      { tStartMs: 1500 }, // no segs -> skipped
      { tStartMs: 2000, dDurationMs: 800, segs: [{ utf8: 'world' }, { utf8: '!' }] },
    ],
  };
  assert.deepEqual(cuesFromJson3(data), [
    { text: 'Hello', start: 0, end: 1 },
    { text: 'world!', start: 2, end: 2.8 },
  ]);
});

test('cuesFromJson3: tolerates a missing/malformed events array', () => {
  assert.deepEqual(cuesFromJson3({}), []);
  assert.deepEqual(cuesFromJson3(null), []);
  assert.deepEqual(cuesFromJson3({ events: 'not-an-array' }), []);
});

// ---------------------------------------------------------------------------
// segmentCuesIntoSentences
// ---------------------------------------------------------------------------

test('segmentCuesIntoSentences: breaks on sentence-final punctuation', () => {
  const cues = [
    { text: 'Hello there.', start: 0, end: 1 },
    { text: 'How are you?', start: 1, end: 2 },
  ];
  assert.deepEqual(segmentCuesIntoSentences(cues), [
    { text: 'Hello there.', start: 0, end: 1 },
    { text: 'How are you?', start: 1, end: 2 },
  ]);
});

test('segmentCuesIntoSentences: breaks on a gap > 1.2s even mid-sentence', () => {
  const cues = [
    { text: 'Hello', start: 0, end: 1 },
    { text: 'there', start: 2.5, end: 3 }, // gap of 1.5s > 1.2s
  ];
  const segs = segmentCuesIntoSentences(cues);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, 'Hello');
  assert.equal(segs[1].text, 'there');
});

test('segmentCuesIntoSentences: breaks at 12 words even without punctuation or a gap', () => {
  const cues = Array.from({ length: 14 }, (_, i) => ({ text: `w${i}`, start: i, end: i + 0.5 }));
  const segs = segmentCuesIntoSentences(cues);
  assert.equal(segs[0].text.split(' ').length, 12);
  assert.equal(segs[1].text.split(' ').length, 2);
});

// ---------------------------------------------------------------------------
// mergeShortFragments -- including the four marker fixtures
// ---------------------------------------------------------------------------

test('mergeShortFragments: merges a genuine short speech fragment into its neighbor', () => {
  const segs = [
    { text: 'Once upon a time', start: 0, end: 3 },
    { text: 'the end', start: 3, end: 3.5 }, // 0.5s -- a real short speech fragment
  ];
  const merged = mergeShortFragments(segs);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'Once upon a time the end');
});

for (const marker of MARKER_FIXTURES) {
  test(`mergeShortFragments: never merges the marker "${marker}" into a neighbor, even when short`, () => {
    const segs = [
      { text: 'Once upon a time there was a tiny seed.', start: 0, end: 3.6 },
      { text: marker, start: 3.6, end: 4 }, // 0.4s -- would normally trigger a merge
      { text: 'It grew every day.', start: 5, end: 7 },
    ];
    const merged = mergeShortFragments(segs);
    assert.equal(merged.length, 3, `"${marker}" must survive as its own segment`);
    assert.equal(merged[0].text, 'Once upon a time there was a tiny seed.', 'marker text must not get glued onto the previous sentence');
    assert.equal(merged[1].text, marker);
    assert.equal(merged[2].text, 'It grew every day.', 'marker text must not get glued onto the next sentence either');
  });
}

test('mergeShortFragments: a marker never absorbs a following short speech fragment either', () => {
  const segs = [
    { text: '[Music]', start: 0, end: 0.4 },
    { text: 'hi', start: 0.4, end: 0.8 },
  ];
  const merged = mergeShortFragments(segs);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, '[Music]');
  assert.equal(merged[1].text, 'hi');
});

// ---------------------------------------------------------------------------
// padAndClamp
// ---------------------------------------------------------------------------

test('padAndClamp: pads each end by 0.25s and clamps when padding would overlap the next segment', () => {
  const segs = [
    { text: 'a', start: 0, end: 3 },
    { text: 'b', start: 3.1, end: 6 },
  ];
  const padded = padAndClamp(segs);
  assert.equal(padded[0].end, 3.1); // 3+0.25=3.25 > next start 3.1 -> clamped
  assert.equal(padded[1].end, 6.25); // last segment, no clamp needed
});

test('padAndClamp: no clamp needed when there is enough gap', () => {
  const segs = [
    { text: 'a', start: 0, end: 3 },
    { text: 'b', start: 5, end: 8 },
  ];
  const padded = padAndClamp(segs);
  assert.equal(padded[0].end, 3.25);
  assert.equal(padded[1].end, 8.25);
});

// ---------------------------------------------------------------------------
// markShadowFlag
// ---------------------------------------------------------------------------

for (const marker of MARKER_FIXTURES) {
  test(`markShadowFlag: marks the marker "${marker}" shadow:false`, () => {
    const [result] = markShadowFlag([{ text: marker, start: 0, end: 1 }]);
    assert.equal(result.shadow, false);
  });
}

test('markShadowFlag: marks a >12-word segment shadow:false even without a marker', () => {
  const longText = Array.from({ length: 13 }, (_, i) => `word${i}`).join(' ');
  const [result] = markShadowFlag([{ text: longText, start: 0, end: 5 }]);
  assert.equal(result.shadow, false);
});

test('markShadowFlag: marks a normal <=12-word sentence shadow:true', () => {
  const [result] = markShadowFlag([{ text: 'Hello there, how are you today?', start: 0, end: 3 }]);
  assert.equal(result.shadow, true);
});

// ---------------------------------------------------------------------------
// buildSegments -- end-to-end pipeline (the exact scenario from packet 1's
// dev verification, now a permanent regression test)
// ---------------------------------------------------------------------------

test('buildSegments: end-to-end -- a [Music] marker between two sentences stays its own shadow:false segment, sentence text stays clean', () => {
  const cues = cuesFromJson3({
    events: [
      { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'Once upon a time,' }] },
      { tStartMs: 1600, dDurationMs: 1800, segs: [{ utf8: ' there was a tiny seed.' }] },
      { tStartMs: 3600, dDurationMs: 400, segs: [{ utf8: ' [Music]' }] },
      { tStartMs: 5200, dDurationMs: 2000, segs: [{ utf8: 'It grew and grew every single day' }] },
      { tStartMs: 7300, dDurationMs: 1500, segs: [{ utf8: ' until it became a great big tree.' }] },
    ],
  });
  const segments = buildSegments(cues);

  const musicSeg = segments.find((s) => s.text_en.trim() === '[Music]');
  assert.ok(musicSeg, 'the [Music] cue must survive as its own segment');
  assert.equal(musicSeg.shadow, false);

  const seedSeg = segments.find((s) => s.text_en.includes('tiny seed'));
  assert.equal(seedSeg.text_en, 'Once upon a time, there was a tiny seed.', 'must not have [Music] glued onto it');

  // The two cues carrying "It grew..." / "...great big tree." are only 0.1s
  // apart (no >1.2s gap break) and the sentence-final period only arrives at
  // the very end, so they land in ONE 14-word segment (segmentation splits
  // on whole CUE boundaries, not mid-cue) -- correctly caught by the
  // separate ">12 words" shadow:false rule rather than the marker rule.
  const longSeg = segments.find((s) => s.text_en.includes('great big tree'));
  assert.equal(longSeg.text_en, 'It grew and grew every single day until it became a great big tree.');
  assert.equal(longSeg.shadow, false);

  segments.forEach((s, i) => assert.equal(s.i, i, 'segment indexes are sequential'));
});
