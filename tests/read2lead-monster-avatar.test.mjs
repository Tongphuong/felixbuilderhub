import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultMonsterForCode,
  normalizeAvatarMonster,
  normalizeProgressState,
  publicProgressState,
  saveAvatarMonster,
} from '../functions/api/_read2lead-v2-state.js';

test('defaultMonsterForCode is deterministic per access code', () => {
  const a = defaultMonsterForCode('R2L-ALPHA-001');
  const b = defaultMonsterForCode('R2L-ALPHA-001');
  const c = defaultMonsterForCode('R2L-BETA-002');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.color, b.color);
  assert.ok(['mint', 'coral', 'sky', 'lemon', 'grape'].includes(a.color));
});

test('normalizeAvatarMonster clamps invalid part ids to defaults', () => {
  const defaults = defaultMonsterForCode('R2L-CLAMP-TEST');
  const normalized = normalizeAvatarMonster(
    { body: 'not-real', eyes: 'nope', mouth: 'x', arms: 'y', detail: 'z', color: 'invalid' },
    'R2L-CLAMP-TEST',
  );
  assert.equal(normalized.body, defaults.body);
  assert.equal(normalized.eyes, defaults.eyes);
  assert.equal(normalized.color, defaults.color);
});

test('old record without avatar.monster gets default monster without crash', () => {
  const legacy = normalizeProgressState(
    { schema_version: 2, level_reset_version: 20260606, coins: 12 },
    { accessCode: 'R2L-LEGACY-MONSTER' },
  );
  const pub = publicProgressState(legacy);
  assert.equal(legacy.avatar.enabled, true);
  assert.ok(legacy.avatar.monster);
  assert.equal(typeof legacy.avatar.monster.body, 'string');
  assert.deepEqual(legacy.avatar.monster, defaultMonsterForCode('R2L-LEGACY-MONSTER'));
  assert.ok(pub.monster_parts);
  assert.deepEqual(pub.avatar.monster, legacy.avatar.monster);
});

test('saveAvatarMonster validates and persists normalized monster', () => {
  const base = normalizeProgressState(null, { accessCode: 'R2L-SAVE-MON' });
  const saved = saveAvatarMonster(base, {
    body: 'default',
    eyes: 'default',
    mouth: 'default',
    arms: 'default',
    detail: 'default',
    color: 'sky',
  }, 'R2L-SAVE-MON');
  assert.equal(saved.ok, true);
  assert.equal(saved.state.avatar.monster.color, 'sky');
  assert.equal(saved.monster.color, 'sky');
});
