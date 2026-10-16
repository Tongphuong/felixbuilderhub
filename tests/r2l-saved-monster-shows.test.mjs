import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeProgressState, publicProgressState, getEggOrMonsterView,
  MONSTER_MANIFEST, BASIC_MONSTER_CONFIG, normalizeAvatarMonster, saveAvatarMonster,
} from '../functions/api/_read2lead-v2-state.js';
import { resolveHubAvatarView } from '../src/lib/egg-renderer.ts';

// A chosen monster: the LAST part of each core slot (never the default first part),
// so "shows the default/basic instead" cannot pass by coincidence.
const CORE = ['body', 'eyes', 'mouth', 'arms'];
const chosen = Object.fromEntries(CORE.map((slot) => [slot, MONSTER_MANIFEST[slot].at(-1).id]));
const LEVELS = ['L0', 'L1', 'L2'];
const STAGES = ['egg', 'basic', 'custom', undefined, 'garbage'];

function raw(level, stage, withMonster) {
  return {
    current_level: level,
    ...(stage === undefined ? {} : { avatar_stage: stage }),
    ...(withMonster ? { avatar: { enabled: true, monster: { ...chosen, color: 'mint' } } } : {}),
  };
}

test('cross product: a chosen monster survives normalize + public + view at every level and stage', () => {
  for (const level of LEVELS) for (const stage of STAGES) {
    const label = `${level}/${stage}`;
    const state = normalizeProgressState(raw(level, stage, true), { accessCode: 'R2L-T' });
    for (const slot of CORE) assert.equal(state.avatar.monster[slot], chosen[slot], `${label} state ${slot}`);
    const pub = publicProgressState(state);
    for (const slot of CORE) assert.equal(pub.avatar.monster[slot], chosen[slot], `${label} public ${slot}`);
    assert.notEqual(pub.avatar_stage, 'egg', label);
    assert.equal(getEggOrMonsterView(state).stage, 'custom', label);
    for (const slot of CORE) assert.equal(getEggOrMonsterView(state).monster[slot], chosen[slot], `${label} view ${slot}`);
    // the surface: what the hồ sơ hero renders
    assert.equal(resolveHubAvatarView(pub), 'monster', label);
  }
});

test('cross product: a child who never chose gets the basic placeholder, never a stripped or egg state', () => {
  for (const level of LEVELS) for (const stage of STAGES) {
    const state = normalizeProgressState(raw(level, stage, false), { accessCode: 'R2L-T' });
    for (const slot of CORE) assert.equal(state.avatar.monster[slot], BASIC_MONSTER_CONFIG[slot], `${level}/${stage} ${slot}`);
    assert.equal(resolveHubAvatarView(publicProgressState(state)), 'monster', `${level}/${stage}`);
  }
});

test('hồ sơ resolver: explicit egg stage with no saved monster still shows the egg; nothing at all shows the placeholder', () => {
  assert.equal(resolveHubAvatarView({ avatar_stage: 'egg' }), 'egg');
  assert.equal(resolveHubAvatarView({ avatar_stage: 'egg', avatar: { monster: chosen } }), 'monster');
  assert.equal(resolveHubAvatarView({}), 'placeholder');
  assert.equal(resolveHubAvatarView(null), 'placeholder');
});

test('KNOWN-BAD: the hồ sơ view must not hide a saved monster behind the v3 preview flag', () => {
  const src = readFileSync(new URL('../src/pages/ho-so/ho-so-kid-view.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /v3\s*&&\s*\(state\.avatar/, 'monster render is gated on v3');
  assert.doesNotMatch(src, /v3\s*&&\s*avatarStage\s*===\s*'egg'/, 'egg branch is gated on v3');
  assert.match(src, /resolveHubAvatarView\(/);
});

test('saving a monster at L0 keeps chosen parts and does not touch any other progress field', () => {
  const full = normalizeProgressState({
    current_level: 'L0', diamonds: 123, completed_packs: 4, completed_pack_ids: ['a', 'b'],
    total_xp: 55, streak_days: 3, gift_goal: { item_id: 'gift-a' }, redemptions: [{ id: 'r1' }],
    unlocked_parts: ['png-default-detail-blue-horn-small'],
  }, { accessCode: 'R2L-T' });
  const result = saveAvatarMonster(full, chosen, 'R2L-T');
  assert.equal(result.ok, true);
  for (const slot of CORE) assert.equal(result.state.avatar.monster[slot], chosen[slot]);
  for (const key of Object.keys(full)) {
    if (['avatar', 'avatar_stage', 'updated_at'].includes(key)) continue;
    assert.deepEqual(result.state[key], full[key], `field ${key} changed`);
  }
  // round trip through a second normalize (the landmine: unknown fields silently dropped)
  const again = normalizeProgressState(JSON.parse(JSON.stringify(result.state)), { accessCode: 'R2L-T' });
  for (const key of Object.keys(full)) {
    if (['avatar', 'avatar_stage', 'updated_at', 'learning_metrics'].includes(key)) continue;
    assert.deepEqual(again[key], full[key], `round-trip field ${key}`);
  }
  for (const slot of CORE) assert.equal(again.avatar.monster[slot], chosen[slot]);
  assert.equal(typeof normalizeAvatarMonster, 'function');
});

// ---- Per-surface known-bad: no monster render path may depend on the v3 flag ----
// The live Worker's assets are built WITHOUT PUBLIC_R2L_V3, so v3 is off for every kid.
const MONSTER_SURFACES = {
  'shared header (Header.astro)': '../src/components/Header.astro',
  'hồ sơ hero (ho-so-kid-view.ts)': '../src/pages/ho-so/ho-so-kid-view.ts',
  'kid home (read2lead-child-home.ts)': '../src/scripts/read2lead-child-home.ts',
  'companion page (read2lead-companion.ts)': '../src/scripts/read2lead-companion.ts',
  'leaderboard rows (read2lead-stars.ts)': '../src/scripts/read2lead-stars.ts',
};
// A line that both checks the v3 flag and touches the monster/avatar.
const v3GatesMonster = (src) => src.split('\n').some((l) => /isV3Enabled\(\)|\bv3\s*&&/.test(l) && /monster|avatar|egg/i.test(l) && !/mountMonsterBuilder|showFirstHatchCeremony/.test(l)); // builder mount + hatch ceremony stay v3-gated by design

test('KNOWN-BAD detector: the v3-gate detector flags the pre-fix Header line', () => {
  assert.equal(v3GatesMonster("if (isV3Enabled() && state.avatar?.monster) {"), true);
  assert.equal(v3GatesMonster("if (v3 && (state.avatar as { monster?: unknown } | undefined)?.monster && monsterSlot)"), true);
  assert.equal(v3GatesMonster("if (state.avatar?.monster) {"), false);
});

for (const [name, path] of Object.entries(MONSTER_SURFACES)) {
  test(`monster surface is not v3-gated: ${name}`, () => {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.equal(v3GatesMonster(src), false, `${name} gates the monster on the v3 flag`);
  });
}
