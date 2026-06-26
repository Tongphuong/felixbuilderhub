import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  onRequestPost as uploadPortfolio,
  MAX_VIDEO_BYTES,
  makePortfolioId,
  validateVideoFile,
} from '../functions/api/admin/portfolio/upload.js';
import { onRequestGet as getParentPortfolio } from '../functions/api/parent/portfolio.js';
import { onRequestGet as getParentVideo } from '../functions/api/parent/video.js';
import { onRequestPost as markPortfolioSeen } from '../functions/api/parent/portfolio-seen.js';
import { onRequestPost as reactToPortfolio } from '../functions/api/parent/portfolio-react.js';

const parentPage = readFileSync('src/pages/ho-so/index.astro', 'utf8');
const parentScript = readFileSync('src/pages/ho-so/ho-so.ts', 'utf8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf8');

function memoryKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  return {
    calls,
    values,
    async get(key) {
      calls.push(['get', key]);
      const value = values.get(key);
      return value == null ? null : structuredClone(value);
    },
    async put(key, value) {
      calls.push(['put', key]);
      values.set(key, JSON.parse(value));
    },
  };
}

function codeRecord() {
  return { student_profile: { student_name: 'Linh' }, uses_remaining: 10 };
}

test('parent view contains portfolio section and seen/reaction calls', () => {
  assert.match(parentScript, /Video & nhận xét của thầy/);
  assert.match(parentScript, /\/api\/parent\/portfolio-seen/);
  assert.match(parentScript, /\/api\/parent\/portfolio-react/);
  assert.match(parentScript, /playsinline/);
  assert.match(parentScript, /renderPortfolioSection/);
});

