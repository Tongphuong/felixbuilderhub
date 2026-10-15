import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  let legacyCalls = 0; const mediaKeys = [];
  const forbidden = new Proxy({}, { get: () => () => { legacyCalls++; throw Error('legacy storage reached'); } });
  const service = createRead2LeadAccountService({ db, transaction, infrastructure: {
    READ2LEAD_CODES: forbidden, READ2LEAD_PROGRESS: forbidden,
    R2L_MEDIA: {
      async get(key, options) {
        mediaKeys.push(key);
        return { body: options?.range ? 'ab' : 'abcd', size: 4,
          ...(options?.range ? { range: { offset: 0, length: 2 } } : {}) };
      },
      put() { throw Error('parent must never write media'); },
    },
  } });
  const put = (namespace, key, value) => db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL)').run(namespace,key,JSON.stringify(value));
  const get = (namespace,key) => JSON.parse(db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(namespace,key).value);
  for (const code of ['PARENT-A','PARENT-B']) {
    put('codes',code,{ is_test:false, student_profile:{student_name:code}, progress:{current_pack:null} });
    put('progress','progress:'+code,{diamonds:270,history:['unchanged']});
  }
  put('codes','portfolio:PARENT-A',[{id:'clip-a',video_key:'private/a.mp4',title:'Saved reading',reactions:{heart:1}}]);
  put('codes','portfolio:PARENT-B',[{id:'clip-b',video_key:'private/b.mp4',title:'Other learner'}]);
  const request = (path, body, headers={}) => service(new Request('https://review.example'+path, {
    method: body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }));
  return {db,get,request,mediaKeys,legacyCalls:()=>legacyCalls};
}

test('ordinary parent portfolio uses saved records, conceals media keys, and keeps concurrent reactions/seen updates',async()=>{
  const f=fixture();
  try {
    const before=f.get('progress','progress:PARENT-A');
    const list=await f.request('/api/parent/portfolio?code=PARENT-A');
    assert.equal(list.status,200);const body=await list.json();
    assert.equal(body.items[0].title,'Saved reading');assert.equal(body.items[0].video_key,undefined);
    assert.equal(body.items[0].video_url,'/api/parent/video?code=PARENT-A&id=clip-a');
    const responses=await Promise.all([
      f.request('/api/parent/portfolio-react',{code:'PARENT-A',id:'clip-a',kind:'heart'}),
      f.request('/api/parent/portfolio-react',{code:'PARENT-A',id:'clip-a',kind:'heart'}),
      f.request('/api/parent/portfolio-seen',{code:'PARENT-A',id:'clip-a'}),
    ]);
    assert.ok(responses.every(response=>response.status===200));
    const saved=f.get('codes','portfolio:PARENT-A')[0];assert.equal(saved.reactions.heart,3);assert.ok(saved.parent_seen_at);
    await f.request('/api/parent/portfolio-seen',{code:'PARENT-A',id:'clip-a'});
    assert.equal(f.get('codes','portfolio:PARENT-A')[0].parent_seen_at,saved.parent_seen_at);
    assert.deepEqual(f.get('progress','progress:PARENT-A'),before);assert.equal(f.legacyCalls(),0);
  } finally {f.db.close();}
});

test('parent cannot read or update another learner video through an owned account',async()=>{
  const f=fixture();
  try {
    const before=f.get('codes','portfolio:PARENT-B');
    for (const route of ['portfolio-react','portfolio-seen']) {
      const response=await f.request('/api/parent/'+route,{code:'PARENT-A',id:'clip-b',kind:'heart'});
      assert.equal(response.status,404);
    }
    assert.equal((await f.request('/api/parent/video?code=PARENT-A&id=clip-b')).status,404);
    assert.equal((await f.request('/api/parent/portfolio?code=MISSING')).status,404);
    assert.equal((await f.request('/api/parent/portfolio-react',{code:'PARENT-A',id:'clip-a',kind:'unknown'})).status,400);
    assert.deepEqual(f.mediaKeys,[]);assert.deepEqual(f.get('codes','portfolio:PARENT-B'),before);assert.equal(f.legacyCalls(),0);
  } finally {f.db.close();}
});

test('owned parent video retains full and range reads through read-only media capability',async()=>{
  const f=fixture();
  try {
    const full=await f.request('/api/parent/video?code=PARENT-A&id=clip-a');
    assert.equal(full.status,200);assert.equal(await full.text(),'abcd');
    const partial=await f.request('/api/parent/video?code=PARENT-A&id=clip-a',undefined,{Range:'bytes=0-1'});
    assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Range'),'bytes 0-1/4');assert.equal(await partial.text(),'ab');
    assert.deepEqual(f.mediaKeys,['private/a.mp4','private/a.mp4']);assert.equal(f.legacyCalls(),0);
  } finally {f.db.close();}
});
