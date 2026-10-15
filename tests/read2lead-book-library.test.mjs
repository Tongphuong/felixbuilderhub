import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {validateBookLibrary,libraryRange,bookLibraryMedia,libraryPublicView} from '../functions/lib/read2lead/book-library.mjs';
import {createPreviewApp} from '../cloudflare/read2lead-private-preview/app.mjs';
import {PrivateStoryStore} from '../scripts/lib/read2lead-story-store.mjs';
import {initializeSyntheticTarget} from '../scripts/read2lead-local-qa.mjs';
import {fixtureAssets,fixturePackage} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex'),pdf=hash('abcdefghij'),mp3=hash('sound'),part1=hash('abcd'),part2=hash('efghij');
function fixture(){return {format:'read2lead-book-library-v1',books:[{id:'c1-b01',collection:1,month:1,pdf,pages:1,tracks:[{day:1,title:'Track 1',media:mp3}]}],media:{[pdf]:{bytes:10,mime:'application/pdf',parts:[{hash:part1,bytes:4},{hash:part2,bytes:6}]},[mp3]:{bytes:5,mime:'audio/mpeg',parts:[{hash:mp3,bytes:5}]}},counts:{books:1,recordings:1}};}
const request=(range,method='GET',id=pdf)=>new Request('https://test.example/api/read2lead-library-media/'+id,{method,headers:range?{Range:range}:{}});
test('streams original bytes and exact ranges across part boundaries, including suffix and HEAD',async()=>{
 const data=new Map([[part1,'abcd'],[part2,'efghij'],[mp3,'sound']]);let reads=0;
 const assets={fetch:async req=>{reads++;assert.equal(req.headers.get('cookie'),null);return new Response(data.get(new URL(req.url).pathname.split('/').at(-1).slice(0,-4)));}};
 for(const [range,expected] of [[null,'abcdefghij'],['bytes=2-7','cdefgh'],['bytes=-3','hij'],['bytes=4-','efghij'],['bytes=0-0','a'],['bytes=8-999','ij']]){const r=await bookLibraryMedia(request(range),fixture(),assets);assert.equal(r.status,range?206:200);assert.equal(r.headers.get('Content-Length'),String(expected.length));assert.equal(await r.text(),expected);}
 const before=reads;const head=await bookLibraryMedia(request('bytes=2-7','HEAD'),fixture(),assets);assert.equal(head.headers.get('Content-Range'),'bytes 2-7/10');assert.equal(await head.text(),'');assert.equal(reads,before);
});
test('invalid paths, ranges, mutation verbs and corrupt manifests are refused',async()=>{
 const assets={fetch:()=>{throw Error('must not fetch');}};
 for(const range of ['bytes=-0','bytes=20-30','bytes=9-4','bytes=0-1,4-6','bytes=','items=1-2','bytes=9007199254740993-'])assert.equal((await bookLibraryMedia(request(range),fixture(),assets)).status,416);
 assert.equal((await bookLibraryMedia(request(null,'POST'),fixture(),assets)).status,405);
 assert.equal((await bookLibraryMedia(request(null,'GET','not-a-hash'),fixture(),assets)).status,404);
 assert.equal((await bookLibraryMedia(new Request(request().url+'?download=1'),fixture(),assets)).status,404);
 assert.equal(libraryRange('bytes=1-2',10).start,1);assert.equal(validateBookLibrary(fixture()).books.length,1);
 for(const mutate of [v=>v.media[pdf].parts[0].hash='../secret',v=>v.media[pdf].bytes=11,v=>v.books[0].pdf=mp3,v=>v.books.push(v.books[0]),v=>v.media[pdf].parts[0].bytes=0]){const v=fixture();mutate(v);assert.throws(()=>validateBookLibrary(v));}
});
test('truncated or unavailable storage never returns a silently shortened success body',async()=>{
 for(const response of [new Response('a'),new Response('',{status:404})]){const r=await bookLibraryMedia(request(),fixture(),{fetch:async()=>response});await assert.rejects(r.text());}
});
test('public catalogue excludes source paths, private part keys and arbitrary metadata',()=>{
 const v=fixture();v.books[0].source='/private/source.pdf';v.books[0].tracks[0].secret='private';v.counts.secret='private';
 const text=JSON.stringify(libraryPublicView(v));assert.ok(text.includes('/api/read2lead-library-media/'));assert.equal(text.includes('private'),false);assert.equal(text.includes(part1),false);
});
test('existing authentication gates catalogue and media; manifest checksum is enforced',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'book-library-'));initializeSyntheticTarget(root+'/state');const store=new PrivateStoryStore(root+'/state');t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const pkg=await fixturePackage(fixtureAssets(root));
 const lib=JSON.stringify(fixture()),manifest=JSON.stringify({format:'read2lead-private-cloud-preview-v1',existingSite:true,package:pkg,publicAssets:[],scriptHashes:[],librarySha256:hash(lib)});let corrupt=false;
 const app=createPreviewApp({store,accessKey:'fabricated-private-key-1234567890123456789',packageSha256:hash(manifest),assets:{fetch:async req=>new Response(new URL(req.url).pathname.endsWith('book-library.json')?(corrupt?'{}':lib):manifest)}});
 assert.equal((await app(new Request('https://test.example/api/read2lead-library'))).status,401);
 assert.equal((await app(request())).status,401);
 const login=await app(new Request('https://test.example/private-rehearsal/login',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_secret:'fabricated-private-key-1234567890123456789'})}));assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
 corrupt=true;assert.equal((await app(new Request('https://test.example/api/read2lead-library',{headers:{Cookie:cookie}}))).status,503);
 corrupt=false;const response=await app(new Request('https://test.example/api/read2lead-library',{headers:{Cookie:cookie}}));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await response.json()).counts.books,1);
 assert.equal((await app(new Request('https://test.example/__private/book-library.json',{headers:{Cookie:cookie}}))).status,404);
});
function storyFixture(){const v=fixture();v.books[0].pages=68;v.stories=Array.from({length:31},(_,i)=>({id:`c1-b01-s${String(i+1).padStart(2,'0')}`,bookId:'c1-b01',number:i+1,title:'Story '+(i+1),pages:[6+i*2,7+i*2],pageStatus:'present',audio:i===0?[mp3]:[]}));return v;}
test('individual stories expose only their reviewed pages and own recording; missing material stays explicit',()=>{
 const v=storyFixture();v.stories[1].pages=[];v.stories[1].pageStatus='missing_from_scan';v.stories[0].evidence='/private/review.json';validateBookLibrary(v);
 const pub=libraryPublicView(v);assert.equal(pub.stories.length,31);assert.deepEqual(pub.stories[0].pages,[6,7]);assert.deepEqual(pub.stories[0].audio,['/api/read2lead-library-media/'+mp3]);assert.deepEqual(pub.stories[1].pages,[]);assert.deepEqual(pub.stories[1].audio,[]);assert.equal(pub.counts.readableStories,30);assert.equal(pub.counts.storiesWithAudio,1);assert.equal(JSON.stringify(pub).includes('/private/'),false);
});
test('wrong-story audio, duplicate pages, omitted days, out-of-book pages and corrupt identities fail closed',()=>{
 for(const mutate of [v=>v.stories[1].audio=[mp3],v=>v.stories[1].pages=[6,7],v=>v.stories.pop(),v=>v.stories[0].pages=[68,69],v=>v.stories[0].pages=[6,8],v=>v.stories[0].number=32,v=>v.stories[0].bookId='c2-b01',v=>v.stories[0].title='',v=>v.stories[0].pages=[],v=>v.stories[0].id='../secret']){const v=storyFixture();mutate(v);assert.throws(()=>validateBookLibrary(v));}
});
