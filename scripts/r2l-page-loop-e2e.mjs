#!/usr/bin/env node
/**
 * R2L page-by-page (book flow v3) live e2e — REAL-SPEECH recording included.
 *
 * Drives a deployed lesson end to end as a kid would: listen to each page,
 * answer its questions, read the page aloud. The "microphone" is Chrome's
 * fake-capture device fed with the story's own TTS audio for exactly the
 * text on the read card, so Whisper hears genuine speech and the scoring
 * pipeline (record → STT → scoreTranscript → submit → XP) runs for real.
 *
 * Because the fake-capture file is fixed per browser launch, the harness
 * relaunches Chrome with a fresh WAV for every read unit and resumes via the
 * lesson's own persistence (localStorage in a persistent profile + server
 * checkpoint) — which live-tests cross-restart resume on every page.
 *
 * Listen-stage audio is route-intercepted to a tiny silent clip so the run
 * doesn't spend 6 real minutes on playback; the mic/scoring path is never
 * intercepted. Real listen time is reported from ffprobe durations instead.
 *
 * Usage:
 *   node scripts/r2l-page-loop-e2e.mjs --base https://<preview>.pages.dev \
 *     --code R2L-XXXX-YYYY [--pack <pack_id>] [--topic animals] [--out /tmp/r2l-e2e]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, part, i, arr) => {
  if (part.startsWith('--')) acc.push([part.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
  return acc;
}, []));

const BASE = (args.base || '').replace(/\/$/, '');
const CODE = (args.code || '').toUpperCase();
const OUT = args.out || '/tmp/r2l-page-loop-e2e';
const CHROME = args.chrome || '/usr/bin/google-chrome';
if (!BASE || !CODE) {
  console.error('need --base and --code');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'shots'), { recursive: true });
const PROFILE = join(OUT, 'chrome-profile');
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const report = { base: BASE, code: CODE, pages: [], reads: [], questions: [], relaunches: 0, submit: null, timings: {} };

// ---------- helpers ----------
async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function sh(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr?.slice(0, 400)}`);
  return r.stdout;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function normText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function ffprobeSeconds(file) {
  try {
    return Number.parseFloat(sh('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])) || 0;
  } catch { return 0; }
}

// 0.4s of silence as an mp3 for intercepted listen audio.
const SILENT_MP3 = join(OUT, 'silence.mp3');
if (!existsSync(SILENT_MP3)) {
  sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.4', '-q:a', '9', SILENT_MP3]);
}

// Build the fake-mic WAV for one read card: the sentences whose text appears
// on the card, stitched from their own TTS audio, then a canonical PCM WAV.
const wavCache = new Map();
async function buildMicWav(cardText, sentences, key) {
  if (wavCache.has(key)) return wavCache.get(key);
  const want = normText(cardText);
  const parts = sentences.filter((s) => s.audio_url && want.includes(normText(s.text_en || s.text)));
  if (!parts.length) throw new Error(`no sentence audio matches card text: ${cardText.slice(0, 80)}`);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const f = join(OUT, `s-${key}-${i}.mp3`);
    await download(parts[i].audio_url, f);
    files.push(f);
  }
  const listFile = join(OUT, `list-${key}.txt`);
  writeFileSync(listFile, files.map((f) => `file '${f}'`).join('\n'));
  const wav = join(OUT, `mic-${key}.wav`);
  // 0.8s lead-in silence so the recorder's warm-up never clips the first word.
  sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-af', 'adelay=800:all=1', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  const entry = { wav, seconds: ffprobeSeconds(wav) };
  wavCache.set(key, entry);
  return entry;
}

async function launch(micWav) {
  report.relaunches += 1;
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 390, height: 844 },
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${micWav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  // Speed: listen-stage audio becomes a 0.4s silent clip. NEVER intercept API
  // calls — the recording upload and submit must hit the real endpoints.
  await page.route(/\.(mp3|m4a|ogg|aac)(\?|$)/, async (route) => {
    if (route.request().url().includes('/api/')) return route.fallback();
    return route.fulfill({ path: SILENT_MP3, contentType: 'audio/mpeg' });
  });
  page.on('response', async (res) => {
    if (res.url().includes('/api/submit-read2lead-lesson')) {
      report.submit = { status: res.status(), body: await res.json().catch(() => null) };
    }
    if (res.url().includes('/api/read2lead-speaking-check')) {
      const body = await res.json().catch(() => null);
      if (body) report.reads.push({ at: new Date().toISOString(), score: body.score_percent, ok: body.ok, transcript: (body.transcript || '').slice(0, 120) });
    }
  });
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: join(OUT, 'shots', `${name}.png`), fullPage: false }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The lesson's protected mic-check gate ("Kiểm tra micro", blockUntilPass)
// must pass once per browser session before any recording. The fake capture
// device is our speech WAV, so the check's non-silence probe passes as long
// as we run it AFTER relaunching with real audio (never with the silent WAV).
async function passMicCheck(page) {
  const state = await page.evaluate(() => document.querySelector('[data-r2l-mic-check]')?.dataset?.state || 'missing');
  if (state === 'passed' || state === 'missing') return state;
  await page.locator('[data-mic-test]').first().click({ timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelector('[data-r2l-mic-check]')?.dataset?.state === 'passed',
    { timeout: 25000 },
  );
  report.micCheckPassed = true;
  return 'passed';
}

async function visibleStage(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-book-stage-container]')].find((c) => !c.classList.contains('hidden'));
    const reader = document.querySelector('#w1-book-reader-phase');
    return {
      stage: el?.dataset?.bookStageContainer || null,
      dataStage: reader?.dataset?.bookStage || null,
      summaryShown: !document.querySelector('#book-reader-summary')?.classList?.contains('hidden'),
      counter: document.querySelector('#book-reader-page-counter')?.textContent || '',
    };
  });
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();

  // 1. Pack: reuse --pack or generate a fresh one.
  let packId = args.pack || '';
  if (!packId) {
    log('generating pack…');
    const gen = await api('/api/generate-read2lead-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: CODE, topic: args.topic || 'animals' }),
    });
    packId = gen.body?.pack_id || gen.body?.pack?.pack_id || '';
    if (!packId) throw new Error(`pack generation failed: ${gen.status} ${JSON.stringify(gen.body).slice(0, 300)}`);
    for (let i = 0; i < 30 && gen.body?.status === 'generation_in_progress'; i++) await sleep(2000);
  }
  log('pack:', packId);

  // 2. Lesson data (sentences + audio for the fake mic).
  const lessonRes = await api(`/api/read2lead-lesson?code=${encodeURIComponent(CODE)}&pack_id=${encodeURIComponent(packId)}`);
  const lesson = lessonRes.body?.lesson;
  if (!lesson) throw new Error(`lesson fetch failed: ${lessonRes.status} ${JSON.stringify(lessonRes.body).slice(0, 300)}`);
  const sentences = lesson.story?.sentences || [];
  const totalPages = (lesson.book_images || []).length;
  if (!totalPages) throw new Error('not a book lesson (no book_images) — pick a book-pool code/pack');
  report.totalPages = totalPages;
  report.realListenSeconds = 0;
  log(`book "${lesson.story?.title}" — ${totalPages} pages, ${sentences.length} sentences`);

  const url = `${BASE}/read2lead/lesson/?code=${encodeURIComponent(CODE)}&pack_id=${encodeURIComponent(packId)}`;
  let { ctx, page } = await launch(buildSilentWav());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await page.locator('#mic-prep-dismiss, [data-mic-prep-dismiss]').first().click({ timeout: 1500 }).catch(() => {});
  await shot(page, '00-loaded');

  let guard = 0;
  while (guard++ < 200) {
    const st = await visibleStage(page);
    if (st.summaryShown || report.submit) break;

    if (st.stage === 'story') {
      const pageNo = st.counter || '?';
      log(`listen ${pageNo}`);
      await page.locator('#book-reader-listen-btn').click({ timeout: 8000 }).catch(() => {});
      // silent 0.4s clip + 0.9s stage beat
      await page.waitForFunction(() => {
        const el = [...document.querySelectorAll('[data-book-stage-container]')].find((c) => !c.classList.contains('hidden'));
        return el && el.dataset.bookStageContainer !== 'story';
      }, { timeout: 20000 }).catch(async () => {
        // replay once if audio failed
        await page.locator('#book-reader-listen-btn').click().catch(() => {});
      });
      report.pages.push({ page: pageNo, listened: true });
      await shot(page, `p-${report.pages.length}-listened`);
      continue;
    }

    if (st.stage === 'questions') {
      const qText = await page.locator('#book-reader-question-text').textContent().catch(() => '');
      const buttons = page.locator('#book-reader-question-options button');
      const labels = await buttons.allTextContents();
      if (!labels.length) { await sleep(700); continue; }
      // Try to answer correctly from lesson data; fall back to try-then-retry
      // (which itself verifies the no-reshuffle fix).
      let clicked = false;
      const allQuestions = (lesson.guided_listening || []).flatMap((p) => p.questions || []);
      const match = allQuestions.find((q) => normText(q.question_vi) === normText(qText) || normText(q.question_en) === normText(qText));
      if (match) {
        const correct = normText(match.options_en?.[match.correct_index]);
        const idx = labels.findIndex((l) => normText(l) === correct);
        if (idx >= 0) { await buttons.nth(idx).click(); clicked = true; report.questions.push({ q: qText.slice(0, 60), firstTry: true }); }
      }
      if (!clicked) {
        const before = labels.join('|');
        await buttons.first().click();
        await sleep(900);
        const retry = page.locator('#book-reader-question-retry');
        if (await retry.isVisible().catch(() => false)) {
          await retry.click();
          await sleep(400);
          const after = (await page.locator('#book-reader-question-options button').allTextContents()).join('|');
          report.reshuffleStable = (report.reshuffleStable ?? true) && before === after;
          await page.locator('#book-reader-question-options button').nth(1).click();
        }
        report.questions.push({ q: qText.slice(0, 60), firstTry: false });
      }
      await sleep(1700); // correct feedback + 1.2s auto-advance
      continue;
    }

    if (st.stage === 'shadow') {
      const cardText = await page.locator('.r2l-book-shadow-card__text').textContent({ timeout: 8000 });
      const counter = await page.locator('#book-reader-shadow-counter').textContent().catch(() => '');
      const key = `${report.reads.length}-${normText(counter).replace(/\s/g, '') || 'r'}`;
      log(`read stage (${counter}): "${cardText.slice(0, 60)}…" — relaunching with matching mic WAV`);
      const mic = await buildMicWav(cardText, sentences, key);
      report.realListenSeconds += mic.seconds;
      await shot(page, `read-${key}-before`);
      await ctx.close();
      ({ ctx, page } = await launch(mic.wav));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      await page.locator('#mic-prep-dismiss, [data-mic-prep-dismiss]').first().click({ timeout: 1500 }).catch(() => {});
      const st2 = await visibleStage(page);
      if (st2.stage !== 'shadow') { log(`resume landed on ${st2.stage}, looping`); continue; }
      await passMicCheck(page);
      const rec = page.locator('#book-reader-shadow-body [data-speak-record]');
      await page.waitForFunction(() => {
        const b = document.querySelector('#book-reader-shadow-body [data-speak-record]');
        return b && !b.disabled;
      }, { timeout: 15000 }).catch(async () => {
        const diag = await page.evaluate(() => ({
          disabled: document.querySelector('#book-reader-shadow-body [data-speak-record]')?.disabled,
          heard: document.querySelector('#book-reader-shadow-body [data-speak-record]')?.dataset?.heard,
          micState: document.querySelector('[data-r2l-mic-check]')?.dataset?.state,
          micBlocked: document.querySelector('[data-r2l-mic-check]')?.dataset?.blocked,
          hint: document.querySelector('[data-book-rec-hint]')?.textContent,
        }));
        throw new Error(`record button never enabled: ${JSON.stringify(diag)}`);
      });
      report.micUnlockedWithoutSample = true;
      await rec.click();
      log(`recording ~${Math.ceil(mic.seconds)}s of real speech…`);
      await sleep((mic.seconds + 1.2) * 1000);
      await rec.click(); // stop
      await page.waitForFunction(() => {
        const s = document.querySelector('[data-book-attempt-status]')?.textContent || '';
        return /Đã đạt|Đã thử|—/.test(s) && !/0\/3/.test(s);
      }, { timeout: 40000 }).catch(() => {});
      await sleep(1200);
      await shot(page, `read-${key}-scored`);
      const cont = page.locator('[data-book-shadow-continue]');
      if (await cont.isVisible().catch(() => false)) await cont.click();
      else {
        // below-50 retry path: try once more, then let 3-attempt flow settle
        log('read did not settle — retrying record');
      }
      await sleep(900);
      continue;
    }

    if (st.stage === 'next') {
      await shot(page, `star-${report.pages.length}`);
      await page.locator('#book-reader-next').click({ timeout: 8000 });
      await sleep(1100);
      continue;
    }

    await sleep(800);
  }

  await sleep(4000); // allow auto-submit response
  await shot(page, '99-summary');
  report.timings.wallSeconds = Math.round((Date.now() - t0) / 1000);
  report.timings.estimatedKidMinutes = Math.round((report.realListenSeconds * 2 + report.questions.length * 12 + 30) / 60 * 10) / 10;
  await ctx.close();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log('DONE — submit:', JSON.stringify(report.submit)?.slice(0, 400));
  log(`report: ${join(OUT, 'report.json')}`);
}

function buildSilentWav() {
  const wav = join(OUT, 'silence.wav');
  if (!existsSync(wav)) sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '2', '-c:a', 'pcm_s16le', wav]);
  return wav;
}

main().catch((err) => {
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ ...report, error: String(err) }, null, 2));
  console.error('E2E FAILED:', err);
  process.exit(1);
});
