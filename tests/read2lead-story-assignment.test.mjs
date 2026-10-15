import {storyLessonPayload} from '../functions/lib/read2lead/story-catalogue.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/read2lead-self-learn/publisher-package.json' with { type: 'json' };
import { onRequestPost as generate } from '../functions/api/generate-read2lead-pack.js';
import { onRequestGet as lesson } from '../functions/api/read2lead-lesson.js';
import { resolveAccessiblePack } from '../functions/api/_read2lead-pack-access.js';
import { STORY_MISSION_VERSION } from '../src/lib/read2lead-story-mission.mjs';
import { makeStoredBookPack } from './helpers/book-pack-fixture.mjs';

const code = 'ADULT-STORY-QA';
test('automatic selection prefers eligible stories and ordinary accounts fall back without exposing drafts', async () => {
  const adult=setup(); addExistingBooks(adult); adult.env.R2L_CONTENT_SOURCE='combined';
  assert.equal((await assign(adult,'auto')).data.current_pack.schema_version,STORY_MISSION_VERSION);
  const child=setup({isTest:false});addExistingBooks(child);child.env.R2L_CONTENT_SOURCE='combined';
  const wallet=structuredClone(child.codes.rows.get('progress:'+code));
  const selected=await assign(child,'auto');assert.equal(selected.status,200);assert.equal(selected.data.current_pack.schema_version,2);
  assert.deepEqual(child.codes.rows.get('progress:'+code),wallet);
});

test('automatic selection never calls a paid generator when there is no eligible content',async()=>{
  const s=setup({isTest:false});s.env.READ2LEAD_BACKEND_URL='https://provider.invalid';s.env.READ2LEAD_BACKEND_SECRET='synthetic';
  const before=structuredClone(s.codes.rows.get(code));
  const result=await assign(s,'auto');assert.equal(result.status,503);assert.deepEqual(s.codes.rows.get(code),before);
});

test('invalid early catalogue rows do not hide a later suitable story',async()=>{
  const s=setup();s.catalog.rows.set('index:L1',[...Array.from({length:12},(_,i)=>({id:'missing-'+i,version:'1'})),{id:fixture.lesson.id,version:fixture.lesson.version}]);
  assert.equal((await assign(s,'auto')).status,200);
});

test('question completion resumes pending picture retelling without a new assignment',async()=>{
  const s=setup();await assign(s);const pack=s.codes.rows.get(code).progress.current_pack;
  pack.status='reviewed_pass_web_v2';pack.picture_retell_required=true;pack.story_session={complete:true,picture_retell_complete:false};
  const before=structuredClone(s.codes.rows.get(code));const result=await assign(s,'auto');
  assert.equal(result.data.pack_id,pack.pack_id);assert.deepEqual(s.codes.rows.get(code),before);
});
function kv(values) {
  const rows = new Map(Object.entries(structuredClone(values)));
  return { rows, async get(key) { return structuredClone(rows.get(key) ?? null); },
    async put(key, value) { rows.set(key, JSON.parse(value)); } };
}
function setup({ isTest = true, qa = 'adult-isolated', status = 'private-draft', pkg = fixture } = {}) {
  const codes = kv({ [code]: { is_test: isTest, uses_remaining: 10,
    student_profile: { student_name: 'Adult', age: 10, child_gender: 'boy', level: 'L1' },
    completed_books: ['book_1'], avatar: { choice: 'original' },
    progress: { current_level: 'L1', custom_kept: 'keep', review_history: [{ pack_id: 'old', score_percent: 80 }] } },
    ['progress:' + code]: { schema_version: 2, level_reset_version: 20260606, current_level: 'L1',
      initial_level: 'L0', unlocked_levels: ['L0', 'L1'], xp_in_level: 0, total_xp: 100,
      level_progress: { L0: 5, L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 }, completed_packs: 5,
      completed_pack_ids: [], diamonds: 700, coins: 0, streak_days: 0 } });
  const catalog = kv({ 'index:L1': [{ id: pkg.lesson.id, version: pkg.lesson.version }],
    [`package:${pkg.lesson.id}@${pkg.lesson.version}`]: { status, package: pkg } });
  return { codes, catalog, env: { READ2LEAD_CODES: codes, R2L_CONTENT_SOURCE: 'one-story-a-day',
    R2L_STORY_CATALOGUE: catalog, R2L_PRIVATE_QA: qa } };
}
const request = (collection) => new Request('https://qa.example/api/generate-read2lead-pack', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_code: code, collection }) });
async function assign(s, collection) { const r = await generate({ request: request(collection), env: s.env }); return { status: r.status, data: await r.json() }; }

