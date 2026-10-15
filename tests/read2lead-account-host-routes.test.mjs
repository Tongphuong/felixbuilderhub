import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRead2LeadAccountService} from '../functions/lib/read2lead/account-service.mjs';
import {createAccountTransactionRunner} from '../functions/lib/read2lead/account-transactions.mjs';
import {accountMediaEffects} from '../functions/lib/read2lead/account-media-effects.mjs';
import {ACCOUNT_ROUTES} from '../functions/lib/read2lead/account-routes.mjs';

const CODE='R2L-HOST-SYNTHETIC',ADMIN='synthetic-admin',BACKEND='synthetic-backend',DEBUG='synthetic-debug';
function fixture(t,{media=true,ai=true}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const events=[];
 const transaction=fn=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');events.push('commit');return result;}catch(e){db.exec('ROLLBACK');events.push('rollback');throw e;}};
 const objects=new Map([['gifts/old.png','old gift'],['portfolio/old.mp4','old video'],['homework/class-one/hp_abcdefghijkl.png','photo']]);
 let onPut=null,onDelete=null,providerCalls=0,legacyCalls=0;
 const bucket={async put(key,value){events.push('put:'+key);if(onPut)await onPut(key);objects.set(key,await value.text());},async delete(key){events.push('delete:'+key);if(onDelete)await onDelete(key);objects.delete(key);},async get(key){events.push('get:'+key);const value=objects.get(key);if(value===undefined)return null;return{body:value,size:value.length,httpMetadata:{contentType:'image/png'},arrayBuffer:async()=>new TextEncoder().encode(value).buffer};}};
 const forbidden=new Proxy({},{get:()=>()=>{legacyCalls++;throw Error('legacy store forbidden');}});
 const infrastructure={ADMIN_PASSWORD:ADMIN,READ2LEAD_BACKEND_SECRET:BACKEND,DEBUG_SPEAKING_KEY:DEBUG,TURNSTILE_SECRET_KEY:'synthetic-turnstile',READ2LEAD_CODES:forbidden,READ2LEAD_PROGRESS:forbidden,...(media?{R2L_MEDIA:bucket}:{}),...(ai?{AI:{async run(){providerCalls++;return{response:'{"tasks":[]}' };}}}:{})};
 const options={db,transaction,infrastructure};const service=createRead2LeadAccountService(options),run=createAccountTransactionRunner(options);
 const put=(key,value,namespace='codes')=>db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(namespace,key,JSON.stringify(value));
 const get=(key,namespace='codes')=>{const row=db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(namespace,key);return row?JSON.parse(row.value):null;};
 put(CODE,{is_test:false,student_profile:{student_name:'Minh',age:9,level:'L1'},progress:{current_level:'L1',current_pack:null,review_history:[{pack_id:'saved'}]}});
 put('progress:'+CODE,{diamonds:270,completed_packs:1},'progress');
 put('portfolio:'+CODE,[{id:'old',video_key:'portfolio/old.mp4',title:'Preserved video'}]);
 put('config:gifts:v1',{schema_version:1,gifts:[{id:'sticker',name_vi:'Sticker',active:true,price_diamonds:10,image_key:'gifts/old.png'}]});
 put('admin:classes:v1',{classes:[{id:'class-one',name:'Class one',student_codes:[CODE]}]});
 put('debug:speaking-errors',[{message:'saved failure'}]);put('debug:convo-flags',[{kind:'saved'}]);
 const snapshot=()=>db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all().map(row=>({...row}));
 const call=(route,{body,method,admin=true,headers={}}={})=>service(new Request('https://ordinary.test'+route,{method:method||(body===undefined?'GET':'POST'),headers:{'CF-Connecting-IP':'192.0.2.25',...(admin?{Authorization:'Basic '+btoa('founder:'+ADMIN)}:{}),...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})}));
 const gift=()=>{const form=new FormData();form.set('gift_id','sticker');form.set('image',new Blob(['replacement'],{type:'image/png'}),'gift.png');return form;};
 const video=()=>{const form=new FormData();form.set('access_code',CODE);form.set('title','New reading');form.set('note_vi','Saved feedback');form.set('video',new Blob(['new video'],{type:'video/mp4'}),'reading.mp4');return form;};
 const failCommit=()=>db.exec("CREATE TRIGGER fail_commit BEFORE UPDATE ON read2lead_account_revision BEGIN SELECT RAISE(ABORT,'injected_commit_failure'); END");
 return{db,transaction,run,put,get,call,gift,video,failCommit,snapshot,events,objects,bucket,infrastructure,onPut:fn=>onPut=fn,onDelete:fn=>onDelete=fn,providerCalls:()=>providerCalls,legacyCalls:()=>legacyCalls};
}

