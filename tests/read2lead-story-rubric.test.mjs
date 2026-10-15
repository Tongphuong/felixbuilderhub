import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { storyRubric, validateStoryJudgment, savedStoryAttempt } from '../functions/lib/read2lead/story-rubric.mjs';
import { assessStoryMission } from '../functions/lib/read2lead/story-assessment.mjs';

// Authored synthetic lesson. These tests check the contract, not AI accuracy.
const fixture=()=>JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json',import.meta.url))).lesson;

test('retell and delayed recall include declared order/causality with stable fact IDs',()=>{
  const lesson=fixture(),rubric=storyRubric(lesson),retell=rubric.tasks.at(-1);
  assert.deepEqual(retell.criteria.map(c=>c.id),['fact-1','fact-2','fact-3','order-causality']);
  assert.deepEqual(rubric.recallTask.criteria,retell.criteria);
  assert.deepEqual(retell.acceptedParaphrases,lesson.retell.accepted_paraphrases);
  assert.notEqual(retell.acceptedParaphrases,lesson.retell.accepted_paraphrases);
  assert.deepEqual(rubric.recallTask.acceptedParaphrases,retell.acceptedParaphrases);
  assert.deepEqual(rubric.manifest.tasks.at(-1).criteria,retell.criteria.map(c=>c.id));
  assert.deepEqual(rubric.manifest.recallTask.criteria,rubric.manifest.tasks.at(-1).criteria);
  assert.equal(retell.criteria.some(c=>/intelligibility|support_used/.test(c.id)),false);
  assert.equal(JSON.stringify(rubric.manifest).includes(lesson.retell.essential_facts[0].quote),false);
});

test('order is taken from source sentences; editorial fact IDs and input remain unchanged',()=>{
  const lesson=fixture();lesson.retell.essential_facts.reverse();const before=structuredClone(lesson);
  const task=storyRubric(lesson).tasks.at(-1),meaning=task.criteria.at(-1).meaning;
  assert.equal(task.criteria[0].meaning,lesson.retell.essential_facts[0].quote);
  const facts=[...lesson.retell.essential_facts].reverse();
  assert.ok(meaning.indexOf(facts[0].quote)<meaning.indexOf(facts[1].quote));
  assert.ok(meaning.indexOf(facts[1].quote)<meaning.indexOf(facts[2].quote));
  assert.deepEqual(lesson,before);
});

test('per-fact accepted meaning changes wording without changing criteria, scores or source evidence',()=>{
 const lesson=fixture(),before=structuredClone(lesson),old=storyRubric(lesson);
 lesson.retell.essential_facts[1].accepted_meanings=['The narrator wonders whether the sky is always blue.','The narrator thinks the sky is always blue.'];
 const rubric=storyRubric(lesson),retell=rubric.tasks.at(-1),meaning=lesson.retell.essential_facts[1].accepted_meanings[0];
 assert.deepEqual(retell.criteria[1].acceptedMeanings,lesson.retell.essential_facts[1].accepted_meanings);
 assert.notEqual(retell.criteria[1].acceptedMeanings,lesson.retell.essential_facts[1].accepted_meanings);
 assert.equal(retell.criteria[1].meaning,meaning);assert.equal(retell.criteria[0].meaning,old.tasks.at(-1).criteria[0].meaning);
 assert.equal(retell.criteria.at(-1).meaning.includes(meaning),true);assert.deepEqual(rubric.manifest,old.manifest);
 assert.equal(lesson.retell.essential_facts[1].quote,before.retell.essential_facts[1].quote);assert.deepEqual(rubric.recallTask.criteria,retell.criteria);
 assert.equal(before.retell.essential_facts[1].accepted_meanings,undefined);
});

test('a lesson without that dimension is not silently given another criterion',()=>{
  const lesson=fixture();lesson.retell.dimensions=lesson.retell.dimensions.filter(d=>d!=='order_causality');
  assert.deepEqual(storyRubric(lesson).tasks.at(-1).criteria.map(c=>c.id),['fact-1','fact-2','fact-3']);
});