test('normal assignment returns an explicit story contract and preserves account/history without reward', async () => {
  const s = setup(), wallet = structuredClone(s.codes.rows.get('progress:' + code));
  const result = await assign(s); assert.equal(result.status, 200);
  assert.equal(result.data.current_pack.schema_version, STORY_MISSION_VERSION);
  assert.match(result.data.lesson_link, /mission=story-mission-v1/);
  const saved = s.codes.rows.get(code); assert.equal(saved.progress.custom_kept, 'keep');
  assert.equal(saved.avatar.choice, 'original'); assert.deepEqual(saved.completed_books, ['book_1']);
  assert.equal(saved.progress.review_history[0].pack_id, 'old'); assert.equal(saved.uses_remaining, 10);
  assert.deepEqual(s.codes.rows.get('progress:' + code), wallet);
  const again = await assign(s); assert.equal(again.data.pack_id, result.data.pack_id);
  assert.equal(s.codes.rows.get(code).progress.packs_created, 1);
});

for (const options of [{ isTest: false }, { qa: undefined }, { qa: 'false' }, { status: 'accepted' }]) {
  test('draft cannot be assigned outside authorized adult QA: ' + JSON.stringify(options), async () => {
    const s = setup(options); if (Object.hasOwn(options, 'qa')) s.env.R2L_PRIVATE_QA = options.qa;
    const before = structuredClone(s.codes.rows.get(code));
    assert.equal((await assign(s)).status, 409);
    assert.deepEqual(s.codes.rows.get(code), before);
  });
}

test('authenticated lesson reads fixed content without answer keys; edited bytes and other accounts fail', async () => {
  const s = setup(), result = await assign(s);
  const get = access => lesson({ env: s.env, request: new Request(`https://qa.example/api/read2lead-lesson?code=${access}&pack_id=${result.data.pack_id}`) });
  let response = await get(code); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.lesson.private_draft, true); assert.equal(body.lesson.content_complete, false);
  assert.equal(body.lesson.story.sentences.length, fixture.lesson.story.sentences.length);
  assert.equal('questions' in body.lesson, false); assert.equal('retell' in body.lesson, false);
  assert.equal('expected_answer' in body.lesson, false);
  s.codes.rows.set('OTHER', { is_test: true, progress: {} });
  assert.equal((await get('OTHER')).status, 404);
  const stored = s.catalog.rows.get(`package:${fixture.lesson.id}@${fixture.lesson.version}`);
  stored.package.lesson.title_en += ' changed';
  assert.equal((await get(code)).status, 409);
});

test('story cutover preserves old assigned packs and does not use inherited archive properties', async () => {
  const s = setup(); const old = { pack_id: 'old-pack', status: 'reviewed_pass_web_v2', schema_version: 2 };
  s.codes.rows.get(code).progress.current_pack = old;
  assert.equal((await assign(s)).status, 200);
  assert.deepEqual(resolveAccessiblePack(s.codes.rows.get(code), 'old-pack'), old);
  assert.equal(resolveAccessiblePack({ story_pack_history: Object.create({ evil: { pack_id: 'evil' } }) }, 'evil'), null);
});

test('bad or empty catalogue fails closed without backend generation or a pending assignment', async () => {
  for (const value of [null, [], [{ id: '../private', version: '1' }]]) {
    const s = setup(); s.catalog.rows.set('index:L1', value);
    assert.equal((await assign(s)).status, 409); assert.equal(s.codes.rows.get(code).progress.current_pack, undefined);
  }
});

test('completed catalogue entries do not consume the bounded validation attempts', async () => {
  const s=setup();const history=Array.from({length:12},(_,i)=>({story_complete:true,story_id:'finished-'+i,story_source_id:'source-'+i}));
  s.codes.rows.get(code).progress.review_history=history;
  s.catalog.rows.set('index:L1',[...history.map(h=>({id:h.story_id,source_id:h.story_source_id,version:'1.2.1'})),{id:fixture.lesson.id,version:fixture.lesson.version}]);
  assert.equal((await assign(s)).status,200);
});

