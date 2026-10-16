#!/usr/bin/env node
// Packet A3 (SPEC_R2L_MINNY_VOICE_COST): list, and optionally pre-synthesize,
// every FIXED line Minny can say for one released interview lesson. After the
// first synthesis each line is served from saved audio for every child.
//
//   node scripts/r2l-voice-warmup.mjs <package.json> [--lesson <id[@version]>]          dry run (default, free)
//   node scripts/r2l-voice-warmup.mjs <package.json> --execute --host <mod>   synthesizes ONLY uncached lines
//
// <package.json> is a publisher package ({lesson}), a release bundle with
// {package:{lesson}} / {packages:[...]}; --lesson id@version picks one from a bundle (default: the shipped studentRelease record).
// --execute costs real Workers AI neurons, so it needs an explicit operator
// host module whose default export returns {AI, READ2LEAD_CODES} (the same
// bindings the Worker uses). Not run in CI.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isStoryInterview} from '../src/lib/read2lead-story-mission.mjs';
import {STORY_PRAISE_LINES,storyWrongAnswerLine} from '../functions/lib/read2lead/story-authored-feedback.mjs';
import {STORY_VOICE_CLARIFICATION} from '../functions/lib/read2lead/story-voice.mjs';
import {createStudentSynthesizer} from '../functions/lib/read2lead/student-voice.mjs';
import {ttsCacheKey} from '../functions/api/_minny-tts.js';

export const NEURONS_PER_1K_CHARS = 2727.27; // @cf/deepgram/aura-2-en
export const USD_PER_1K_NEURONS = 0.011;

export function lessonFromFile(file, selector) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const candidates = [data, data.package, ...(Array.isArray(data.packages) ? data.packages : [])].filter(x => x?.lesson);
  // In a release bundle the shipped lesson is the studentRelease record, not the first package.
  const shipped = data.studentRelease?.records?.find(r => r.status === 'accepted');
  const want = selector || (shipped ? `${shipped.id}@${shipped.version}` : null);
  const [id, version] = want ? want.split('@') : [];
  const found = want ? candidates.find(x => x.lesson.id === id && (!version || x.lesson.version === version)) : candidates[0];
  if (!found) throw Error('lesson_not_found');
  return found.lesson;
}

/** Every fixed line, labelled. Wrong-answer lines that cannot be built safely are
 * reported as null (the live turn then keeps the existing AI path for them). */
export function collectWarmupLines(lesson) {
  if (!isStoryInterview(lesson)) throw Error('not_an_interview_lesson');
  const lines = [];
  lesson.questions.forEach((q, i) => {
    lines.push({kind: 'question', label: `Q${i + 1} prompt`, text: q.prompt_en});
    lines.push({kind: 'wrong', label: `Q${i + 1} wrong-answer line`, text: storyWrongAnswerLine(lesson, {id: q.id})});
  });
  STORY_PRAISE_LINES.forEach((text, i) => lines.push({kind: 'praise', label: `praise ${i + 1}`, text}));
  lines.push({kind: 'clarification', label: 'clarification', text: STORY_VOICE_CLARIFICATION});
  return lines;
}

export function estimate(lines) {
  const unique = [...new Set(lines.map(l => l.text).filter(Boolean))];
  const chars = unique.reduce((n, t) => n + t.length, 0);
  const neurons = chars / 1000 * NEURONS_PER_1K_CHARS;
  return {uniqueLines: unique.length, chars, neurons: Math.round(neurons), usd: +(neurons / 1000 * USD_PER_1K_NEURONS).toFixed(4)};
}

export function formatDryRun(lesson, lines) {
  const out = [`Lesson: ${lesson.title_en} (${lesson.id} v${lesson.version})`, `MODE: dry run (nothing synthesized)`, ''];
  for (const l of lines) out.push(`${l.label.padEnd(24)} ${l.text === null ? '(none: stays on AI reply path)' : `[${l.text.length} ch] ${l.text}`}`);
  const e = estimate(lines);
  out.push('', `Unique lines: ${e.uniqueLines}   characters: ${e.chars}   est. neurons: ${e.neurons}   est. cost: $${e.usd} (before the free 10k neurons/day)`);
  return out.join('\n');
}

/** Synthesizes only lines that are not already cached. Returns counts. */
export async function executeWarmup(lines, host, fetchFn = fetch) {
  const synth = createStudentSynthesizer(host, fetchFn);
  const seen = new Set(), result = {cached: 0, synthesized: 0};
  for (const {text} of lines) {
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const audio = await synth(text);
    if (audio[Symbol.for('r2l.story.synthesis.fresh')] === true) result.synthesized++; else result.cached++;
  }
  return result;
}

async function main(argv) {
  const args = argv.slice(2), flag = n => args.includes(n), value = n => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
  const file = args.find(a => !a.startsWith('--') && a !== value('--lesson') && a !== value('--host'));
  if (!file) throw Error('usage: r2l-voice-warmup.mjs <package.json> [--lesson <id[@version]>] [--execute --host <module>]');
  const lesson = lessonFromFile(path.resolve(file), flag('--lesson') ? value('--lesson') : undefined);
  const lines = collectWarmupLines(lesson);
  console.log(formatDryRun(lesson, lines));
  if (!flag('--execute')) return;
  if (!flag('--host')) throw Error('--execute requires --host <module exporting default async () => ({AI, READ2LEAD_CODES})>');
  const host = await (await import(pathToFileURL(path.resolve(value('--host'))).href)).default();
  console.log('\nEXECUTE:', JSON.stringify(await executeWarmup(lines, host)));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv).catch(e => { console.error(e.message); process.exit(1); });
