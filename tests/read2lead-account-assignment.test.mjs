import {fixturePackage} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';
import { onRequestPost as originalGenerate } from '../functions/api/generate-read2lead-pack.js';
import { makeStoredBookPack } from './helpers/book-pack-fixture.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with { type: 'json' };

const CODE = 'R2L-SYNTHETIC-ASSIGNMENT', PART = 'png-default-detail-blue-horn-small';
for (const isTest of [false, true]) test(`automatic assignment is safe across two tabs (test=${isTest})`, async () => {
  const f = fixture({isTest});
  try {
    const wallet = f.wallet();
    const results = await Promise.all([f.assign('auto'), f.assign('auto')]);
    const data = await Promise.all(results.map(response => response.json()));
    assert.equal(f.account().progress.packs_created, 1);
    assert.deepEqual(f.wallet(), wallet);
    const ids = data.map(row => row.pack_id || row.current_pack?.pack_id).filter(Boolean);
    assert.equal(new Set(ids).size, 1);
    assert.ok(results.every(response => [200,409].includes(response.status)));
  } finally { f.db.close(); }
});
function fixture({ isTest = false, books = true } = {}) {
  const db = new DatabaseSync(':memory:');
  const transaction = work => { db.exec('BEGIN'); try { const value = work(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const catalog = structuredClone(pkg);
  // Synthetic asset references exercise assignment/pinning only; these do not
  // claim real media decoding, listening or publisher-content acceptance.
  catalog.assets = [
    { id: 'synthetic-image', kind: 'image', sha256: '1'.repeat(64), bytes: 100, mime: 'image/png', object_key: '1'.repeat(64) + '.png', width: 1, height: 1, duration_seconds: 0, provenance: 'synthetic_fixture', reference_hashes: [], character_ids: [], alt_en: 'Synthetic image' },
    { id: 'synthetic-audio', kind: 'audio', sha256: '2'.repeat(64), bytes: 100, mime: 'audio/wav', object_key: '2'.repeat(64) + '.wav', width: 0, height: 0, duration_seconds: 20, provenance: 'synthetic_fixture', reference_hashes: [], character_ids: [], alt_en: 'Synthetic audio' },
  ];
  catalog.lesson.illustrations = [{ id: 'synthetic-scene', kind: 'raster', asset_id: 'synthetic-image', alt_en: 'Synthetic image', sentence_ids: [catalog.lesson.story.sentences[0].id] }];
  catalog.lesson.audio.asset_id = 'synthetic-audio'; catalog.lesson.audio.status = 'candidate';
  const infrastructure = { R2L_CONTENT_SOURCE: 'combined', R2L_PRIVATE_QA: 'adult-isolated',
    READ2LEAD_BACKEND_URL: 'https://synthetic-provider.invalid', READ2LEAD_BACKEND_SECRET: 'synthetic-only',
    R2L_STORY_CATALOGUE: { async get(key) {
      if (key === 'index:L1') return [{ id: catalog.lesson.id, version: catalog.lesson.version }];
      if (key === `package:${catalog.lesson.id}@${catalog.lesson.version}`) return { status: 'private-draft', package: structuredClone(catalog) };
      return null;
    } },
  };
  const create = () => createRead2LeadAccountService({ db, transaction, infrastructure });
  let service = create();
  const put = (ns, key, value) => db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(ns, key, JSON.stringify(value));
  const get = (ns, key) => { const row = db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(ns, key); return row ? JSON.parse(row.value) : null; };
  put('codes', CODE, { is_test: isTest, uses_remaining: 9, custom_preserved: 'original-account-field',
    student_profile: { student_name: 'Synthetic', age: 10, child_gender: 'boy', level: 'L1' }, completed_books: [],
    progress: { current_level: 'L1', packs_created: 0, current_pack: null, review_history: [{ pack_id: 'historic-pack', score_percent: 80 }] } });
  put('progress', 'progress:' + CODE, { schema_version: 2, level_reset_version: 20260606, current_level: 'L1', initial_level: 'L1', total_xp: 0, diamonds: 2000, rank_points: 0, unlocked_parts: [] });
  put('codes', 'config:book_levels', books ? ['L0', 'L1', 'L2', 'L3', 'L4'] : []);
  put('codes', 'book_index:L1', ['book_1']); put('codes', 'book:book_1', makeStoredBookPack('book_1'));
  const kv = ns => ({ async get(key, opts) { const value = get(ns, key); return value === null ? null : opts?.type === 'json' ? value : JSON.stringify(value); }, async put(key, value) { put(ns, key, JSON.parse(value)); } });
  const call = (pathname, body) => service(new Request('https://synthetic.test' + pathname, { method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }));
  return { db, catalog, infrastructure, put, get, call, account: () => get('codes', CODE), wallet: () => get('progress', 'progress:' + CODE),
    assign: collection => call('/api/generate-read2lead-pack', { access_code: CODE, collection }),
    snapshot: () => db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all().map(row => ({ ...row })),
    restart: () => { service = create(); }, legacyEnv: { ...infrastructure, READ2LEAD_CODES: kv('codes'), READ2LEAD_PROGRESS: kv('progress') } };
}

test('easier original story preserves partial work, permanent level and wallet; duplicate clicks return one replacement',async()=>{
  const f=fixture();
  try {
    await f.assign('auto');
    const old=f.account();old.progress.current_pack.web_lesson_steps={listen_completed_at:'2026-10-14',answers:[1,0]};
    f.put('codes',CODE,old);
    f.put('codes','book_index:L0',['book_2']);f.put('codes','book:book_2',makeStoredBookPack('book_2',{level:'L0',pages:3,sentencesPerPage:1}));
    const before=f.account(), wallet=f.wallet(),id=before.progress.current_pack.pack_id;
    const body={access_code:CODE,collection:'auto',easier_from_pack:id};
    const responses=await Promise.all([f.call('/api/generate-read2lead-pack',body),f.call('/api/generate-read2lead-pack',body)]);
    const data=await Promise.all(responses.map(r=>r.json()));
    assert.deepEqual(responses.map(r=>r.status),[200,200],JSON.stringify(data));
    assert.equal(data[0].pack_id,data[1].pack_id);assert.notEqual(data[0].pack_id,id);
    const after=f.account();assert.equal(after.progress.current_pack.level,'L0');
    assert.equal(after.progress.current_level,'L1');assert.deepEqual(after.student_profile,before.student_profile);
    assert.equal(after.progress.packs_created,before.progress.packs_created+1);
    const paused={...after.story_pack_history[id]};assert.ok(paused.paused_at);delete paused.paused_at;
    assert.deepEqual(paused,before.progress.current_pack);assert.deepEqual(f.wallet(),wallet);
    assert.equal((await f.assign('auto')).status,409);assert.equal(f.account().progress.current_pack.pack_id,data[0].pack_id);
    const read=await f.call(`/api/read2lead-lesson?code=${CODE}&pack_id=${id}`);assert.equal(read.status,200);
  }finally{f.db.close();}
});

test('no easier content and L0 keep current work, account identity and all balances unchanged',async()=>{
  for(const level of ['L0','L1']){
    const f=fixture();try{
      await f.assign('auto');const account=f.account();account.progress.current_pack.level=level;f.put('codes',CODE,account);
      const before=f.account(),wallet=f.wallet();
      const response=await f.call('/api/generate-read2lead-pack',{access_code:CODE,collection:'auto',easier_from_pack:before.progress.current_pack.pack_id});
      assert.ok([409,503].includes(response.status));assert.deepEqual(f.account(),before);assert.deepEqual(f.wallet(),wallet);
    }finally{f.db.close();}
  }
});

test('stale easier requests cannot replace another current lesson',async()=>{
  const f=fixture();try{
    await f.assign('auto');const before=f.account();
    const response=await f.call('/api/generate-read2lead-pack',{access_code:CODE,collection:'auto',easier_from_pack:'someone-elses-pack'});
    assert.equal(response.status,409);assert.deepEqual(f.account(),before);
  }finally{f.db.close();}
});

test('two ordinary book assignment clicks create one pack and spend one credit', async () => {
  const f = fixture();
  try {
    const wallet = f.wallet(); const responses = await Promise.all([f.assign('read2lead'), f.assign('read2lead')]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const assigned = await responses.find(r => r.status === 200).json();
    assert.equal(f.account().uses_remaining, 8); assert.equal(f.account().progress.packs_created, 1);
    assert.equal(f.account().custom_preserved, 'original-account-field'); assert.equal(f.account().progress.review_history[0].pack_id, 'historic-pack');
    assert.deepEqual(f.wallet(), wallet);
    const read = await f.call(`/api/read2lead-lesson?code=${CODE}&pack_id=${assigned.pack_id}`);
    assert.equal(read.status, 200); assert.ok(JSON.stringify(await read.json()).includes('Test Book'));
    const saved = f.snapshot(); f.restart();
    assert.equal((await f.assign('one-story-a-day')).status, 409); assert.deepEqual(f.snapshot(), saved);
  } finally { f.db.close(); }
});

test('book assignment and original shop preserve both account credit and purchased item', async () => {
  const f = fixture();
  try {
    const [assigned, purchase] = await Promise.all([f.assign('read2lead'), f.call('/api/read2lead-shop-buy', { code: CODE, part_id: PART })]);
    assert.equal(assigned.status, 200); assert.equal(purchase.status, 200);
    assert.equal(f.account().uses_remaining, 8); assert.equal(f.account().progress.packs_created, 1);
    assert.equal(f.wallet().diamonds, 2000); (assert.ok(f.wallet().avatar.monster.detail === PART));
  } finally { f.db.close(); }
});

test('adult story assignment pins original lesson payload and resumes without another pack or reward', async () => {
  const f = fixture({ isTest: true });
  try {
    const wallet = f.wallet();
    const responses = await Promise.all([f.assign('one-story-a-day'), f.assign('one-story-a-day')]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    const [first, second] = await Promise.all(responses.map(r => r.json()));
    assert.equal(first.pack_id, second.pack_id); assert.equal(f.account().progress.packs_created, 1); assert.equal(f.account().uses_remaining, 9);
    assert.deepEqual(f.wallet(), wallet);
    const read = await f.call(`/api/read2lead-lesson?code=${CODE}&pack_id=${first.pack_id}`);
    assert.equal(read.status, 200); const lesson = (await read.json()).lesson;
    assert.deepEqual(lesson.story.sentences.map(s => s.text), pkg.lesson.story.sentences.map(s => s.text_en));
    assert.equal(lesson.content_version, pkg.lesson.version); assert.equal(lesson.private_draft, true); assert.equal(lesson.content_complete, false);
    assert.ok(lesson.illustrations.length); assert.ok(lesson.audio.url); assert.equal('questions' in lesson, false);
    const saved = f.account(); f.restart();
    assert.equal((await (await f.assign('read2lead')).json()).pack_id, first.pack_id); assert.deepEqual(f.account(), saved);
    f.catalog.lesson.title_en += 'changed bytes';
    assert.equal((await f.call(`/api/read2lead-lesson?code=${CODE}&pack_id=${first.pack_id}`)).status, 409);
  } finally { f.db.close(); }
});

test('ordinary learners cannot assign an adult draft and cannot enable QA through request fields', async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    const response = await f.call('/api/generate-read2lead-pack', { access_code: CODE, collection: 'one-story-a-day', is_test: true, R2L_PRIVATE_QA: 'adult-isolated' });
    assert.equal(response.status, 409); assert.deepEqual(f.snapshot(), before);
  } finally { f.db.close(); }
});

test('missing book shelf cannot launch external generation or leave a pending lock, even with credentials and client override', async t => {
  const f = fixture({ books: false }); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ ok: true, task_id: 'must-not-run' }); });
  try {
    const before = f.snapshot();
    const response = await f.call('/api/generate-read2lead-pack', { access_code: CODE, collection: 'read2lead', allowExternalGeneration: true });
    assert.equal(response.status, 503); assert.equal((await response.json()).error, 'account_generation_job_not_integrated');
    assert.equal(calls, 0); assert.deepEqual(f.snapshot(), before);
  } finally { f.db.close(); }
});