test('every former pending route is classified and original admin/secret gates still precede effects',async t=>{
 assert.equal(ACCOUNT_ROUTES.filter(r=>r.state==='pending').length,0);
 const f=fixture(t),before=f.snapshot();
 for(const path of ['/api/admin/portfolio','/api/admin/portfolio/upload','/api/admin/portfolio/old','/api/admin/gifts/upload','/api/admin/classes/class-one/homework-photo','/api/admin/classes/class-one/homework-extract','/api/admin/classes/class-one/homework-photo-extract']){
  assert.equal((await f.call(path,{admin:false,body:{}})).status,401,path);
 }
 for(const path of ['/api/debug-speaking?key=wrong','/api/debug-convo-flags?key=wrong'])assert.equal((await f.call(path,{admin:false})).status,404);
 assert.equal((await f.call('/api/publish-read2lead-book',{body:{activate_only:true,level:'L1'},admin:false})).status,401);
 assert.deepEqual(f.snapshot(),before);assert.ok(f.events.every(event=>event==='commit'));assert.equal(f.providerCalls(),0);assert.equal(f.legacyCalls(),0);
});

test('saved admin portfolio/debug and backend activation operate on authoritative records only',async t=>{
 const f=fixture(t);
 const portfolio=await f.call('/api/admin/portfolio?code='+CODE);assert.equal(portfolio.status,200);assert.equal((await portfolio.json()).items[0].title,'Preserved video');
 assert.equal((await (await f.call('/api/debug-speaking?key='+DEBUG)).json()).errors[0].message,'saved failure');
 assert.equal((await f.call('/api/debug-convo-flags?key='+DEBUG)).status,200);
 const r=await f.call('/api/publish-read2lead-book',{body:{activate_only:true,level:'L1'},headers:{'X-Read2Lead-Secret':BACKEND}});assert.equal(r.status,200);assert.deepEqual(f.get('config:book_levels'),['L1']);
 assert.equal(f.get('progress:'+CODE,'progress').diamonds,270);assert.equal(f.legacyCalls(),0);
});

test('gift replacement deletes old bytes only after the replacement record commits',async t=>{
 const f=fixture(t);f.onDelete(key=>{if(key==='gifts/old.png')assert.notEqual(f.get('config:gifts:v1').gifts[0].image_key,key);});
 const r=await f.call('/api/admin/gifts/upload',{body:f.gift()});assert.equal(r.status,200);const image=(await r.json()).image_key;
 assert.equal(f.get('config:gifts:v1').gifts[0].image_key,image);assert.equal(f.objects.get(image),'replacement');assert.equal(f.objects.has('gifts/old.png'),false);
 assert.ok(f.events.indexOf('commit')<f.events.indexOf('delete:gifts/old.png'));assert.equal(f.get('progress:'+CODE,'progress').diamonds,270);
});

for(const type of ['gift','video'])test(`failed ${type} metadata commit compensates new upload and preserves every prior record/object`,async t=>{
 const f=fixture(t);const before=f.snapshot();f.failCommit();
 const r=await f.call(type==='gift'?'/api/admin/gifts/upload':'/api/admin/portfolio/upload',{body:type==='gift'?f.gift():f.video()});assert.equal(r.status,503);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.objects.get('gifts/old.png'),'old gift');assert.equal(f.objects.get('portfolio/old.mp4'),'old video');
 const uploaded=f.events.find(x=>x.startsWith('put:')).slice(4);assert.equal(f.objects.has(uploaded),false);assert.ok(f.events.includes('delete:'+uploaded));
});