test('accepted fixture envelopes do not imply completed source content',()=>{
 const payload=storyLessonPayload({pack_id:'test',level:'L1'},{pkg:fixture,privateDraft:false,contentComplete:false});
 assert.equal(payload.private_draft,false);assert.equal(payload.content_complete,false);
 assert.equal(storyLessonPayload({pack_id:'test',level:'L1'},{pkg:fixture,privateDraft:false}).content_complete,false);
});

function addExistingBooks(s) {
  s.env.READ2LEAD_BOOK_LEVELS = 'L1';
  s.env.RNG = () => 0;
  s.codes.rows.set('book_index:L1', ['book_2']);
  s.codes.rows.set('book:book_2', makeStoredBookPack('book_2', { title: 'Existing Book' }));
}

test('combined collection assigns either source and defaults existing clients to old books', async () => {
  for (const collection of [undefined, 'read2lead', 'one-story-a-day']) {
    const s = setup(); addExistingBooks(s); s.env.R2L_CONTENT_SOURCE = 'combined';
    const result = await assign(s, collection);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.current_pack.schema_version, collection === 'one-story-a-day' ? STORY_MISSION_VERSION : 2);
  }
});

test('explicit old-book choice works even under the historical story default', async () => {
  const s = setup(); addExistingBooks(s);
  const result = await assign(s, 'read2lead');
  assert.equal(result.status, 200); assert.equal(result.data.current_pack.schema_version, 2);
});

test('completed story stays readable after assigning an existing book', async () => {
  const s = setup(); addExistingBooks(s); s.env.R2L_CONTENT_SOURCE = 'combined';
  const first = await assign(s, 'one-story-a-day'); assert.equal(first.status, 200);
  const pack = s.codes.rows.get(code).progress.current_pack;
  pack.status = 'reviewed_pass_web_v2'; pack.story_complete = true;
  const saved = structuredClone(pack);
  const second = await assign(s, 'read2lead');
  assert.equal(second.status, 200); assert.equal(second.data.current_pack.schema_version, 2);
  assert.deepEqual(resolveAccessiblePack(s.codes.rows.get(code), first.data.pack_id), saved);
  const response = await lesson({ env: s.env, request: new Request(`https://qa.example/api/read2lead-lesson?code=${code}&pack_id=${first.data.pack_id}`) });
  assert.equal(response.status, 200); assert.equal((await response.json()).lesson.story_id, fixture.lesson.id);
});

test('choosing another collection preserves unfinished books even for adult test accounts', async () => {
  for (const collection of ['read2lead', 'one-story-a-day']) {
    const s = setup(); addExistingBooks(s); s.env.R2L_CONTENT_SOURCE = 'combined';
    const pack = { pack_id: 'unfinished-book', schema_version: 2, status: 'ready', review_context: makeStoredBookPack('book_2') };
    s.codes.rows.get(code).progress.current_pack = pack;
    const before = structuredClone(s.codes.rows.get(code));
    const result = await assign(s, collection);
    assert.equal(result.status, 409); assert.equal(result.data.error, 'previous_pack_needs_review');
    assert.match(result.data.lesson_link, /pack_id=unfinished-book/);
    assert.deepEqual(s.codes.rows.get(code), before);
  }
});

test('choosing old books resumes an unfinished story without replacing it', async () => {
  const s = setup(); addExistingBooks(s); const first = await assign(s);
  const before = structuredClone(s.codes.rows.get(code));
  const result = await assign(s, 'read2lead');
  assert.equal(result.status, 200); assert.equal(result.data.pack_id, first.data.pack_id);
  assert.deepEqual(s.codes.rows.get(code), before);
});

test('invalid and disabled collection requests cannot assign or mutate the account', async () => {
  for (const collection of ['', 'unknown', null, ['one-story-a-day'], {}]) {
    const s = setup(); const before = structuredClone(s.codes.rows.get(code));
    assert.equal((await assign(s, collection)).status, 400);
    assert.deepEqual(s.codes.rows.get(code), before);
  }
  const s = setup(); addExistingBooks(s); delete s.env.R2L_CONTENT_SOURCE;
  const before = structuredClone(s.codes.rows.get(code));
  assert.equal((await assign(s, 'one-story-a-day')).status, 409);
  assert.deepEqual(s.codes.rows.get(code), before);
});
