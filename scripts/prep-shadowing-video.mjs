#!/usr/bin/env node
/**
 * Offline, Lead-run tool: turn a YouTube video into a Shadowing content file
 * (src/data/shadowing/<slug>.json) — extract captions, segment them into
 * shadow-able sentences, optionally draft comprehension questions (and a
 * Vietnamese title, if none is supplied) with ONE OpenRouter call, validate
 * the result against shadowing-content.mjs's schema, and write it out.
 *
 * Usage:
 *   node scripts/prep-shadowing-video.mjs --url <youtube url> --slug <slug> --level L1..L5 [options]
 *   node scripts/prep-shadowing-video.mjs --help
 *
 * Title handling (ruled by Elon, 2026-07-17, after the flow as originally
 * specced had no source for title_vi at all):
 *   - title_en defaults to the oEmbed `title` field (already fetched for the
 *     courtesy embeddability check below); --title-en overrides.
 *   - title_vi has NO automatic default. Pass --title-vi, or let the (single,
 *     existing) OpenRouter call draft it — its scope widens by exactly one
 *     field, "title_vi", only when no --title-vi was given. NEVER a
 *     placeholder: a validator-passing dummy string is a trap the founder
 *     would never see was untranslated.
 *   - --no-llm with no --title-vi is a hard error: no LLM call means nothing
 *     can draft a title, and there is no other source.
 *   - --keep-questions preserves an existing output file's questions[] AND
 *     title_vi (founder may have hand-edited either); it is the only path
 *     that reuses a prior title_vi instead of requiring a fresh --title-vi.
 *
 * Env:
 *   OPENROUTER_API_KEY   required unless --no-llm is passed.
 *
 * Idempotent re-runs: same inputs -> same segments/schema shape every time.
 * `prepared_at` naturally reflects the run that produced the file (not
 * frozen across re-runs) — flagged in the packet report as a judgment call,
 * not a blocking ambiguity: it doesn't affect correctness, safety, or any
 * downstream consumer, unlike the title gap above.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateShadowingVideo } from '../src/lib/shadowing-content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'shadowing');

// Same model/provider choice as generateHomeworkFeedback / minny-conversation
// (Llama-3.3-70B via OpenRouter, routed to the fastest JSON-mode-capable
// provider) — kept in sync manually, not exported anywhere shared.
const PREP_MODEL = 'meta-llama/llama-3.3-70b-instruct';
const PREP_PROVIDER = { sort: 'throughput', require_parameters: true };
const PREP_TEMPERATURE = 0.4;

const LEVELS = new Set(['L1', 'L2', 'L3', 'L4', 'L5']);

const HELP = `Usage:
  node scripts/prep-shadowing-video.mjs --url <youtube url> --slug <slug> --level L1..L5 [options]

Prepares a Shadowing video content file (src/data/shadowing/<slug>.json)
from a YouTube video's captions: extracts the video id, fetches English
captions (scrapes the watch page for a manual/auto caption track; if that
fails, pass --captions), segments them into shadow-able sentences,
optionally drafts comprehension questions (and a Vietnamese title, if not
supplied) with ONE OpenRouter call, validates the result, and writes it out.

Required:
  --url <youtube url>      Any YouTube URL form (watch/youtu.be/embed/shorts), or a bare 11-char video id.
  --slug <slug>             Output id / filename: src/data/shadowing/<slug>.json
  --level <L1..L5>          Difficulty level

Options:
  --captions <file.json3>  Use this YouTube json3 caption file instead of scraping the watch page.
                            Produce one with yt-dlp, e.g.:
                              yt-dlp --write-auto-sub --sub-lang en --sub-format json3 --skip-download <url>
  --no-llm                 Skip the OpenRouter question/title drafting call. Requires --title-vi.
  --keep-questions         Preserve an existing output file's questions[] and title_vi instead of
                            redrafting them (requires the file to already exist).
  --title-en <text>        Override the default title_en (otherwise scraped from YouTube's oEmbed title).
  --title-vi <text>        Provide title_vi directly instead of drafting it via the LLM call.
  --help, -h                Show this help.

Env:
  OPENROUTER_API_KEY       Required unless --no-llm is passed.

Examples:
  OPENROUTER_API_KEY=... node scripts/prep-shadowing-video.mjs --url https://youtu.be/abc123XYZ9 --slug tiny-seed --level L2
  node scripts/prep-shadowing-video.mjs --url abc123XYZ9 --slug tiny-seed --level L2 \\
    --no-llm --title-vi "Hạt Giống Nhỏ" --captions tiny-seed.json3
`;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    url: null, slug: null, level: null, captions: null,
    noLlm: false, keepQuestions: false, titleEn: null, titleVi: null, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': args.help = true; break;
      case '--url': args.url = argv[++i] ?? null; break;
      case '--slug': args.slug = argv[++i] ?? null; break;
      case '--level': args.level = argv[++i] ?? null; break;
      case '--captions': args.captions = argv[++i] ?? null; break;
      case '--no-llm': args.noLlm = true; break;
      case '--keep-questions': args.keepQuestions = true; break;
      case '--title-en': args.titleEn = argv[++i] ?? null; break;
      case '--title-vi': args.titleVi = argv[++i] ?? null; break;
      default:
        console.error(`Unknown argument: ${a}\n`);
        console.error(HELP);
        process.exit(1);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Video id extraction
// ---------------------------------------------------------------------------

const YOUTUBE_ID_PATTERNS = [
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /[?&]v=([A-Za-z0-9_-]{11})/,
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
];

export function extractYoutubeId(url) {
  const raw = String(url || '').trim();
  for (const re of YOUTUBE_ID_PATTERNS) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw; // a bare id was passed directly
  return null;
}

// ---------------------------------------------------------------------------
// Captions: scrape (watch page -> captionTracks -> json3) or read --captions
// ---------------------------------------------------------------------------

async function fetchCaptionsFromWatchPage(videoId, fetchFn = fetch) {
  try {
    const res = await fetchFn(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; shadowing-prep/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { try { await res.text(); } catch { /* drain */ } return null; }
    const html = await res.text();
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;\s*(?:var |<\/script)/s);
    if (!match) return null;
    let playerResponse;
    try { playerResponse = JSON.parse(match[1]); } catch { return null; }
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const manual = tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr');
    const auto = tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr');
    const track = manual || auto;
    if (!track?.baseUrl) return null;
    const capRes = await fetchFn(`${track.baseUrl}&fmt=json3`, { signal: AbortSignal.timeout(10000) });
    if (!capRes.ok) { try { await capRes.text(); } catch { /* drain */ } return null; }
    const json3 = await capRes.json();
    return { json3, captionKind: track.kind === 'asr' ? 'auto' : 'manual' };
  } catch {
    return null;
  }
}

function readCaptionsFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const json3 = JSON.parse(raw);
  // We can't reliably tell manual vs auto from a bare json3 file (that
  // distinction lives in how the operator produced it with yt-dlp), so this
  // defaults to 'manual' — a documented, low-risk assumption (metadata
  // only, doesn't affect segmentation/scoring), not a behavior invention.
  return { json3, captionKind: 'manual' };
}

export function cuesFromJson3(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const cues = [];
  for (const ev of events) {
    if (!Array.isArray(ev.segs) || typeof ev.tStartMs !== 'number') continue;
    const text = ev.segs.map((s) => s?.utf8 || '').join('').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = ev.tStartMs / 1000;
    const durationMs = typeof ev.dDurationMs === 'number' ? ev.dDurationMs : 0;
    const end = Math.max(start + durationMs / 1000, start);
    cues.push({ text, start, end });
  }
  return cues;
}

// ---------------------------------------------------------------------------
// Segmentation: accumulate cues into sentences until sentence-final
// punctuation, a >1.2s gap, or 12 words; merge <1s fragments into a
// neighbor; pad end +0.25s and clamp so segments never overlap; mark
// shadow:false for music/non-speech markers or >12-word segments.
// ---------------------------------------------------------------------------

const SENTENCE_END_RE = /[.?!]["')\]]?$/;
const NON_SPEECH_MARKER_RE = /^[[(][^\])]*[\])]$/;
const GAP_BREAK_SECONDS = 1.2;
const MAX_WORDS_PER_SEGMENT = 12;
const MIN_SEGMENT_SECONDS = 1;
const END_PAD_SECONDS = 0.25;

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function segmentCuesIntoSentences(cues) {
  const segments = [];
  let buffer = [];

  function flush() {
    if (!buffer.length) return;
    const text = buffer.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
    segments.push({ text, start: buffer[0].start, end: buffer[buffer.length - 1].end });
    buffer = [];
  }

  for (const cue of cues) {
    const prev = buffer.length ? buffer[buffer.length - 1] : null;
    if (prev && (cue.start - prev.end) > GAP_BREAK_SECONDS) flush();
    buffer.push(cue);
    const bufferedWordCount = wordCount(buffer.map((c) => c.text).join(' '));
    if (SENTENCE_END_RE.test(cue.text.trim()) || bufferedWordCount >= MAX_WORDS_PER_SEGMENT) flush();
  }
  flush();
  return segments;
}