test('original Pages handler retains its legacy external generation default', async t => {
  const f = fixture({ books: false }); let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(url, 'https://synthetic-provider.invalid/generate-async-v2'); assert.equal(options.method, 'POST');
    return Response.json({ ok: true, task_id: 'synthetic-legacy-job' });
  });
  try {
    const response = await originalGenerate({ env: f.legacyEnv, request: new Request('https://synthetic.test/api/generate-read2lead-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_code: CODE, collection: 'read2lead' }) }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).task_id, 'synthetic-legacy-job'); assert.equal(calls, 1);
    assert.equal(f.account().progress.current_pack.status, 'generation_in_progress'); assert.equal(f.account().uses_remaining, 9);
  } finally { f.db.close(); }
});

test('assignment commit failure leaves account, credit and prior records exact; retry assigns once', async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    f.db.exec(`CREATE TEMP TRIGGER assignment_failure BEFORE INSERT ON read2lead_account_kv WHEN NEW.namespace='codes' AND NEW.key='${CODE}' BEGIN SELECT RAISE(ABORT,'injected assignment failure'); END;`);
    assert.equal((await f.assign('read2lead')).status, 503); assert.deepEqual(f.snapshot(), before);
    f.db.exec('DROP TRIGGER assignment_failure');
    assert.equal((await f.assign('read2lead')).status, 200); assert.equal(f.account().uses_remaining, 8);
    assert.equal((await f.assign('read2lead')).status, 409); assert.equal(f.account().uses_remaining, 8);
  } finally { f.db.close(); }
});


