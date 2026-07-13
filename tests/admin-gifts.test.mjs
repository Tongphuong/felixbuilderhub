import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestGet as getGifts,
  onRequestPost as saveGifts,
} from '../functions/api/admin/gifts.js';
import {
  onRequestPost as uploadGiftImage,
  validateGiftImageFile,
  MAX_IMAGE_BYTES,
} from '../functions/api/admin/gifts/upload.js';
import { onRequestGet as getGiftImage } from '../functions/api/read2lead-gift-image.js';
import { onRequestPost as giftsList } from '../functions/api/read2lead-gifts-list.js';
import { GIFT_STORE_KEY, DEFAULT_GIFTS } from '../functions/api/admin/_gifts.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

const ACCESS_CODE = 'R2L-GIFT-ADM';

function memoryKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key, opts) {
      const value = values.get(key);
      if (value === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(JSON.stringify(value)) : JSON.stringify(value);
    },
    async put(key, value) {
      values.set(key, JSON.parse(value));
    },
  };
}

// --- catalogue CRUD ----------------------------------------------------------

test('GET /admin/gifts seeds the 7-gift ladder including cost_vnd when KV is empty', async () => {
  const env = { READ2LEAD_CODES: memoryKv() };
  const response = await getGifts({ env });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.gifts.length, 7);
  const ids = payload.gifts.map((g) => g.id);
  assert.deepEqual(ids, ['sticker', 'pen', 'pencil_case', 'milk_tea', 'lego', 'books', 'football']);
  for (const gift of payload.gifts) {
    assert.equal('cost_vnd' in gift, true, 'admin GET must include cost_vnd for budgeting');
    // Fix (Buffet MEDIUM): limit_total stays unset/unlimited on every seed
    // gift — blank is the founder's stated normal case, a cap is a budget
    // guard he opts into himself, never seeded.
    assert.equal(gift.limit_total, null);
    assert.equal(gift.active, true);
  }
  const sticker = payload.gifts.find((g) => g.id === 'sticker');
  assert.equal(sticker.price_diamonds, 1000);
  assert.equal(sticker.emoji, '🌟');

  // Fix (Buffet MEDIUM): real purchase costs from Read2Lead Real Gifts
  // Shop/HANDOFF.md §3, seeded so the ≈₫/💎 column and monthly-cost rollup
  // are populated from day one instead of reading "—"/₫0 until the founder
  // types every figure by hand.
  const costByGiftId = Object.fromEntries(payload.gifts.map((g) => [g.id, g.cost_vnd]));
  assert.deepEqual(costByGiftId, {
    sticker: 2000,
    pen: 8000,
    pencil_case: 25000,
    milk_tea: 30000,
    lego: 400000,
    books: 90000,
    football: 150000,
  });
});

