#!/usr/bin/env node
// R2L-MINNY-TUNE T2 (SPEC_R2L_MINNY_VOICE_COST, Addendum 2026-10-17, part C):
// run IDENTICAL grading inputs through gpt-oss-120b and gpt-oss-20b and report every disagreement.
// 20b may replace 120b ONLY on zero disagreements in intent, reliability and each criterion's
// met / quote validity.
//
//   node scripts/r2l-assessor-compare.mjs [package.json] [--cases <file>] [--lesson id@version]
//        dry run (default, free, no network): prints the case list and the number of model calls
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
//   node scripts/r2l-assessor-compare.mjs --execute [--max-calls 140] [--out-dir <dir>]
//        real Workers AI calls (costs neurons); needs both env vars and stops at --max-calls.
//
// Tasks are built by the REAL live-path functions (activeStoryVoiceTask / storyRubric /
// pictureRetellFor); prompts, params and validation are the real createStoryEvidenceAssessor, only
// the model id differs. Credentials come from the environment and are never printed or stored.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {lessonFromFile} from './r2l-voice-warmup.mjs';
import {activeStoryVoiceTask} from '../functions/lib/read2lead/story-rubric.mjs';
import {createStoryEvidenceAssessor,STORY_ASSESSOR_MODELS} from '../functions/lib/read2lead/story-assessor.mjs';

export const DEFAULT_PACKAGE = path.join(os.homedir(), 'work/r2l-releases/v102b-20261016/assets/__private/package.json');
export const DEFAULT_CASES = new URL('./r2l-assessor-cases.sky.json', import.meta.url).pathname;
export const DEFAULT_MAX_CALLS = 140;
export const MODEL_A = STORY_ASSESSOR_MODELS['gpt-oss-120b'];
export const MODEL_B = STORY_ASSESSOR_MODELS['gpt-oss-20b'];
const MAX_CONSECUTIVE_PROVIDER_ERRORS = 3;

/** The task exactly as the live path hands it to the assessor (activeStoryVoiceTask). */
export function taskFor(lesson, ref) {
  if (ref === 'retell') return activeStoryVoiceTask(lesson, {stage: 'picture_retell', missionResult: {assessment: {status: 'complete'}}, voiceAwaitingContinue: false});
  const m = /^q(\d+)$/.exec(ref || '');
  const index = m ? Number(m[1]) - 1 : -1;
  if (!m || index < 0 || index >= lesson.questions.length) throw Error('unknown_case_task:' + ref);
  return activeStoryVoiceTask(lesson, {stage: 'understand', questionIndex: index, voiceAwaitingContinue: false});
}

export function buildCases(lesson, casesDoc) {
  if (casesDoc?.format !== 'r2l-assessor-cases-v1' || !Array.isArray(casesDoc.cases) || !casesDoc.cases.length) throw Error('invalid_cases_file');
  if (casesDoc.lesson && (casesDoc.lesson.id !== lesson.id || casesDoc.lesson.version !== lesson.version)) throw Error('cases_lesson_mismatch');
  const seen = new Set();
  return casesDoc.cases.map(c => {
    if (!c.id || seen.has(c.id)) throw Error('duplicate_or_missing_case_id');
    seen.add(c.id);
    if (typeof c.transcript !== 'string' || !c.transcript.trim() || c.transcript.length > 2000) throw Error('invalid_case_transcript:' + c.id);
    return {...c, taskDef: taskFor(lesson, c.task)};
  });
}

export function formatDryRun(cases, models = [MODEL_A, MODEL_B]) {
  const out = ['MODE: dry run (no network, no cost)', `Models: ${models.join('  vs  ')}`, ''];
  for (const c of cases) out.push(`${c.id.padEnd(18)} ${c.task.padEnd(7)} ${String(c.type || '').padEnd(10)} ${JSON.stringify(c.transcript)}`);
  out.push('', `Cases: ${cases.length}   model calls: ${cases.length * models.length}   (default cap ${DEFAULT_MAX_CALLS})`);
  return out.join('\n');
}

/** Wrap an ai binding so the raw provider usage of each call can be collected. */
function meteredAi(ai, sink) {
  return {async run(model, input) {
    const raw = await ai.run(model, input);
    sink.last = raw?.usage ?? null;
    return raw;
  }};
}