function isMarkerText(text) {
  return NON_SPEECH_MARKER_RE.test(text.trim());
}

// A non-speech marker cue (e.g. a lone "[Music]" caption) is never merged
// into a neighbor, and never absorbs one: merging it would splice "[Music]"
// into the middle of a kid-facing sentence (still <1s, so it'd fire the
// merge rule) while also making the marker regex below stop matching (it
// only matches when the WHOLE segment text is the marker) -- silently
// flipping a music cue to shadow:true glued onto real speech. Caught in dev
// verification against the inline fixture before this shipped.
export function mergeShortFragments(segments) {
  const merged = [];
  for (const seg of segments) {
    const duration = seg.end - seg.start;
    const prev = merged[merged.length - 1];
    const canMergeBack = duration < MIN_SEGMENT_SECONDS && prev && !isMarkerText(seg.text) && !isMarkerText(prev.text);
    if (canMergeBack) {
      prev.text = `${prev.text} ${seg.text}`.replace(/\s+/g, ' ').trim();
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  if (merged.length > 1 && (merged[0].end - merged[0].start) < MIN_SEGMENT_SECONDS
    && !isMarkerText(merged[0].text) && !isMarkerText(merged[1].text)) {
    const first = merged.shift();
    merged[0] = { text: `${first.text} ${merged[0].text}`.replace(/\s+/g, ' ').trim(), start: first.start, end: merged[0].end };
  }
  return merged;
}

export function padAndClamp(segments) {
  const padded = segments.map((seg) => ({ ...seg, end: seg.end + END_PAD_SECONDS }));
  for (let i = 0; i < padded.length - 1; i += 1) {
    if (padded[i].end > padded[i + 1].start) padded[i].end = padded[i + 1].start;
  }
  return padded;
}

export function markShadowFlag(segments) {
  return segments.map((seg) => {
    const isMarker = NON_SPEECH_MARKER_RE.test(seg.text.trim());
    const shadow = !isMarker && wordCount(seg.text) <= MAX_WORDS_PER_SEGMENT;
    return { ...seg, shadow };
  });
}

function toSegmentRecords(segments) {
  return segments.map((seg, i) => ({
    i,
    start: Math.round(seg.start * 100) / 100,
    end: Math.round(seg.end * 100) / 100,
    text_en: seg.text,
    shadow: seg.shadow,
  }));
}

export function buildSegments(cues) {
  return toSegmentRecords(markShadowFlag(padAndClamp(mergeShortFragments(segmentCuesIntoSentences(cues)))));
}

// ---------------------------------------------------------------------------
// oEmbed: default title_en source + courtesy embeddability check (print-only)
// ---------------------------------------------------------------------------

async function fetchOembed(videoId, fetchFn = fetch) {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetchFn(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { try { await res.text(); } catch { /* drain */ } return null; }
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM drafting: ONE OpenRouter JSON-mode call for questions[] (+ title_vi
// when needed) — pattern-copied from functions/api/_homework-feedback.js's
// generateHomeworkFeedback (timeout, drain-on-non-OK, never throws, no retry).
// ---------------------------------------------------------------------------

const FENCE_PATTERN = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

function buildPrepSystemPrompt(needsTitle) {
  const titleKey = needsTitle ? '"title_vi": "...", ' : '';
  const titleInstruction = needsTitle
    ? `\n- "title_vi": a short, kid-friendly Vietnamese title for this video, at most 40 characters. Simple and inviting for a child — not a literal translation of the English title.`
    : '';
  return `You are drafting comprehension-check content for a children's English-shadowing video (ages 6-12). You will receive the video's segments as JSON: an ordered array of { index, text_en, start, end }.

Draft simple comprehension questions the child can answer from what they just watched and heard — NEVER about anything not seen or heard in the segments. Roughly one question per 4-6 segments, placed at natural story beats (after a segment where something notable happens), not evenly spaced by a fixed formula.

Respond with strict JSON only, no other text, no markdown:
{${titleKey}"questions": [{"after_segment": <segment index>, "type": "yes_no" | "choice", "question_en": "...", "question_vi": "...", "answer": true|false, "options_en": ["...", "..."], "options_vi": ["...", "..."], "correct_index": <int>}]}

For "yes_no" questions include only "answer" (boolean), never options. For "choice" questions include "options_en"/"options_vi" (2-4 short options each, same length, in the same order) and "correct_index" (0-based), never "answer".

Rules:
- question_vi: simple, warm Vietnamese a young child reads easily.
- question_en: simple, short English.
- Every question must be answerable purely from what was seen or heard in the given segments — never invent plot, characters, or facts not present in the text.
- after_segment must be one of the given segment indexes.${titleInstruction}`;
}

function parsePrepResponse(raw, needsTitle) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  const fenced = text.match(FENCE_PATTERN);
  if (fenced) text = fenced[1].trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (!Array.isArray(parsed.questions)) return null;
  if (needsTitle && typeof parsed.title_vi !== 'string') return null;
  return {
    questions: parsed.questions,
    title_vi: needsTitle ? parsed.title_vi.trim() : null,
  };
}

async function draftPrepContent({ segments, needsTitle, apiKey, fetchFn = fetch }) {
  try {
    if (!apiKey) return null;
    const messages = [
      { role: 'system', content: buildPrepSystemPrompt(needsTitle) },
      {
        role: 'user',
        content: JSON.stringify({
          segments: segments.map((s) => ({ index: s.i, text_en: s.text_en, start: s.start, end: s.end })),
        }),
      },
    ];
    const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PREP_MODEL,
        provider: PREP_PROVIDER,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 900,
        temperature: PREP_TEMPERATURE,
      }),
      // Same reasoning as generateHomeworkFeedback's 4s call, extended for a
      // longer completion (many questions vs one feedback note): treat a
      // miss as a miss, no retry — an operator re-runs by hand.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      try { await res.text(); } catch { /* drain, see _homework-feedback.js's connection-leak note */ }
      return null;
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    return parsePrepResponse(raw, needsTitle);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv, { fetchFn = fetch } = {}) {
  const args = parseArgs(argv);
  if (args.help || (!args.url && !args.slug && !args.level && argv.length === 0)) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }
  if (!args.url || !args.slug || !args.level) {
    console.error('Missing required argument(s). --url, --slug, and --level are all required.\n');
    console.error(HELP);
    process.exit(1);
  }
  if (!LEVELS.has(args.level)) {
    console.error(`--level must be one of L1..L5, got "${args.level}"`);
    process.exit(1);
  }

  const videoId = extractYoutubeId(args.url);
  if (!videoId) {
    console.error(`Could not extract a YouTube video id from "${args.url}".`);
    process.exit(1);
  }

  const outPath = path.join(OUT_DIR, `${args.slug}.json`);

  // Resolve title_vi / kept questions from an existing file first — before
  // any network calls — so the --no-llm-without-title-vi check below can
  // fail fast.
  let titleVi = args.titleVi;
  let keptQuestions = null;
  if (args.keepQuestions) {
    if (!fs.existsSync(outPath)) {
      console.error(`--keep-questions was passed but ${outPath} does not exist yet — nothing to keep.`);
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    keptQuestions = Array.isArray(existing.questions) ? existing.questions : [];
    if (!titleVi && typeof existing.title_vi === 'string' && existing.title_vi.trim()) {
      titleVi = existing.title_vi;
    }
  }

  if (args.noLlm && !titleVi) {
    console.error('--no-llm requires --title-vi (no LLM call means no title_vi can be drafted, and there is no other source).');
    console.error('Pass --title-vi "<short Vietnamese title>".');
    process.exit(1);
  }

  // --- captions ---------------------------------------------------------
  let captionsResult;
  if (args.captions) {
    try {
      captionsResult = readCaptionsFile(args.captions);
    } catch (err) {
      console.error(`Could not read/parse --captions file "${args.captions}": ${err.message}`);
      process.exit(1);
    }
  } else {
    captionsResult = await fetchCaptionsFromWatchPage(videoId, fetchFn);
  }
  if (!captionsResult) {
    console.error(`No captions found for video "${videoId}" (scrape failed or no English caption track). Pick another video, or produce a caption file with yt-dlp and pass --captions:`);
    console.error('  yt-dlp --write-auto-sub --write-sub --sub-lang en --sub-format json3 --skip-download <url>');
    process.exit(1);
  }
  const cues = cuesFromJson3(captionsResult.json3);
  if (!cues.length) {
    console.error(`Captions for "${videoId}" parsed but contained no usable text. Pick another video.`);
    process.exit(1);
  }

  const segments = buildSegments(cues);
  const durationS = segments.length ? segments[segments.length - 1].end : 0;

  // --- title_en default + courtesy embeddability check -------------------
  const oembed = await fetchOembed(videoId, fetchFn);
  const titleEn = args.titleEn || (oembed?.title ? String(oembed.title).trim() : null);
  console.log(oembed
    ? `Embeddability check: OK — oEmbed responded (title: "${oembed.title}", author: "${oembed.author_name || 'unknown'}")`
    : 'Embeddability check: FAILED — oEmbed did not respond (video may not be embeddable, private, or removed). This is print-only; it does not block the run.');

  // --- questions (+ title_vi) drafting ------------------------------------
  let questions = keptQuestions || [];
  let draftedTitleVi = null;
  if (!args.keepQuestions && !args.noLlm) {
    const needsTitle = !titleVi;
    const drafted = await draftPrepContent({
      segments, needsTitle, apiKey: process.env.OPENROUTER_API_KEY, fetchFn,
    });
    if (!drafted) {
      console.warn('LLM drafting call failed or returned nothing usable — proceeding with zero drafted questions.');
    } else {
      if (needsTitle && drafted.title_vi) {
        titleVi = drafted.title_vi;
        draftedTitleVi = drafted.title_vi;
      }
      const baseShell = {
        schema_version: 1,
        id: args.slug,
        youtube_id: videoId,
        title_vi: titleVi || 'placeholder-for-validation-only',
        title_en: titleEn || 'placeholder-for-validation-only',
        level: args.level,
        duration_s: durationS || 1,
        prepared_at: new Date().toISOString(),
        source: { caption_kind: captionsResult.captionKind },
        segments,
      };
      const accepted = [];
      drafted.questions.forEach((q, index) => {
        const candidateQuestion = { id: `q${index + 1}`, ...q };
        const { ok, errors } = validateShadowingVideo({ ...baseShell, questions: [candidateQuestion] });
        if (ok) {
          accepted.push(candidateQuestion);
        } else {
          console.warn(`Dropping drafted question #${index + 1} (after_segment=${q?.after_segment}): ${errors.join('; ')}`);
        }
      });
      questions = accepted;
    }
  }

  if (!titleVi) {
    console.error('No title_vi available after drafting (LLM call failed or was skipped). Re-run with --title-vi "<short Vietnamese title>".');
    process.exit(1);
  }

  // --- final assembly + validation ----------------------------------------
  const candidate = {
    schema_version: 1,
    id: args.slug,
    youtube_id: videoId,
    title_vi: titleVi,
    title_en: titleEn || '',
    level: args.level,
    duration_s: durationS,
    prepared_at: new Date().toISOString(),
    source: { caption_kind: captionsResult.captionKind },
    segments,
    questions,
  };

  const { ok, errors, video } = validateShadowingVideo(candidate);
  if (!ok) {
    console.error('Validation failed — nothing was written:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(video, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${path.relative(ROOT, outPath)}`);
  console.log(`\n${segments.length} segments:`);
  console.table(segments.map((s) => ({
    i: s.i, start: s.start.toFixed(2), end: s.end.toFixed(2), shadow: s.shadow,
    text_en: s.text_en.length > 60 ? `${s.text_en.slice(0, 57)}...` : s.text_en,
  })));
  if (draftedTitleVi) {
    console.log(`\ntitle_vi (DRAFTED — founder review): "${draftedTitleVi}"`);
  }
  console.log(`\n${questions.length} questions:`);
  if (questions.length) {
    console.table(questions.map((q) => ({
      id: q.id, after_segment: q.after_segment, type: q.type,
      question_en: q.question_en, question_vi: q.question_vi,
      answer: q.type === 'yes_no' ? q.answer : `${q.options_en?.[q.correct_index]} (#${q.correct_index})`,
    })));
  } else {
    console.log('  (none)');
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}

export { main };
