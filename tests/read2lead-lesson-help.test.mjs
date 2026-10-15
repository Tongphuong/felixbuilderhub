import test from 'node:test';
import assert from 'node:assert/strict';
import {createLessonAssignmentAction,originalLessonBusy} from '../src/scripts/read2lead-lesson-help.mjs';

test('mounting an assignment action does nothing; busy recording cannot send or navigate',async()=>{
  let calls=0,navigations=0;
  const action=createLessonAssignmentAction({code:'CHILD',packId:'saved',origin:'https://example.test',isBusy:()=>true,request:async()=>{calls++;},navigate:()=>navigations++});
  assert.equal(calls,0);await assert.rejects(action({easier:true}),/ghi âm/);
  assert.equal(calls,0);assert.equal(navigations,0);
});
test('easier action pins old assignment and rejects concurrent duplicate locally',async()=>{
  let resolve,sent,navigated,leaves=0;
  const action=createLessonAssignmentAction({code:'CHILD',packId:'saved',origin:'https://example.test',request:async(url,options)=>{
    sent=JSON.parse(options.body);return new Promise(r=>resolve=r);
  },beforeLeave:()=>leaves++,navigate:url=>navigated=url});
  const first=action({easier:true});await assert.rejects(action({easier:true}),/ghi âm/);
  resolve(Response.json({ok:true,lesson_link:'/read2lead/lesson?pack_id=easier'}));await first;
  assert.deepEqual(sent,{access_code:'CHILD',collection:'auto',easier_from_pack:'saved'});
  assert.equal(leaves,1);assert.equal(navigated,'https://example.test/read2lead/lesson?pack_id=easier');
});
test('failed request keeps current page and can retry without inventing success',async()=>{
  let tries=0,moved=0;
  const action=createLessonAssignmentAction({code:'CHILD',packId:'saved',origin:'https://example.test',request:async()=>{
    if(++tries===1)throw new TypeError('offline');return Response.json({ok:false,message:'Không có truyện dễ hơn'},{status:409});
  },navigate:()=>moved++});
  await assert.rejects(action({easier:true}),/Mất kết nối/);await assert.rejects(action({easier:true}),/Không có/);assert.equal(moved,0);
});
test('another story requires explicit call and cannot navigate off origin',async()=>{
  let sent,moved=0;
  const action=createLessonAssignmentAction({code:'CHILD',origin:'https://example.test',request:async(_,options)=>{
    sent=JSON.parse(options.body);return Response.json({ok:true,lesson_link:'https://other.test/read2lead/lesson'});
  },navigate:()=>moved++});
  await assert.rejects(action(),/Chưa mở/);assert.deepEqual(sent,{access_code:'CHILD',collection:'auto'});assert.equal(moved,0);
});
test('legacy recorder busy states block support navigation',()=>{
  for(const state of ['recording','checking','warming','processing','stopping','requesting']){
    assert.equal(originalLessonBusy({querySelector:selector=>selector.includes(`[data-rec-state="${state}"]`)?{}:null}),true);
  }
  assert.equal(originalLessonBusy({querySelector:()=>null}),false);
});

test('one explicit action follows bounded server selection without sending client offsets',async()=>{
 let calls=0,moved=0;const bodies=[];
 const action=createLessonAssignmentAction({code:'CHILD',origin:'https://example.test',request:async(_url,options)=>{
   bodies.push(JSON.parse(options.body));return ++calls<3?Response.json({ok:true,status:'selecting'},{status:202}):Response.json({ok:true,lesson_link:'/read2lead/lesson?pack_id=saved'});
 },navigate:()=>moved++});
 await action();assert.equal(calls,3);assert.equal(moved,1);assert.ok(bodies.every(b=>JSON.stringify(b)===JSON.stringify({access_code:'CHILD',collection:'auto'})));
});

test('easier assignment waits for confirmed checkpoint and blocks duplicate while saving',async()=>{
 let release;const order=[];const saved=new Promise(r=>release=r);
 const action=createLessonAssignmentAction({code:'CHILD',packId:'original',origin:'https://example.test',
  prepareSwitch:async()=>{order.push('save');await saved;order.push('confirmed');},
  request:async()=>{order.push('assign');return Response.json({ok:true,lesson_link:'/read2lead/lesson?pack_id=easier'});},navigate:()=>order.push('navigate')});
 const pending=action({easier:true});assert.deepEqual(order,['save']);
 await assert.rejects(action({easier:true}),/ghi âm/);release();await pending;
 assert.deepEqual(order,['save','confirmed','assign','navigate']);
});
test('failed pre-switch checkpoint preserves current assignment and permits a retry',async()=>{
 let saves=0,assignments=0,moved=0;
 const action=createLessonAssignmentAction({code:'CHILD',packId:'original',origin:'https://example.test',prepareSwitch:async()=>{if(++saves===1)throw Error('save failed');},request:async()=>{assignments++;return Response.json({ok:true,lesson_link:'/read2lead/lesson?pack_id=easier'});},navigate:()=>moved++});
 await assert.rejects(action({easier:true}),/save failed/);assert.equal(assignments,0);assert.equal(moved,0);
 await action({easier:true});assert.equal(assignments,1);assert.equal(moved,1);
});
test('explicit next-story action does not try to checkpoint an already completed lesson',async()=>{
 const action=createLessonAssignmentAction({code:'CHILD',origin:'https://example.test',prepareSwitch:()=>{throw Error('wrong checkpoint');},request:async()=>Response.json({ok:true,lesson_link:'/read2lead/lesson?pack_id=next'}),navigate:()=>{}});
 await action();
});