/** One grading call through the REAL assessor for one model. Never throws for a model's own bad output. */
export async function gradeOnce({ai, model, taskDef, transcript}) {
  const sink = {last: null};
  const assess = createStoryEvidenceAssessor({ai: meteredAi(ai, sink), model});
  try {
    const j = await assess({task: taskDef, transcript});
    return {valid: true, intent: j.intent, reliability: j.reliability,
      criteria: Object.fromEntries(j.criteria.map(c => [c.id, c.met === true])), quotes: Object.fromEntries(j.criteria.map(c => [c.id, c.quote])),
      usage: sink.last};
  } catch (e) {
    return {valid: false, error: String(e.message || e).slice(0, 160), providerError: /^trial_provider_|^compare_provider_/.test(e.message), usage: sink.last};
  }
}

/** Why two models' results differ. Empty list = full agreement. Validity counts. */
export function disagreements(a, b) {
  const d = [];
  if (a.valid !== b.valid) d.push(`validity: ${a.valid ? 'pass' : 'fail'} vs ${b.valid ? 'pass' : 'fail'}`);
  if (!a.valid || !b.valid) return d;
  if (a.intent !== b.intent) d.push(`intent: ${a.intent} vs ${b.intent}`);
  if (a.reliability !== b.reliability) d.push(`reliability: ${a.reliability} vs ${b.reliability}`);
  for (const id of new Set([...Object.keys(a.criteria), ...Object.keys(b.criteria)]))
    if (a.criteria[id] !== b.criteria[id]) d.push(`criterion ${id}: met ${a.criteria[id]} vs ${b.criteria[id]}`);
  return d;
}

export async function runComparison({cases, ai, models = [MODEL_A, MODEL_B], maxCalls = DEFAULT_MAX_CALLS}) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1) throw Error('max_calls_invalid');
  if (cases.length * models.length > maxCalls) throw Error(`max_calls_exceeded: needs ${cases.length * models.length}, cap ${maxCalls}`);
  const results = [], tokens = Object.fromEntries(models.map(m => [m, {prompt: 0, completion: 0, total: 0, calls: 0}]));
  let calls = 0, streak = 0, aborted = null;
  outer: for (const c of cases) {
    const row = {id: c.id, task: c.task, type: c.type, transcript: c.transcript, expectIntent: c.expectIntent, expectAllMet: c.expectAllMet, models: {}};
    for (const model of models) {
      calls++;
      const r = await gradeOnce({ai, model, taskDef: c.taskDef, transcript: c.transcript});
      row.models[model] = r;
      const u = r.usage;
      if (u) { const t = tokens[model]; t.calls++; t.prompt += u.prompt_tokens || 0; t.completion += u.completion_tokens || 0; t.total += u.total_tokens || 0; }
      streak = r.providerError ? streak + 1 : 0;
      if (streak >= MAX_CONSECUTIVE_PROVIDER_ERRORS) { aborted = `stopped after ${streak} consecutive provider errors (last: ${r.error})`; results.push(row); break outer; }
    }
    row.disagreements = disagreements(row.models[models[0]], row.models[models[1]]);
    results.push(row);
  }
  const compared = results.filter(r => r.disagreements);
  return {models, calls, aborted, cases: results, tokens,
    disagreementCount: compared.filter(r => r.disagreements.length).length,
    allAgree: !aborted && compared.length === cases.length && compared.every(r => !r.disagreements.length),
    invalid: Object.fromEntries(models.map(m => [m, results.filter(r => r.models[m] && !r.models[m].valid).length]))};
}