test('exhausted ordinary shelf assigns same-level review once without spending a use or changing balance',async()=>{
 const f=fixture();try{
  const account=f.account();account.completed_books=['book_1'];f.put('codes',CODE,account);
  const before=f.account(),wallet=f.wallet();
  const responses=await Promise.all([f.assign('auto'),f.assign('auto')]);const data=await Promise.all(responses.map(r=>r.json()));
  assert.equal(responses[0].status,200,JSON.stringify(data));assert.equal(data[0].current_pack.review_only,true);assert.match(data[0].lesson_link,/review=1/);
  assert.equal(f.account().progress.packs_created,1);assert.equal(f.account().uses_remaining,before.uses_remaining);assert.deepEqual(f.wallet(),wallet);
  assert.equal(f.account().progress.current_pack.level,'L1');assert.equal(f.account().student_profile.level,'L1');
  assert.equal((await (await f.call('/api/read2lead-lesson?code='+CODE+'&pack_id='+data[0].pack_id)).json()).lesson.review_only,true);
 }finally{f.db.close();}
});
test('server continuation preserves old assignment and one eventual assignment across retries',async()=>{
 const f=fixture({isTest:true});try{
  const get=f.infrastructure.R2L_STORY_CATALOGUE.get;
  f.infrastructure.R2L_STORY_CATALOGUE.get=async key=>key==='index:L1'?[...Array.from({length:20},(_,i)=>({id:'missing-'+i,version:'1'})),{id:f.catalog.lesson.id,version:f.catalog.lesson.version}]:get(key);
  const before=f.account(),wallet=f.wallet();const first=await f.assign('auto');assert.equal(first.status,202);
  assert.deepEqual(f.account().progress,before.progress);assert.equal(f.account().uses_remaining,before.uses_remaining);assert.deepEqual(f.wallet(),wallet);
  assert.ok(f.account().story_selection.offset>=16);
  const results=await Promise.all([f.assign('auto'),f.assign('auto')]);const data=await Promise.all(results.map(r=>r.json()));
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(data[0].pack_id,data[1].pack_id);assert.equal(f.account().progress.packs_created,1);assert.equal(f.account().story_selection,null);
 }finally{f.db.close();}
});


