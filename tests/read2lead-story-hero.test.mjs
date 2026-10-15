import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHeroCta,statusMeta,bookPct} from '../src/lib/r2l-hero.ts';
import {STORY_MISSION_VERSION} from '../src/lib/read2lead-story-mission.mjs';
test('profile resumes a story with the exact reader contract and safely encoded IDs',()=>{
 const cta=buildHeroCta({pack_id:'id/&',schema_version:STORY_MISSION_VERSION},{state:'ready'},'code &');
 const url=new URL(cta.href,'https://qa.example');assert.equal(cta.action,'lesson');
 assert.equal(url.searchParams.get('mission'),STORY_MISSION_VERSION);
 assert.equal(url.searchParams.get('code'),'code &');assert.equal(url.searchParams.get('pack_id'),'id/&');
});
test('legacy profiles retain the old reader; completed packs offer the next assignment',()=>{
 const legacy=buildHeroCta({pack_id:'legacy',schema_version:2},{state:'ready'},'code');
 assert.equal(new URL(legacy.href,'https://qa.example').searchParams.has('mission'),false);
 assert.equal(buildHeroCta({pack_id:'story',schema_version:STORY_MISSION_VERSION,status:'reviewed_pass_web_v2'},{state:'reviewed'},'code').action,'create');
});

test('story journey starts at zero and cannot show complete for skipped retelling',()=>{
 const pack={schema_version:STORY_MISSION_VERSION,status:'story_in_progress'};
 assert.equal(bookPct(statusMeta('ready',pack).step),0);
 assert.equal(bookPct(statusMeta('ready',{...pack,story_session:{stage:'understand'}}).step),33);
 assert.equal(bookPct(statusMeta('ready',{...pack,story_session:{stage:'reward',complete:false}}).step),67);
 assert.equal(bookPct(statusMeta('ready',{...pack,story_session:{stage:'reward',complete:true}}).step),100);
});