test('the new criterion requires explicit literal learner evidence, never a fabricated quote',()=>{
  const task=storyRubric(fixture()).tasks.at(-1),transcript='First she puts the cup on the table. Then she finds it and waters her plant.';
  const raw={reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:transcript}))};
  assert.equal(validateStoryJudgment(raw,task,transcript).matchedCriteria.includes('order-causality'),true);
  const missing=structuredClone(raw);missing.criteria.pop();
  assert.throws(()=>validateStoryJudgment(missing,task,transcript),/invalid_semantic_judgment/);
  const fabricated=structuredClone(raw);fabricated.criteria.at(-1).quote='Words the learner did not say';
  assert.throws(()=>validateStoryJudgment(fabricated,task,transcript),/unsupported_semantic_evidence/);
  const uncertain=structuredClone(raw);uncertain.reliability='uncertain';
  assert.throws(()=>validateStoryJudgment(uncertain,task,transcript),/unsupported_semantic_evidence/);
});

test('saved evidence includes the declared dimension without changing approved 50 percent policy',()=>{
  const lesson=fixture(),{manifest}=storyRubric(lesson);
  const state={readComplete:true,answers:manifest.tasks.map(task=>({taskId:task.id,responseId:'response-'+task.id,support:'none',
    semantic:{reliability:'confirmed',matchedCriteria:[...task.criteria]}}))};
  let saved=savedStoryAttempt(lesson,state),assessment=assessStoryMission(saved.manifest,saved.attempt);
  assert.equal(assessment.retellPercent,100);assert.equal(assessment.reward.grade,'S');
  state.answers.at(-1).semantic.matchedCriteria=['fact-1'];
  saved=savedStoryAttempt(lesson,state);assessment=assessStoryMission(saved.manifest,saved.attempt);
  assert.equal(assessment.retellPercent,25);assert.equal(assessment.status,'needs_practice');
  state.answers.at(-1).semantic.matchedCriteria=['fact-1','fact-2'];
  saved=savedStoryAttempt(lesson,state);assessment=assessStoryMission(saved.manifest,saved.attempt);
  assert.equal(assessment.retellPercent,50);assert.equal(assessment.status,'complete');
  // This approved partial-credit policy is not a claim that every fact was told.
});

test('missing essential fact cannot receive the complete order/causality point',()=>{
  const lesson=fixture(),rubric=storyRubric(lesson),task=rubric.tasks.at(-1);
  // Matched-ID pattern observed in CR074's real, unassessed provider report.
  // Raw provider quotes were not retained: this is a reconstructed schema input.
  const transcript='My uncle sends me a picture of a blue sky. He is happy. I ask if the sky is always blue. He sends the sky in his city and often pray because there are too many cars. That is why he is excited about the blue sky.';
  const raw={reliability:'confirmed',replySupport:'hint',criteria:task.criteria.map(c=>({id:c.id,met:c.id!=='fact-3',quote:c.id==='fact-3'?'':transcript}))};
  const before=structuredClone(raw),result=validateStoryJudgment(raw,task,transcript);
  assert.deepEqual(result,{reliability:'confirmed',matchedCriteria:['fact-1','fact-2'],replySupport:'hint'});
  assert.deepEqual(raw,before,'provider record is not rewritten');
  // Same partial-credit policy: two of four retell criteria earns A with all
  // comprehension criteria met, not S from the contradictory extra point.
  const state={readComplete:true,answers:rubric.manifest.tasks.map(t=>({taskId:t.id,responseId:'response-'+t.id,support:'none',
    semantic:t.kind==='retell'?result:{reliability:'confirmed',matchedCriteria:[...t.criteria]}}))};
  const saved=savedStoryAttempt(lesson,state),assessment=assessStoryMission(saved.manifest,saved.attempt);
  assert.equal(assessment.retellPercent,50);assert.equal(assessment.reward.grade,'A');
  assert.equal(assessment.reward.diamonds,800);assert.equal(assessment.reward.xp,20);
  const recall=validateStoryJudgment(raw,rubric.recallTask,transcript);
  assert.deepEqual(recall.matchedCriteria,['fact-1','fact-2']);
});

test('complete facts preserve explicitly demonstrated order and never invent it',()=>{
  const task=storyRubric(fixture()).tasks.at(-1),transcript='An own-word answer with evidence supplied by the assessor.';
  const judgment=omit=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:c.id!==omit,quote:c.id===omit?'':transcript}))});
  assert.deepEqual(validateStoryJudgment(judgment(null),task,transcript).matchedCriteria,task.criteria.map(c=>c.id));
  assert.deepEqual(validateStoryJudgment(judgment('order-causality'),task,transcript).matchedCriteria,['fact-1','fact-2','fact-3']);
  for(const id of ['fact-1','fact-2','fact-3']) {
    assert.equal(validateStoryJudgment(judgment(id),task,transcript).matchedCriteria.includes('order-causality'),false);
  }
});