test('admin page has upload form and delete confirmation', () => {
  const adminPage = readFileSync('src/pages/admin/portfolio.astro', 'utf8');
  assert.match(adminPage, /id="portfolio-upload-form"/);
  assert.match(adminPage, /name="video"/);
  assert.match(adminPage, /Gửi cho phụ huynh/);
  assert.match(adminPage, /confirm\(/);
  assert.match(adminPage, /\/api\/admin\/portfolio\/\$\{encodeURIComponent/);
});

test('portfolio ids use vp_ plus 12 lowercase alphanumeric characters', () => {
  const ids = new Set(Array.from({ length: 20 }, () => makePortfolioId()));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.match(id, /^vp_[a-z0-9]{12}$/);
});

test('upload enforces the 80MB limit and content-type whitelist', () => {
  assert.equal(validateVideoFile({ size: MAX_VIDEO_BYTES, type: 'video/mp4' }).ok, true);
  assert.equal(validateVideoFile({ size: MAX_VIDEO_BYTES + 1, type: 'video/mp4' }).error, 'video_too_large');
  assert.equal(validateVideoFile({ size: 100, type: 'video/quicktime' }).extension, 'mov');
  assert.equal(validateVideoFile({ size: 100, type: 'application/octet-stream' }).error, 'video_type_invalid');
});

test('upload validates the access code before writing R2 and only writes portfolio KV', async () => {
  const order = [];
  const kv = memoryKv({ 'R2L-LINH-1234': codeRecord() });
  const originalGet = kv.get;
  kv.get = async (key, options) => {
    order.push(`kv:${key}`);
    return originalGet(key, options);
  };
  const r2 = {
    async put(key) {
      order.push(`r2:${key}`);
      return { key };
    },
    async delete() {},
  };
  const form = new FormData();
  form.append('access_code', 'r2l-linh-1234');
  form.append('title', 'Bài nói tuần này');
  form.append('note_vi', 'Con đã giữ nhịp nói đều hơn.');
  form.append('video', new Blob(['video'], { type: 'video/mp4' }), 'clip.mp4');

  const response = await uploadPortfolio({
    request: new Request('https://example.com/api/admin/portfolio/upload', {
      method: 'POST',
      body: form,
    }),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
  });

  assert.equal(response.status, 201);
  assert.equal(order[0], 'kv:R2L-LINH-1234');
  assert.match(order.at(-1), /^r2:portfolio\/R2L-LINH-1234\/vp_/);
  assert.ok(kv.calls.some((call) => call[0] === 'put' && call[1] === 'portfolio:R2L-LINH-1234'));
  assert.ok(kv.calls.every((call) => !call[1].startsWith('progress:')));
  assert.deepEqual(kv.values.get('R2L-LINH-1234'), codeRecord());
});

test('upload with an invalid code never writes R2', async () => {
  let r2Writes = 0;
  const form = new FormData();
  form.append('access_code', 'R2L-WRONG-1234');
  form.append('title', 'Bài nói tuần này');
  form.append('note_vi', 'Con đã giữ nhịp nói đều hơn.');
  form.append('video', new Blob(['video'], { type: 'video/mp4' }), 'clip.mp4');

  const response = await uploadPortfolio({
    request: new Request('https://example.com/api/admin/portfolio/upload', {
      method: 'POST',
      body: form,
    }),
    env: {
      READ2LEAD_CODES: memoryKv(),
      R2L_MEDIA: { put: async () => { r2Writes += 1; } },
    },
  });

  assert.equal(response.status, 404);
  assert.equal(r2Writes, 0);
});

test('upload fails softly when R2L_MEDIA is missing', async () => {
  const response = await uploadPortfolio({
    request: new Request('https://example.com/api/admin/portfolio/upload', { method: 'POST' }),
    env: { READ2LEAD_CODES: memoryKv() },
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'config_error');
});

test('parent portfolio omits video_key and returns a code-gated video URL', async () => {
  const entry = {
    id: 'vp_123456789abc',
    video_key: 'portfolio/R2L-LINH-1234/vp_123456789abc.mp4',
    title: 'Bài nói',
    reactions: { heart: 0, clap: 0, strong: 0 },
  };
  const kv = memoryKv({
    'R2L-LINH-1234': codeRecord(),
    'portfolio:R2L-LINH-1234': [entry],
  });
  const response = await getParentPortfolio({
    request: new Request('https://example.com/api/parent/portfolio?code=R2L-LINH-1234'),
    env: { READ2LEAD_CODES: kv },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.items[0].video_key, undefined);
  assert.match(payload.items[0].video_url, /code=R2L-LINH-1234&id=vp_123456789abc/);
});

test('video validates code ownership before R2 and passes Range through with 206', async () => {
  const events = [];
  const entry = {
    id: 'vp_123456789abc',
    video_key: 'portfolio/R2L-LINH-1234/vp_123456789abc.mp4',
    content_type: 'video/mp4',
  };
  const kv = memoryKv({
    'R2L-LINH-1234': codeRecord(),
    'portfolio:R2L-LINH-1234': [entry],
  });
  const originalGet = kv.get;
  kv.get = async (key, options) => {
    events.push(`kv:${key}`);
    return originalGet(key, options);
  };
  const r2 = {
    async get(key, options) {
      events.push(`r2:${key}`);
      assert.equal(options.range.get('range'), 'bytes=2-5');
      return {
        body: new Blob(['3456']).stream(),
        size: 10,
        range: { offset: 2, length: 4 },
        httpEtag: '"etag"',
        writeHttpMetadata(headers) {
          headers.set('Content-Type', 'video/mp4');
        },
      };
    },
  };

  const response = await getParentVideo({
    request: new Request(
      'https://example.com/api/parent/video?code=R2L-LINH-1234&id=vp_123456789abc',
      { headers: { Range: 'bytes=2-5' } },
    ),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
  });

  const codeRead = events.indexOf('kv:R2L-LINH-1234');
  const portfolioRead = events.indexOf('kv:portfolio:R2L-LINH-1234');
  const r2Read = events.findIndex((event) => event.startsWith('r2:portfolio/'));
  assert.ok(codeRead >= 0 && codeRead < portfolioRead);
  assert.ok(portfolioRead < r2Read);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0');
  assert.equal(await response.text(), '3456');
});

test('video never reads R2 for a wrong student code', async () => {
  let r2Reads = 0;
  const response = await getParentVideo({
    request: new Request(
      'https://example.com/api/parent/video?code=R2L-OTHER-1234&id=vp_123456789abc',
    ),
    env: {
      READ2LEAD_CODES: memoryKv(),
      R2L_MEDIA: { get: async () => { r2Reads += 1; } },
    },
  });
  assert.equal(response.status, 404);
  assert.equal(r2Reads, 0);
});

test('seen is set once and reactions increment with a cap of 99', async () => {
  const entry = {
    id: 'vp_123456789abc',
    parent_seen_at: null,
    reactions: { heart: 98, clap: 0, strong: 0 },
  };
  const kv = memoryKv({
    'R2L-LINH-1234': codeRecord(),
    'portfolio:R2L-LINH-1234': [entry],
  });

  const seenResponse = await markPortfolioSeen({
    request: new Request('https://example.com/api/parent/portfolio-seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'R2L-LINH-1234', id: entry.id }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  assert.equal(seenResponse.status, 200);
  assert.ok(kv.values.get('portfolio:R2L-LINH-1234')[0].parent_seen_at);

  for (let index = 0; index < 2; index += 1) {
    const reactionResponse = await reactToPortfolio({
      request: new Request('https://example.com/api/parent/portfolio-react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'R2L-LINH-1234', id: entry.id, kind: 'heart' }),
      }),
      env: { READ2LEAD_CODES: kv },
    });
    assert.equal(reactionResponse.status, 200);
  }

  assert.equal(kv.values.get('portfolio:R2L-LINH-1234')[0].reactions.heart, 99);
  assert.ok(kv.calls.every((call) => !call[1].startsWith('progress:')));
});