test('POST /admin/gifts saves the whole catalogue and normalizes it', async () => {
  const env = { READ2LEAD_CODES: memoryKv() };
  const response = await saveGifts({
    request: new Request('https://example.com/api/admin/gifts', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [
          { id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: '1000', cost_vnd: 5000 },
          { name_vi: 'Quà mới', emoji: '🎁', price_diamonds: 2500, limit_total: 3 },
        ],
      }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.gifts.length, 2);
  assert.equal(payload.gifts[0].price_diamonds, 1000, 'string prices are coerced to numbers');
  // Id derivation mirrors cleanId() in admin/_classes.js exactly (strips
  // non a-z0-9 chars, including Vietnamese diacritics, rather than
  // transliterating them) — same known quirk as class names.
  assert.ok(payload.gifts[1].id, 'a missing id is derived from the name when absent');
  assert.notEqual(payload.gifts[1].id, '');
  assert.equal(payload.gifts[1].limit_total, 3);

  const raw = env.READ2LEAD_CODES.values.get(GIFT_STORE_KEY);
  assert.equal(raw.gifts.length, 2);
});

test('POST /admin/gifts respects an explicitly saved empty catalogue (does not re-seed)', async () => {
  const env = { READ2LEAD_CODES: memoryKv() };
  await saveGifts({
    request: new Request('https://example.com/api/admin/gifts', {
      method: 'POST',
      body: JSON.stringify({ gifts: [] }),
    }),
    env,
  });
  const response = await getGifts({ env });
  const payload = await response.json();
  assert.deepEqual(payload.gifts, []);
});

test('POST /admin/gifts 400 when gifts is not an array', async () => {
  const env = { READ2LEAD_CODES: memoryKv() };
  const response = await saveGifts({
    request: new Request('https://example.com/api/admin/gifts', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    env,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'gifts_required');
});

// --- kid endpoint never leaks cost_vnd ---------------------------------------

test('cost_vnd NEVER leaks from the kid-facing gifts-list endpoint', async () => {
  const env = {
    READ2LEAD_CODES: memoryKv({
      [ACCESS_CODE]: { student_profile: { student_name: 'Nam' } },
      [GIFT_STORE_KEY]: { schema_version: 1, gifts: DEFAULT_GIFTS.map((g) => ({ ...g, cost_vnd: 99999 })) },
    }),
    READ2LEAD_PROGRESS: memoryKv({
      [progressKey(ACCESS_CODE)]: { schema_version: 2, level_reset_version: 20260606, diamonds: 500 },
    }),
  };
  const response = await giftsList({
    request: new Request('https://example.com/api/read2lead-gifts-list', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.items.length > 0);
  const raw = JSON.stringify(payload);
  assert.doesNotMatch(raw, /cost_vnd/, 'cost_vnd must not appear anywhere in the kid-facing response');
});

// --- upload --------------------------------------------------------------------

test('validateGiftImageFile enforces the 2MB limit and content-type whitelist', () => {
  assert.equal(validateGiftImageFile({ size: MAX_IMAGE_BYTES, type: 'image/png' }).ok, true);
  assert.equal(validateGiftImageFile({ size: MAX_IMAGE_BYTES + 1, type: 'image/png' }).error, 'image_too_large');
  assert.equal(validateGiftImageFile({ size: 100, type: 'image/gif' }).error, 'image_type_invalid');
  assert.equal(validateGiftImageFile({ size: 0, type: 'image/jpeg' }).error, 'image_empty');
  assert.equal(validateGiftImageFile(null).error, 'image_required');
});

test('gift image upload writes to R2 as gifts/<id>.<ext> and stores image_key', async () => {
  const r2Writes = [];
  const env = {
    READ2LEAD_CODES: memoryKv({
      [GIFT_STORE_KEY]: { schema_version: 1, gifts: DEFAULT_GIFTS },
    }),
    R2L_MEDIA: {
      async put(key, _body, opts) {
        r2Writes.push({ key, contentType: opts?.httpMetadata?.contentType });
      },
    },
  };
  const form = new FormData();
  form.append('gift_id', 'sticker');
  form.append('image', new Blob(['fake-image-bytes'], { type: 'image/jpeg' }), 'sticker.jpg');

  const response = await uploadGiftImage({
    request: new Request('https://example.com/api/admin/gifts/upload', { method: 'POST', body: form }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.image_key, 'gifts/sticker.jpg');
  assert.equal(r2Writes[0].key, 'gifts/sticker.jpg');
  assert.equal(r2Writes[0].contentType, 'image/jpeg');

  const stored = env.READ2LEAD_CODES.values.get(GIFT_STORE_KEY);
  assert.equal(stored.gifts.find((g) => g.id === 'sticker').image_key, 'gifts/sticker.jpg');
});

test('gift image upload 404s for an unknown gift_id and writes nothing to R2', async () => {
  let r2Writes = 0;
  const env = {
    READ2LEAD_CODES: memoryKv({ [GIFT_STORE_KEY]: { schema_version: 1, gifts: DEFAULT_GIFTS } }),
    R2L_MEDIA: { async put() { r2Writes += 1; } },
  };
  const form = new FormData();
  form.append('gift_id', 'not-a-gift');
  form.append('image', new Blob(['x'], { type: 'image/png' }), 'x.png');
  const response = await uploadGiftImage({
    request: new Request('https://example.com/api/admin/gifts/upload', { method: 'POST', body: form }),
    env,
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'gift_not_found');
  assert.equal(r2Writes, 0);
});

test('gift image upload rejects a too-large or wrongly-typed file', async () => {
  const env = {
    READ2LEAD_CODES: memoryKv({ [GIFT_STORE_KEY]: { schema_version: 1, gifts: DEFAULT_GIFTS } }),
    R2L_MEDIA: { async put() {} },
  };
  const bigForm = new FormData();
  bigForm.append('gift_id', 'sticker');
  bigForm.append('image', new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' }), 'big.png');
  const bigResponse = await uploadGiftImage({
    request: new Request('https://example.com/api/admin/gifts/upload', { method: 'POST', body: bigForm }),
    env,
  });
  assert.equal(bigResponse.status, 413);
  assert.equal((await bigResponse.json()).error, 'image_too_large');

  const wrongTypeForm = new FormData();
  wrongTypeForm.append('gift_id', 'sticker');
  wrongTypeForm.append('image', new Blob(['x'], { type: 'image/gif' }), 'x.gif');
  const wrongTypeResponse = await uploadGiftImage({
    request: new Request('https://example.com/api/admin/gifts/upload', { method: 'POST', body: wrongTypeForm }),
    env,
  });
  assert.equal(wrongTypeResponse.status, 415);
  assert.equal((await wrongTypeResponse.json()).error, 'image_type_invalid');
});

test('gift image upload fails softly when R2L_MEDIA is missing', async () => {
  const env = { READ2LEAD_CODES: memoryKv({ [GIFT_STORE_KEY]: { schema_version: 1, gifts: DEFAULT_GIFTS } }) };
  const response = await uploadGiftImage({
    request: new Request('https://example.com/api/admin/gifts/upload', { method: 'POST' }),
    env,
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'config_error');
});

// --- image serve ------------------------------------------------------------

test('GET /read2lead-gift-image serves the object referenced by the gift image_key', async () => {
  const env = {
    R2L_MEDIA: {
      async get(key) {
        assert.equal(key, 'gifts/sticker.jpg');
        return {
          body: new Blob(['fake-bytes']),
          size: 10,
          httpEtag: '"abc"',
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/jpeg'); },
        };
      },
    },
    READ2LEAD_CODES: memoryKv({
      [GIFT_STORE_KEY]: {
        schema_version: 1,
        gifts: [{ ...DEFAULT_GIFTS[0], image_key: 'gifts/sticker.jpg' }],
      },
    }),
  };
  const response = await getGiftImage({
    request: new Request('https://example.com/api/read2lead-gift-image?id=sticker'),
    env,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.match(response.headers.get('Cache-Control'), /max-age=31536000/);
});

test('GET /read2lead-gift-image 404s when the gift has no image', async () => {
  const env = {
    R2L_MEDIA: { async get() { return null; } },
    READ2LEAD_CODES: memoryKv({ [GIFT_STORE_KEY]: { schema_version: 1, gifts: DEFAULT_GIFTS } }),
  };
  const response = await getGiftImage({
    request: new Request('https://example.com/api/read2lead-gift-image?id=sticker'),
    env,
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'image_not_found');
});

test('GET /read2lead-gift-image config_error when R2L_MEDIA is missing', async () => {
  const env = { READ2LEAD_CODES: memoryKv({ [GIFT_STORE_KEY]: { schema_version: 1, gifts: DEFAULT_GIFTS } }) };
  const response = await getGiftImage({
    request: new Request('https://example.com/api/read2lead-gift-image?id=sticker'),
    env,
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'config_error');
});