test('ordinary learner prefers released OSAD, switches one level easier, then uses unread original before review',async()=>{
 const f=fixture();try{
  const l1=await fixturePackage(f.catalog.assets);
  f.put('codes','book_index:L0',['book_2']);f.put('codes','book:book_2',makeStoredBookPack('book_2',{level:'L0',pages:3,sentencesPerPage:1}));
  const rows=new Map();for(const p of [l1]){
   rows.set('index:'+p.lesson.level,[{id:p.lesson.id,version:p.lesson.version}]);
   rows.set(`package:${p.lesson.id}@${p.lesson.version}`,{status:'accepted',package:p,assetProofs:p.assets.map(a=>({id:a.id,sha256:a.sha256,bytes:a.bytes,mime:a.mime,decoded:true}))});
  }
  f.infrastructure.R2L_STORY_CATALOGUE.get=async key=>structuredClone(rows.get(key));
  const first=await f.assign('auto'),firstData=await first.json();assert.equal(first.status,200,JSON.stringify(firstData));assert.equal(firstData.current_pack.schema_version,'story-mission-v1');
  const wallet=f.wallet(),before=f.account();
  const easier=await f.call('/api/generate-read2lead-pack',{access_code:CODE,collection:'auto',easier_from_pack:firstData.pack_id}),data=await easier.json();
  assert.equal(easier.status,200,JSON.stringify(data));assert.equal(data.level,'L0');assert.equal(data.current_pack.schema_version,2);
  assert.deepEqual(f.account().student_profile,before.student_profile);assert.deepEqual(f.wallet(),wallet);assert.equal(f.account().story_pack_history[firstData.pack_id].pack_id,firstData.pack_id);
  let account=f.account();account.progress.current_pack=null;account.progress.review_history=[{story_complete:true,story_source_id:l1.lesson.source.source_id,story_id:l1.lesson.id}];f.put('codes',CODE,account);
  const original=await (await f.assign('auto')).json();assert.equal(original.current_pack.schema_version,2);assert.equal(original.current_pack.review_only,false);
  account=f.account();account.completed_books=['book_1'];account.progress.current_pack.status='reviewed_pass_web_v2';f.put('codes',CODE,account);
  const review=await (await f.assign('auto')).json();assert.equal(review.current_pack.schema_version,'story-mission-v1');assert.equal(review.current_pack.review_only,true);assert.match(review.lesson_link,/review=1/);assert.deepEqual(f.wallet(),wallet);
 }finally{f.db.close();}
});
