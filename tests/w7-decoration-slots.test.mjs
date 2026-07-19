import test from 'node:test';
import assert from 'node:assert/strict';

import manifest from '../functions/api/_monster-parts-data.mjs';
import {
  BASIC_MONSTER_CONFIG,
  MONSTER_SLOTS,
  normalizeAvatarMonster,
  normalizeProgressState,
  progressKey,
} from '../functions/api/_read2lead-v2-state.js';
import {
  DECORATION_PRICES,
  buildShopView,
  executeBuy,
  getPartRarity,
  getPartSlot,
  humanizePartId,
} from '../functions/api/_read2lead-shop-v2.js';
import { onRequestPost as shopBuy } from '../functions/api/read2lead-shop-buy.js';

const ACCESS_CODE = 'R2L-W7-DECOR';
const COMMON_BODY = manifest.body.find((part) => part.rarity === 'common').id;
const RARE_BODY = manifest.body.find((part) => part.rarity === 'rare').id;
const COMMON_EFFECT = manifest.effects.find((part) => part.rarity === 'common').id;
const RARE_EFFECT = manifest.effects.find((part) => part.rarity === 'rare').id;
const COMMON_FRAME = manifest.frame.find((part) => part.rarity === 'common').id;
const RAINBOW_FRAME = 'frame-rainbow';

function makeProgress(overrides = {}) {
  return {
    schema_version: 2,
    level_reset_version: 20260606,
    diamonds: 2000,
    avatar_stage: 'custom',
    unlocked_parts: [],
    rank_points: 9,
    rank_ladder: { tier_index: 1 },
    avatar: {
      enabled: true,
      monster: { ...BASIC_MONSTER_CONFIG },
    },
    ...overrides,
  };
}

function makeEnv(progress, { w7Enabled = true } = {}) {
  const store = new Map([[progressKey(ACCESS_CODE), JSON.stringify(progress)]]);
  const codeData = { student_profile: { student_name: 'Linh' } };
  return {
    ...(w7Enabled ? { PUBLIC_R2L_W7: '1' } : {}),
    READ2LEAD_CODES: {
      async get(key, opts) {
        if (key !== ACCESS_CODE) return null;
        return opts?.type === 'json' ? codeData : JSON.stringify(codeData);
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
    READ2LEAD_PROGRESS: {
      async get(key, opts) {
        const raw = store.get(key);
        if (!raw) return null;
        return opts?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
    __store: store,
  };
}

async function buy(env, partId) {
  const response = await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: partId }),
    }),
    env,
  });
  return { response, payload: await response.json() };
}

test('manifest and MONSTER_SLOTS expose effects plus frame', () => {
  assert.deepEqual(MONSTER_SLOTS.slice(-2), ['effects', 'frame']);
  assert.equal(manifest.effects.length, 40);
  assert.equal(manifest.frame.length, 31);
});

test('decoration manifests contain common, rare, and epic tiers', () => {
  for (const slot of ['effects', 'frame']) {
    const tiers = new Set(manifest[slot].map((part) => part.rarity));
    assert.deepEqual([...tiers].sort(), ['common', 'epic', 'rare']);
  }
});

test('basic monster defaults both decoration slots to empty', () => {
  assert.equal(BASIC_MONSTER_CONFIG.effects, '');
  assert.equal(BASIC_MONSTER_CONFIG.frame, '');
});

test('legacy state migration stays schema v2 and adds empty decorations', () => {
  const state = normalizeProgressState(
    { schema_version: 2, level_reset_version: 20260606 },
    { accessCode: ACCESS_CODE },
  );
  assert.equal(state.schema_version, 2);
  assert.equal(state.avatar.monster.effects, '');
  assert.equal(state.avatar.monster.frame, '');
});

test('normalizeAvatarMonster accepts valid decoration fields', () => {
  const monster = normalizeAvatarMonster({
    ...BASIC_MONSTER_CONFIG,
    effects: COMMON_EFFECT,
    frame: COMMON_FRAME,
  }, ACCESS_CODE);
  assert.equal(monster.effects, COMMON_EFFECT);
  assert.equal(monster.frame, COMMON_FRAME);
});

test('shop view exposes all decoration tiers and exact slot pricing', () => {
  const items = buildShopView({ diamonds: 2000, unlocked_parts: [] });
  for (const slot of ['effects', 'frame']) {
    for (const rarity of ['common', 'rare', 'epic']) {
      const item = items.find((candidate) =>
        candidate.slot === slot && candidate.rarity === rarity);
      assert.ok(item, `missing ${slot}/${rarity}`);
      assert.equal(item.price, DECORATION_PRICES[slot][rarity]);
    }
  }
});