test('concurrent gift replacements keep the last committed image and preserve unrelated records',async t=>{
 const f=fixture(t);const results=await Promise.all([f.call('/api/admin/gifts/upload',{body:f.gift()}),f.call('/api/admin/gifts/upload',{body:f.gift()})]);
 assert.deepEqual(results.map(r=>r.status),[200,200]);const images=await Promise.all(results.map(r=>r.json()));assert.notEqual(images[0].image_key,images[1].image_key);
 assert.equal(f.get('config:gifts:v1').gifts[0].image_key,images[1].image_key);assert.equal(f.objects.get(images[1].image_key),'replacement');assert.equal(f.objects.has(images[0].image_key),false);assert.equal(f.objects.get('portfolio/old.mp4'),'old video');
});

test('portfolio upload remains parent-readable, and deletion is deferred until SQL commit',async t=>{
 const f=fixture(t);const r=await f.call('/api/admin/portfolio/upload',{body:f.video()});assert.equal(r.status,201);const entry=(await r.json()).entry;
 const parent=await (await f.call('/api/parent/portfolio?code='+CODE)).json();assert.equal(parent.items[0].id,entry.id);assert.equal(parent.items[0].video_key,undefined);
 f.onDelete(key=>assert.ok(!f.get('portfolio:'+CODE).some(x=>x.video_key===key)));
 assert.equal((await f.call('/api/admin/portfolio/'+entry.id+'?code='+CODE,{method:'DELETE'})).status,200);assert.equal(f.objects.has(entry.video_key),false);assert.equal(f.objects.get('portfolio/old.mp4'),'old video');
});

test('failed portfolio-delete commit cannot delete media; later storage failure reports committed removal honestly',async t=>{
 const f=fixture(t);f.failCommit();
 assert.equal((await f.call('/api/admin/portfolio/old?code='+CODE,{method:'DELETE'})).status,503);assert.equal(f.get('portfolio:'+CODE)[0].id,'old');assert.equal(f.objects.has('portfolio/old.mp4'),true);assert.ok(!f.events.some(x=>x.startsWith('delete:')));
 f.db.exec('DROP TRIGGER fail_commit');f.onDelete(()=>{throw Error('synthetic R2 failure');});
 const r=await f.call('/api/admin/portfolio/old?code='+CODE,{method:'DELETE'});assert.equal(r.status,502);assert.equal((await r.json()).error,'storage_error');assert.deepEqual(f.get('portfolio:'+CODE),[]);assert.equal(f.objects.has('portfolio/old.mp4'),true);
});

test('media referenced by another escaped legacy record survives cleanup',async t=>{
 const f=fixture(t);f.db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL)').run('codes','historic-media','{"video_key":"portfolio\\/old.mp4"}');
 assert.equal((await f.call('/api/admin/portfolio/old?code='+CODE,{method:'DELETE'})).status,200);assert.equal(f.objects.has('portfolio/old.mp4'),true);
 const effects=accountMediaEffects({db:f.db,bucket:f.bucket});await assert.rejects(effects.media.put('portfolio/old.mp4',new Blob(['bad'])),/already_referenced/);await effects.finish(false);await assert.rejects(effects.media.put('new',new Blob(['bad'])),/invalid_account_media_operation/);
});

test('revision change while uploading refuses stale metadata and cleans only the new object',async t=>{
 const f=fixture(t);f.onPut(async()=>{const r=await f.run(async env=>{await env.READ2LEAD_CODES.put('changed-concurrently','true');return Response.json({ok:true});});assert.equal(r.status,200);});
 const r=await f.call('/api/admin/gifts/upload',{body:f.gift()});assert.equal(r.status,409);assert.equal(f.get('config:gifts:v1').gifts[0].image_key,'gifts/old.png');assert.equal(f.objects.get('gifts/old.png'),'old gift');
 const uploaded=f.events.find(x=>x.startsWith('put:')).slice(4);assert.equal(f.objects.has(uploaded),false);assert.equal(f.get('changed-concurrently'),true);
});

