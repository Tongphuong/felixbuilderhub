import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/pages/read2lead/lesson.astro',import.meta.url),'utf8');
const start=source.indexOf('  function _r2lShowCompletionAfterTrivia(data) {');
const end=source.indexOf("  qs('#trivia-reveal-continue')",start);
function finish(data){
 const nodes=new Map(),effects=[],comboLevels=[];
 const qs=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',prepend(node){this.firstChild=node;},classList:{add(){},remove(){}},scrollIntoView(){}});return nodes.get(id);};
 const document={body:{dataset:{}},dispatchEvent(){throw Error('completion must not promote gift shopping');}};
 const context={document,qs,state:{accessCode:'CHILD & 1'},isW1:()=>true,isBookLesson:()=>true,
  _r2lTriviaState:{},SFX:{},playSfx:()=>effects.push('sound'),playSfxSequence:()=>effects.push('sequence'),
  pickVoiceClip:()=>'',showDiamondTicker:()=>effects.push('diamonds'),showLevelUp:()=>{},showReward:()=>effects.push('reward'),
  window:{__r2lJuice:{showComboBadge:level=>comboLevels.push(level),fireLessonPassConfetti:()=>effects.push('confetti'),showXpTicker:()=>effects.push('xp')},__r2lV3:{showRankUp(){throw Error('retired rank must not be promoted');}}}};
 vm.runInNewContext(source.slice(start,end)+'\n_r2lShowCompletionAfterTrivia(input)',{...context,input:data});
 return {nodes,effects,document,comboLevels};
}
test('completion clears exercise combo feedback for fresh and restored finishes',()=>{
 for(const data of [{rewards_earned:{diamonds:45,xp:20}},{duplicate:true},{already_completed:true},{completed_without_reward:true,review_only:true}]) {
  assert.deepEqual(finish(data).comboLevels,[1], 'finish must hide stale combo before presenting its title');
 }
});
test('fresh original completion shows actual reward and explicit stop/another choices',()=>{
 const f=finish({rewards_earned:{diamonds:25,xp:20}});
 assert.match(f.nodes.get('#completion-copy').textContent,/25/);assert.ok(f.effects.includes('confetti'));
 assert.equal(f.nodes.get('#completion-done').href,'/read2lead/?code=CHILD%20%26%201&done=1');
 assert.equal(f.nodes.get('#completion-new-pack').href,'/read2lead/?code=CHILD%20%26%201');
 assert.equal(f.document.body.dataset.lessonFinished,'true');
 assert.equal(f.nodes.get('#lesson-shell').firstChild,f.nodes.get('#completion-card'));
});
for(const flag of ['duplicate','already_completed'])test(`${flag} restores saved reward without new celebration`,()=>{
 const f=finish({[flag]:true,rewards_earned:{diamonds:25,xp:20}});
 assert.match(f.nodes.get('#completion-copy').textContent,/đã nhận trước đó/);assert.match(f.nodes.get('#completion-copy').textContent,/không cộng thêm/);
 assert.deepEqual(f.effects,[]);assert.ok(f.nodes.get('#completion-done').href.endsWith('&done=1'));
});
test('no-reward review finish stays truthful and quiet',()=>{
 const f=finish({completed_without_reward:true,review_only:true});
 assert.match(f.nodes.get('#completion-copy').textContent,/Bài ôn không cộng thêm thưởng/);assert.deepEqual(f.effects,[]);
});
