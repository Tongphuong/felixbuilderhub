import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { onRequestPost as presets } from '../functions/api/admin/codes/apply-bot-presets.js';
import { onRequestPost as single } from '../functions/api/admin/codes/[code]/set-bot-stats.js';
test('bot injection endpoints retire without reading or writing any account', async () => {
 const context = new Proxy({}, { get() { assert.fail('storage or request accessed'); } });
 for(const handler of [presets, single]) { const r=await handler(context);assert.equal(r.status,410);assert.equal((await r.json()).error,'bot_ranking_retired'); }
});
test('bot population CLI refuses locally without starting a remote command', () => {
 const r=spawnSync(process.execPath,['scripts/apply-leaderboard-bots.mjs'],{encoding:'utf8',timeout:2000});assert.equal(r.status,1);assert.match(r.stderr,/retired/);assert.equal(r.stdout,'');
});
