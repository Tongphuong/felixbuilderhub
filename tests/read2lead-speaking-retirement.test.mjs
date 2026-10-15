import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { speakingReturnPath, leaderboardReturnPath } from '../src/scripts/read2lead-speaking-redirect.mjs';
import { onRequestPost as conversation } from '../functions/api/minny-conversation.js';
import { onRequestPost as practice } from '../functions/api/minny-practice-log.js';
import { onRequestGet as context } from '../functions/api/minny-speaking-context.js';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';

test('legacy speaking links preserve the explicit identity, including invalid empty values', () => {
  assert.equal(speakingReturnPath('?t=personal&code=OTHER', 'STORED'), '/r2l/start?from=speaking&t=personal');
  assert.equal(speakingReturnPath('?t=&code=OTHER', 'STORED'), '/r2l/start?from=speaking&t=');
  assert.equal(speakingReturnPath('?code=', 'STORED'), '/read2lead?from=speaking&code=');
  assert.equal(speakingReturnPath('?access_code=', 'STORED'), '/read2lead?from=speaking&code=');
  assert.equal(speakingReturnPath('?code=A%26B&next=https://evil.test'), '/read2lead?from=speaking&code=A%26B');
  assert.equal(speakingReturnPath('?return=//evil.test', 'SAVED'), '/read2lead?from=speaking&code=SAVED');
  assert.equal(speakingReturnPath(''), '/read2lead?from=speaking');
});

test('retired public handlers do not inspect requests, accounts, providers, or award diamonds', async () => {
  const forbidden = new Proxy({}, { get() { assert.fail('retired endpoint touched a capability'); } });
  for (const handler of [conversation, practice, context]) {
    const response = await handler(forbidden);
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).error, 'standalone_speaking_retired');
  }
});

test('account host refuses standalone routes before transaction or provider access', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let transactions = 0;
  const service = createRead2LeadAccountService({ db, transaction(fn) { transactions++; return fn(); },
    infrastructure: { AI: { run() { assert.fail('provider called'); } } } });
  const before = transactions;
  for (const [path, method] of [['minny-conversation', 'POST'], ['minny-practice-log', 'POST'], ['minny-speaking-context', 'GET'], ['minny-speaking-context', 'HEAD']]) {
    const response = await service(new Request('https://fixture.test/api/' + path, { method }));
    assert.equal(response.status, 410, path);
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
  assert.equal(transactions, before);
});

test('legacy honors preserves token priority and rejects arbitrary return destinations', () => {
 assert.equal(leaderboardReturnPath('?t=&code=OTHER','SAVED'),'/read2lead/leaderboard?t=');
 assert.equal(leaderboardReturnPath('?code=','SAVED'),'/read2lead/leaderboard?code=');
 assert.equal(leaderboardReturnPath('?access_code=A%26B&next=https://evil.test'),'/read2lead/leaderboard?code=A%26B');
 assert.equal(leaderboardReturnPath('?next=//evil.test','SAVED'),'/read2lead/leaderboard?code=SAVED');
});
