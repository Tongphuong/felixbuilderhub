// Re-renders every Minny PNG from the locked flat SVGs, same file name and same pixel size.
//   node scripts/minny/render-minny.mjs [repo root]     (default: the repo this script lives in; CHROME_PATH overrides Chrome)
// Reproducible: Chrome via playwright-core, deviceScaleFactor 1, transparent background where the original had one.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && fs.existsSync(p));
const VEC = path.join(repo, 'public/assets/minny/vector');
const svg = n => fs.readFileSync(path.join(VEC, n + '.svg'), 'utf8');

// kind: 'full' (opaque 288x512, sky + hill ground), 'bust' (transparent, upper body), 'face' (transparent, no sky square),
//       'pose' (transparent, whole pose centred), 'faceT'
const JOBS = [
  { out: 'public/assets/minny/minny.png', w: 288, h: 512, pose: 'minny-idle', kind: 'full' },
  { out: 'public/assets/minny/minny_full.png', w: 288, h: 512, pose: 'minny-idle', kind: 'full' },
  { out: 'public/assets/minny/minny_idle.png', w: 288, h: 512, pose: 'minny-idle', kind: 'full' },
  { out: 'public/assets/minny/minny_listen.png', w: 288, h: 512, pose: 'minny-listen', kind: 'full' },
  { out: 'public/assets/minny/minny_celebrate.png', w: 288, h: 512, pose: 'minny-cheer', kind: 'full' },
  { out: 'public/assets/minny/minny_encourage.png', w: 288, h: 512, pose: 'minny-idle', kind: 'full' },
  { out: 'public/assets/minny/minny_bust.png', w: 400, h: 400, pose: 'minny-idle', kind: 'bust' },
  { out: 'public/assets/minny/minny_face.png', w: 400, h: 400, pose: 'minny-face', kind: 'face' },
  { out: 'public/assets/r2l/minny/idle.png', w: 512, h: 512, pose: 'minny-idle', kind: 'pose' },
  { out: 'public/assets/r2l/minny/clap.png', w: 512, h: 512, pose: 'minny-cheer', kind: 'pose' },
  { out: 'public/assets/r2l/minny/dance.png', w: 512, h: 512, pose: 'minny-cheer', kind: 'pose' },
  { out: 'public/assets/r2l/minny/smile.png', w: 512, h: 512, pose: 'minny-face', kind: 'face' },
  { out: 'public/assets/r2l/minny/wink.png', w: 512, h: 512, pose: 'minny-face-talk', kind: 'face' },
  { out: 'public/assets/r2l/minny/thinking.png', w: 512, h: 512, pose: 'minny-listen', kind: 'pose' },
];

function html(j) {
  const s = svg(j.pose);
  const base = `html,body{margin:0;padding:0;width:${j.w}px;height:${j.h}px;overflow:hidden}`;
  if (j.kind === 'full') {
    // opaque original: sky above, hills below; the pose stands on the hill
    const pw = j.w, ph = Math.round(pw * 262 / 200);
    return `<style>${base}body{background:linear-gradient(#9BDDFF 0 70%,#7BD389 70% 100%);position:relative}
      .p{position:absolute;left:${Math.round((j.w - pw) / 2)}px;top:${Math.round(j.h * 0.7 - ph * 0.82)}px;width:${pw}px;height:${ph}px}.p svg{width:100%;height:100%}</style><div class="p">${s}</div>`;
  }
  if (j.kind === 'bust') {
    const pw = j.w, ph = Math.round(pw * 262 / 200);
    return `<style>${base}.p{position:absolute;left:0;top:${Math.round(-pw * 0.02)}px;width:${pw}px;height:${ph}px}.p svg{width:100%;height:100%}</style><div class="p">${s}</div>`;
  }
  if (j.kind === 'face') {
    // drop the sky square the locked face SVGs carry, keep the face
    return `<style>${base}.p{width:${j.w}px;height:${j.h}px}.p svg{width:100%;height:100%;display:block}.p svg>rect:first-child{display:none}</style><div class="p">${s}</div>`;
  }
  const ph = j.h, pw = Math.round(ph * 200 / 262);
  return `<style>${base}.p{position:absolute;left:${Math.round((j.w - pw) / 2)}px;top:0;width:${pw}px;height:${ph}px}.p svg{width:100%;height:100%}</style><div class="p">${s}</div>`;
}

const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
for (const j of JOBS) {
  const p = await b.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
  await p.setContent(html(j));
  const dest = path.join(repo, j.out);
  await p.screenshot({ path: dest, omitBackground: j.kind !== 'full', clip: { x: 0, y: 0, width: j.w, height: j.h } });
  await p.close();
  console.log('rendered', j.out, j.pose, j.kind);
}
await b.close();