export function formatMarkdown(report) {
  const [A, B] = report.models, short = m => m.split('/').pop();
  const cell = r => !r ? '-' : !r.valid ? `INVALID (${r.error})` :
    `${r.intent}/${r.reliability}/` + Object.entries(r.criteria).map(([id, v]) => `${id}${v ? '+' : '-'}`).join(' ');
  const out = [`# Assessor comparison: ${short(A)} vs ${short(B)}`, '',
    `Verdict: **${report.allAgree ? 'ZERO disagreements: 20b is eligible' : report.aborted ? 'INCOMPLETE: ' + report.aborted : `${report.disagreementCount} case(s) disagree: keep 120b`}**`,
    `Calls: ${report.calls}. Invalid (validator fail): ${A} ${report.invalid[A]}, ${B} ${report.invalid[B]}.`, '',
    `Provider usage (tokens; neurons are not returned by the API, read them from Cloudflare analytics): ` +
      report.models.map(m => `${short(m)} prompt ${report.tokens[m].prompt} / completion ${report.tokens[m].completion} / total ${report.tokens[m].total}`).join('; '), '',
    `| case | intent | ${short(A)} | ${short(B)} | agree |`, '|---|---|---|---|---|'];
  for (const r of report.cases)
    out.push(`| ${r.id} | ${r.expectIntent || ''} | ${cell(r.models[A])} | ${cell(r.models[B])} | ${r.disagreements ? (r.disagreements.length ? 'NO: ' + r.disagreements.join('; ') : 'yes') : '-'} |`);
  const bad = report.cases.filter(r => r.disagreements?.length);
  out.push('', '## Disagreements', bad.length ? '' : 'None.');
  for (const r of bad) out.push(`- **${r.id}** ${JSON.stringify(r.transcript)}: ${r.disagreements.join('; ')}`);
  return out.join('\n') + '\n';
}

/** Minimal Workers AI REST binding. The shared createStoryCloudflareBinding only allows its own three
 * trial models and 1-3 calls each, so it cannot run gpt-oss; this keeps the same URL, auth and
 * error-redaction rules for the two grader models only. Credentials are never printed. */
export function createCompareBinding({accountId, token, fetchFn = fetch, timeoutMs = 60000}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || '') || typeof token !== 'string' || token.length < 20 || /[\r\n]/.test(token)) throw Error('compare_credentials_required');
  return {async run(model, input) {
    if (!Object.values(STORY_ASSESSOR_MODELS).includes(model)) throw Error('compare_model_refused');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(input)});
      if (!response.ok) throw Error('compare_provider_http_' + response.status);
      let data; try { data = await response.json(); } catch { throw Error('compare_provider_invalid_json'); }
      if (data?.success !== true || !data.result || typeof data.result !== 'object') throw Error('compare_provider_result_refused');
      return data.result;
    } catch (e) {
      if (/^compare_/.test(e.message)) throw e;
      throw Error(controller.signal.aborted ? 'compare_provider_timeout' : 'compare_provider_unavailable');
    } finally { clearTimeout(timer); }
  }};
}

async function main(argv, env = process.env) {
  const args = argv.slice(2), flag = n => args.includes(n), value = n => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
  const valued = new Set(['--cases', '--lesson', '--max-calls', '--out-dir']);
  const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1])) || DEFAULT_PACKAGE;
  const lesson = lessonFromFile(path.resolve(file), value('--lesson'));
  const cases = buildCases(lesson, JSON.parse(fs.readFileSync(path.resolve(value('--cases') || DEFAULT_CASES), 'utf8')));
  console.log(`Lesson: ${lesson.title_en} (${lesson.id} v${lesson.version})`);
  if (!flag('--execute')) { console.log(formatDryRun(cases)); return; }
  const maxCalls = value('--max-calls') === undefined ? DEFAULT_MAX_CALLS : Number(value('--max-calls'));
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw Error('--execute requires env CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  if (value('--max-calls') === undefined) console.log(`(using default --max-calls ${DEFAULT_MAX_CALLS})`);
  const ai = createCompareBinding({accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN});
  const report = await runComparison({cases, ai, maxCalls});
  const dir = path.resolve(value('--out-dir') || '.'), stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(dir, {recursive: true});
  const base = path.join(dir, `assessor-compare-${stamp}`);
  fs.writeFileSync(base + '.json', JSON.stringify(report, null, 1) + '\n');
  fs.writeFileSync(base + '.md', formatMarkdown(report));
  console.log(formatMarkdown(report).split('\n').slice(0, 6).join('\n'));
  console.log(`\nWrote ${base}.json and ${base}.md`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv).catch(e => { console.error(e.message); process.exit(1); });
