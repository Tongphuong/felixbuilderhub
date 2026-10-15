/** Synthetic test data only. Repeated story/media are deliberate load fixtures, never real lessons. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fixture from './publisher-package.json' with {type:'json'};
import {publisherDigest,validatePublisherPackage} from '../../../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {canonical} from '../../../src/lib/read2lead/self-learn/session-contract.mjs';
export const fixtureNow='2026-09-20T12:00:00.000Z';
export const fixtureDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function fixtureAssets(root){
 const png=path.join(root,'temporary.png');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=navy:s=16x16','-frames:v','1','-threads','1',png]);
 const wav=Buffer.alloc(128044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 return [['image',fs.readFileSync(png),'png'],['audio',wav,'wav']].map(([kind,bytes,ext])=>{const sha=createHash('sha256').update(bytes).digest('hex'),object_key=sha+'.'+ext;fs.writeFileSync(path.join(root,object_key),bytes);return{id:'synthetic-'+kind,kind,sha256:sha,bytes:bytes.length,mime:kind+'/'+ext,object_key,width:kind==='image'?16:0,height:kind==='image'?16:0,duration_seconds:kind==='audio'?8:0,provenance:'synthetic_fixture',reference_hashes:[],character_ids:[],alt_en:'Synthetic load-test media; not approved content'};});
}
export async function fixturePackage(assets,{collection=1,index=0,revision=1}={}){
 const p=structuredClone(fixture),l=p.lesson,version='1.2.'+revision;
 l.id=`synthetic-load-c${collection}-s${index}`;l.title_en=`Synthetic load ${collection}/${index}/${revision}`;
 Object.assign(l.source,{source_id:l.id+'-source',collection_id:'synthetic-collection-'+collection,collection_level:collection,edition_id:'synthetic-edition-'+collection,book_id:`synthetic-book-${collection}-${Math.floor(index/31)+1}`,month:Math.floor(index/31)+1,story_number:index%31+1,title_as_printed:l.title_en});
 l.version=version;l.audio.content_version=version;l.questions.forEach(q=>q.version=version);l.independent_followup.version=version;p.assets=structuredClone(assets);
 l.illustrations=[{id:'synthetic-scene',kind:'raster',asset_id:'synthetic-image',alt_en:'Synthetic pattern',sentence_ids:['s1']}];l.audio.asset_id='synthetic-audio';l.audio.status='reviewed';l.audio.segments=l.shadowing.sentence_ids.map((id,i)=>({id:'segment-'+i,sentence_ids:[id],start_seconds:i,end_seconds:i+1}));l.review.author_check='complete';
 p.rights=[{id:'synthetic-grant',source_id:l.source.source_id,document_sha256:'a'.repeat(64),actions:['digital_text','activities','illustrations','stream_recording','translation'],valid_from:'2026-01-01T00:00:00.000Z',valid_until:'2027-01-01T00:00:00.000Z',status:'granted',territory:'Synthetic test only',platform:'Read2Lead',reviewer:'Synthetic test'}];
 const hash=await publisherDigest(p);p.reviews=['text','activities','visual','audio_decode','audio_match','audio_listening','audio_timing','rights','human_teaching','human_art'].map(kind=>({kind,package_sha256:hash,status:'approved',reviewer:'Synthetic test only; no human review performed',method:kind.startsWith('human_')?'human':'codex_editorial',evidence_ref:'synthetic-test-only',reviewed_at:'2026-01-01T00:00:00.000Z'}));return p;
}
/** Isolated test seeding avoids thousands of duplicate decoder runs; not import acceptance evidence. */
export async function seedFixturePackages(db,packages){
 const rows=[];for(const p of packages){const checked=await validatePublisherPackage(p);rows.push([p.lesson.source.source_id,p.lesson.version,p.lesson.id,checked.package_sha256,fixtureDigest(p),JSON.stringify(p),'{}','draft']);}
 db.exec('BEGIN');try{const insert=db.prepare('INSERT INTO publisher_packages VALUES(?,?,?,?,?,?,?,?)');for(const row of rows)insert.run(...row);db.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('synthetic_test_seed',JSON.stringify({count:rows.length,real_lessons:0}));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
