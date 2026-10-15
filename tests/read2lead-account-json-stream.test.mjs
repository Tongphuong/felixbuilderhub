import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {accountJsonBytes,accountJsonDigest,accountJsonStream} from '../functions/lib/read2lead/account-json-stream.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('snapshot JSON bytes and digest preserve Unicode, escapes, ordering and numeric values',async()=>{
  const values=[null,true,false,0,-0,1e30,Infinity,NaN,[],{},
    {z:'Tiếng Việt 🌏\u0000\n\t"\\',a:'\ud800',b:'\udc00',n:[null,undefined,-0,1.2345678901234567],omitted:undefined},
    ...[16381,16382,16383,16384,65531,65532,65533,65534,65535].map(n=>({text:'x'.repeat(n)+'🌏'+'ế'.repeat(9)}))];
  for(const value of values){
    const expected=Buffer.from(JSON.stringify(value));
    assert.deepEqual(Buffer.concat([...accountJsonBytes(value)]),expected);
    assert.equal(accountJsonDigest(value),digest(expected));
    assert.equal(await new Response(accountJsonStream(value)).text(),expected.toString());
  }
});

test('backup larger than RPC limit streams bounded chunks with native JSON checksum',async()=>{
  const value={records:Array.from({length:600},(_,i)=>({key:'synthetic-'+i,value:'Ā'+'x'.repeat(60000)+'🌏'}))};
  const expected=Buffer.from(JSON.stringify(value));assert.ok(expected.length>32*1024*1024);
  const reader=accountJsonStream(value).getReader(),hash=createHash('sha256');let total=0,chunks=0;
  for(;;){const next=await reader.read();if(next.done)break;assert.ok(next.value.length<=65536);hash.update(next.value);total+=next.value.length;chunks++;}
  assert.equal(total,expected.length);assert.equal(hash.digest('hex'),digest(expected));assert.ok(chunks>500);
  assert.equal(accountJsonDigest(value),digest(expected));
});

test('canceling an export closes its reader without consuming the remaining document',async()=>{
  const stream=accountJsonStream({records:Array.from({length:50},()=>({value:'x'.repeat(100000)}))});
  const reader=stream.getReader();assert.equal((await reader.read()).done,false);await reader.cancel();
  assert.equal((await reader.read()).done,true);
});

test('reader-supplied buffers receive all bytes and a completed final read',async()=>{
  const value={text:'Tiếng Việt 🌏'.repeat(10000)},reader=accountJsonStream(value).getReader({mode:'byob'}),chunks=[];
  let timer;
  try{
    await Promise.race([(async()=>{
      for(;;){const next=await reader.read(new Uint8Array(7919));if(next.done)break;chunks.push(Buffer.from(next.value));}
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('stream_end_timeout')),2000);})]);
    assert.deepEqual(Buffer.concat(chunks),Buffer.from(JSON.stringify(value)));
  }finally{clearTimeout(timer);await reader.cancel();}
});