test('homework photo upload/read and existing extraction preserve class and wallet records',async t=>{
 const f=fixture(t);const originalClass=f.get('admin:classes:v1');const form=new FormData();form.set('photo',new Blob(['new photo'],{type:'image/png'}),'photo.png');
 const upload=await f.call('/api/admin/classes/class-one/homework-photo',{body:form});assert.equal(upload.status,201);const key=(await upload.json()).photo.r2_key;
 const read=await f.call('/api/admin/classes/class-one/homework-photo?key='+key);assert.equal(read.status,200);assert.equal(await read.text(),'new photo');
 assert.equal((await f.call('/api/admin/classes/class-one/homework-photo?key=portfolio/old.mp4')).status,404);
 assert.equal((await f.call('/api/admin/classes/class-one/homework-extract',{body:{lesson_text:'A short lesson'}})).status,200);
 assert.equal((await f.call('/api/admin/classes/class-one/homework-photo-extract',{body:{r2_key:key}})).status,200);
 assert.ok(f.providerCalls()>=2);assert.deepEqual(f.get('admin:classes:v1'),originalClass);assert.equal(f.get('progress:'+CODE,'progress').diamonds,270);
});

test('sign-up remains disabled by default and retains verification before minting an ordinary personal link',async t=>{
 const f=fixture(t);let verificationCalls=0;let approved=false;
 t.mock.method(globalThis,'fetch',async url=>{verificationCalls++;assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json({success:approved});});
 const body={student_name:'New Reader',student_age:9,child_gender:'boy',turnstile_token:'synthetic-token'};
 assert.equal((await f.call('/api/signup',{body,admin:false})).status,503);assert.equal(verificationCalls,0);
 f.put('config:signup_enabled',true);const before=f.snapshot();assert.equal((await f.call('/api/signup',{body,admin:false})).status,403);assert.deepEqual(f.snapshot(),before);
 approved=true;const response=await f.call('/api/signup',{body,admin:false});assert.equal(response.status,200);const result=await response.json();assert.ok(result.code);assert.ok(f.get(result.code));
 const token=new URL(result.link).searchParams.get('t');assert.ok(token);const linked=await f.call('/api/r2l-link?token='+token,{admin:false});assert.equal(linked.status,200);assert.equal((await linked.json()).access_code,result.code);assert.equal(f.legacyCalls(),0);
});

test('sign-up SQL failure leaves no partial account, token or quota reservation',async t=>{
 const f=fixture(t);f.put('config:signup_enabled',true);const before=f.snapshot();f.failCommit();
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true}));
 const response=await f.call('/api/signup',{body:{student_name:'New Reader',student_age:9,child_gender:'boy',turnstile_token:'synthetic-token'},admin:false});
 assert.equal(response.status,503);assert.deepEqual(f.snapshot(),before);
});

test('permission change during external verification rejects stale sign-up before committing an account',async t=>{
 const f=fixture(t);f.put('config:signup_enabled',true);
 t.mock.method(globalThis,'fetch',async()=>{const r=await f.run(async env=>{await env.READ2LEAD_CODES.put('config:signup_enabled','false');return new Response('ok');});assert.equal(r.status,200);return Response.json({success:true});});
 const before=f.snapshot();
 const response=await f.call('/api/signup',{body:{student_name:'New Reader',student_age:9,child_gender:'boy',turnstile_token:'synthetic-token'},admin:false});
 assert.equal(response.status,409);assert.equal(f.get('config:signup_enabled'),false);assert.equal(f.snapshot().length,before.length);assert.equal(f.get('progress:'+CODE,'progress').diamonds,270);
});