test('decoration metadata resolves slot and rarity', () => {
  assert.equal(getPartSlot(COMMON_EFFECT), 'effects');
  assert.equal(getPartRarity(COMMON_EFFECT), 'common');
  assert.equal(getPartSlot(RAINBOW_FRAME), 'frame');
  assert.equal(getPartRarity(RAINBOW_FRAME), 'epic');
});

test('Vietnamese labels cover effects, frames, and cầu vồng', () => {
  assert.match(humanizePartId(COMMON_EFFECT), /^Hiệu ứng /);
  assert.match(humanizePartId(COMMON_FRAME), /^Khung /);
  assert.equal(humanizePartId(RAINBOW_FRAME), 'Khung cầu vồng');
});

test('executeBuy accepts a common effect but still rejects a common body', () => {
  const effectResult = executeBuy({ diamonds: 100, unlocked_parts: [] }, COMMON_EFFECT);
  assert.equal(effectResult.error, undefined);
  assert.equal(effectResult.state.diamonds, 75);
  assert.equal(effectResult.reward.price, 25);

  const bodyResult = executeBuy({ diamonds: 100, unlocked_parts: [] }, COMMON_BODY);
  assert.equal(bodyResult.error, 'common_parts_are_free');
});

test('buying a common effect auto-equips it and records a ceremony', async () => {
  const env = makeEnv(makeProgress());
  const { response, payload } = await buy(env, COMMON_EFFECT);
  assert.equal(response.status, 200);
  assert.equal(payload.avatar.monster.effects, COMMON_EFFECT);
  assert.equal(payload.pending_ceremony.part_id, COMMON_EFFECT);
  assert.equal(payload.pending_ceremony.rarity, 'common');
});

test('shop-buy rejects decorations while W7 is disabled and preserves state', async () => {
  const initial = makeProgress();
  const env = makeEnv(initial, { w7Enabled: false });
  const { response, payload } = await buy(env, COMMON_EFFECT);
  assert.equal(response.status, 400);
  assert.deepEqual(payload, {
    ok: false,
    error: 'w7_disabled',
    message: 'Tạm thời chưa mở',
  });
  assert.deepEqual(
    JSON.parse(env.__store.get(progressKey(ACCESS_CODE))),
    initial,
  );
});

test('buying a common frame preserves an equipped common effect', async () => {
  const env = makeEnv(makeProgress({
    unlocked_parts: [COMMON_EFFECT],
    avatar: {
      enabled: true,
      monster: { ...BASIC_MONSTER_CONFIG, effects: COMMON_EFFECT },
    },
  }));
  const { payload } = await buy(env, COMMON_FRAME);
  assert.equal(payload.avatar.monster.effects, COMMON_EFFECT);
  assert.equal(payload.avatar.monster.frame, COMMON_FRAME);
});

test('buying a common effect preserves an equipped common frame', async () => {
  const env = makeEnv(makeProgress({
    unlocked_parts: [COMMON_FRAME],
    avatar: {
      enabled: true,
      monster: { ...BASIC_MONSTER_CONFIG, frame: COMMON_FRAME },
    },
  }));
  const { payload } = await buy(env, COMMON_EFFECT);
  assert.equal(payload.avatar.monster.frame, COMMON_FRAME);
  assert.equal(payload.avatar.monster.effects, COMMON_EFFECT);
});

test('buying a rare effect keeps the earned common effect unlocked', async () => {
  const env = makeEnv(makeProgress({
    unlocked_parts: [COMMON_EFFECT],
    avatar: {
      enabled: true,
      monster: { ...BASIC_MONSTER_CONFIG, effects: COMMON_EFFECT },
    },
  }));
  const { payload } = await buy(env, RARE_EFFECT);
  assert.equal(payload.avatar.monster.effects, RARE_EFFECT);
  assert.ok(payload.unlocked_parts.includes(COMMON_EFFECT));
  assert.ok(payload.unlocked_parts.includes(RARE_EFFECT));
});

test('common body alternatives still collapse to the basic default', async () => {
  assert.notEqual(COMMON_BODY, BASIC_MONSTER_CONFIG.body);
  const env = makeEnv(makeProgress({
    avatar: {
      enabled: true,
      monster: { ...BASIC_MONSTER_CONFIG, body: COMMON_BODY },
    },
  }));
  const { payload } = await buy(env, COMMON_FRAME);
  assert.equal(payload.avatar.monster.body, BASIC_MONSTER_CONFIG.body);
});

test('rare body remains equipped while buying a decoration', async () => {
  const env = makeEnv(makeProgress({
    unlocked_parts: [RARE_BODY],
    avatar: {
      enabled: true,
      monster: { ...BASIC_MONSTER_CONFIG, body: RARE_BODY },
    },
  }));
  const { payload } = await buy(env, COMMON_FRAME);
  assert.equal(payload.avatar.monster.body, RARE_BODY);
});
