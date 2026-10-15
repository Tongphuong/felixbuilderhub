import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPublisherStore,verifyPublisherAsset,withdrawPublisherVersion} from '../scripts/lib/read2lead-publisher-import.mjs';
import * as catalogue from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {createSyntheticPublisherRuntime,createPublishedSyntheticRuntime} from '../scripts/lib/read2lead-publisher-runtime.mjs';
import {fixtureAssets,fixturePackage,fixtureNow,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-capacity-')),filename=path.join(root,'publisher.sqlite'),db=openPublisherStore(filename,{create:true});t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});catalogue.initializePublisherCatalogue(db);return{root,filename,db,assets:fixtureAssets(root),options:{assetRoot:root,now:fixtureNow}};}
test('capacity: 2190 versions retain 1095 distinct synthetic lessons and exact old versions',async t=>{
 const s=setup(t),packages=[];for(let revision=1;revision<=2;revision++)for(let c=1;c<=3;c++)for(let i=0;i<365;i++)packages.push(await fixturePackage(s.assets,{collection:c,index:i,revision}));
 const started=performance.now(),runtime=await createSyntheticPublisherRuntime({mode:'synthetic-local',packages,assetProofs:s.assets.map(a=>verifyPublisherAsset(a,s.root)),readAsset:key=>fs.readFileSync(path.join(s.root,key))});
 const lessons=runtime.catalogue();assert.equal(lessons.length,1095);assert.ok(lessons.every(l=>l.version==='1.2.2'));assert.equal(runtime.packageFor(packages[0].lesson).lesson.version,'1.2.1');assert.equal(runtime.packageFor(packages.at(-1).lesson).lesson.version,'1.2.2');
 t.diagnostic('CAPACITY_METRICS '+JSON.stringify({scenario:'2190 synthetic versions; two shared assets; no real content',runtime_build_ms:Math.round(performance.now()-started),lessons:lessons.length,versions:packages.length}));
});
test('durable 1095-story catalogue with two versions loads and reads cards without full-state hashing per card',async t=>{
 const s=setup(t),versions=[[],[]];for(let revision=1;revision<=2;revision++)for(let c=1;c<=3;c++)for(let i=0;i<365;i++)versions[revision-1].push(await fixturePackage(s.assets,{collection:c,index:i,revision}));
 await seedFixturePackages(s.db,versions.flat());const ids=[];
 for(const packages of versions){const plan=await catalogue.planPublisherCatalogue(s.db,{targets:packages.map(p=>({source_id:p.lesson.source.source_id,version:p.lesson.version})),operator:'Synthetic benchmark',reason:'Synthetic benchmark only'},s.options);ids.push((await catalogue.applyPublisherCatalogue(s.db,plan,s.options)).catalogue_id);}
 const start=performance.now(),runtime=await createPublishedSyntheticRuntime({mode:'synthetic-local',db:s.db,assetRoot:s.root,now:()=>fixtureNow}),loadMs=performance.now()-start;
 const warm=performance.now(),lessons=runtime.catalogue(),cards=lessons.map(l=>runtime.card(l)),warmMs=performance.now()-warm;
 assert.equal(cards.length,1095);assert.equal(new Set(cards.map(c=>c.id)).size,1095);assert.equal(runtime.packageFor(versions[0][0].lesson).lesson.version,'1.2.1');assert.ok(warmMs<5000,'synthetic metadata regression ceiling; not a browser performance SLO');
 const other=openPublisherStore(s.filename);try{withdrawPublisherVersion(other,{source_id:versions[0][0].lesson.source.source_id,version:'1.2.1',reason:'Synthetic external-connection withdrawal',now:fixtureNow});assert.throws(()=>runtime.packageFor(versions[0][0].lesson),/content_unavailable/);}finally{other.close();}
 await runtime.refresh();assert.equal(runtime.catalogue().length,1095);assert.throws(()=>runtime.packageFor(versions[0][0].lesson),/content_unavailable/);
 t.diagnostic('CAPACITY_METRICS '+JSON.stringify({scenario:'private catalogue; 2190 synthetic versions; two shared assets',load_ms:Math.round(loadMs),catalogue_and_1095_cards_ms:Math.round(warmMs),heap_mb:Math.round(process.memoryUsage().heapUsed/1048576),real_lessons:0}));
});
test('change stamp detects same-connection rollback and other-connection writes; missing head refuses',async t=>{
 const s=setup(t),before=catalogue.publisherCatalogueStamp(s.db);s.db.exec('BEGIN');s.db.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('synthetic_rollback','{}');s.db.exec('ROLLBACK');assert.notEqual(catalogue.publisherCatalogueStamp(s.db),before);
 const own=catalogue.publisherCatalogueStamp(s.db),other=openPublisherStore(s.filename);try{other.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('synthetic_external','{}');assert.notEqual(catalogue.publisherCatalogueStamp(s.db),own);}finally{other.close();}
 s.db.exec('DELETE FROM publisher_catalogue_head');assert.throws(()=>catalogue.publisherCatalogueHead(s.db),/publisher_catalogue_integrity/);
});
