import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PrivateStoryStore} from '../scripts/lib/read2lead-story-store.mjs';
import {initializeSyntheticTarget} from '../scripts/read2lead-local-qa.mjs';
const lesson=JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json',import.meta.url))).lesson;
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-award-')),data=path.join(root,'data');initializeSyntheticTarget(data);
 const store=new PrivateStoryStore(data);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const prepare=(version=lesson.version)=>{const l={...lesson,version};let s=store.open('test-owner',l);const send=event=>s=store.event('test-owner',l,{sessionId:s.sessionId,revision:s.revision,requestId:'step-'+s.revision,event}).state;
 send({type:'read_complete'});for(const q of l.questions)send({type:'answer',taskId:q.id,optionIndex:q.correct_index});return s;};
 const manifest={schemaVersion:'story-mission-v1',storyId:lesson.source.source_id,contentVersion:lesson.version,tasks:[{id:'meaning',kind:'understand',criteria:['meaning-1']},{id:'retell',kind:'retell',criteria:['fact-1','fact-2']}],recallTask:{id:'recall',criteria:['recall-1']}};
 const attempt={storyId:manifest.storyId,contentVersion:manifest.contentVersion,readComplete:true,answers:manifest.tasks.map(t=>({taskId:t.id,responseId:'response-'+t.id,modality:'spoken',reliability:'confirmed',support:'none',matchedCriteria:t.criteria}))};
 return{store,data,prepare,manifest,attempt};
}
test('receipt, assessed progress and test balance persist atomically; duplicate/revision cannot farm',t=>{
 const s=setup(t),state=s.prepare();const first=s.store.commitTrustedAssessment('test-owner',state.sessionId,s.manifest,s.attempt,1000);
 assert.deepEqual(first.award,{diamonds:1000,xp:20});
 const other=new PrivateStoryStore(s.data);try{
 const duplicate=other.commitTrustedAssessment('test-owner',state.sessionId,s.manifest,s.attempt,1001);assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.award,{diamonds:0,xp:0});
 const next=s.prepare('1.2.2'),revision=other.commitTrustedAssessment('test-owner',next.sessionId,{...s.manifest,contentVersion:'1.2.2'},{...s.attempt,contentVersion:'1.2.2'},1002);
 assert.deepEqual(revision.testBalance,{diamonds:1000,xp:20});assert.equal(other.db.prepare('SELECT COUNT(*) AS n FROM story_assessed_progress').get().n,2);
 }finally{other.close();}
});
test('forced failure after wallet write rolls back balance, receipt and progress together',t=>{
 const s=setup(t),state=s.prepare();
 s.store.db.exec("CREATE TRIGGER reject_test_progress BEFORE INSERT ON story_assessed_progress BEGIN SELECT RAISE(ABORT,'injected_write_failure'); END");
 assert.throws(()=>s.store.commitTrustedAssessment('test-owner',state.sessionId,s.manifest,s.attempt,1000),/injected_write_failure/);
 assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_assessed_progress').get().n,0);
 s.store.db.exec('DROP TRIGGER reject_test_progress');assert.equal(s.store.commitTrustedAssessment('test-owner',state.sessionId,s.manifest,s.attempt,1001).award.diamonds,1000);
});
test('another owner, unbound source and uncertain evidence cannot obtain an award',t=>{
 const s=setup(t),state=s.prepare();
 assert.throws(()=>s.store.commitTrustedAssessment('intruder',state.sessionId,s.manifest,s.attempt,1000),/not_found/);
 assert.throws(()=>s.store.commitTrustedAssessment('test-owner',state.sessionId,{...s.manifest,storyId:'other'},s.attempt,1000),/mismatch/);
 const attempt=structuredClone(s.attempt);attempt.answers[1].reliability='uncertain';attempt.answers[1].matchedCriteria=[];
 const r=s.store.commitTrustedAssessment('test-owner',state.sessionId,s.manifest,attempt,1000);assert.equal(r.assessment.status,'retry_technical');assert.deepEqual(r.award,{diamonds:0,xp:0});
});
