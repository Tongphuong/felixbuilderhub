/** Private operator workflow. Never mount these bundles on a learner route. */
import {createHash} from 'node:crypto';
import {publisherCatalogueMembership} from './read2lead-publisher-catalogue.mjs';
import {canonical} from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import {validatePublisherPackage,publisherReadiness} from '../../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {planPublisherImport,applyPublisherImport,verifyPublisherAsset,publisherStoreDigest} from './read2lead-publisher-import.mjs';

const requireThat=(ok,code)=>{if(!ok)throw Error(code);};
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const editorial=new Set(['text','activities','visual','audio_match','audio_listening','audio_timing']);
const fields=['kind','package_sha256','status','reviewer','method','evidence_ref','reviewed_at'];
function reviewSnapshot(input){
 requireThat(input&&[Object.prototype,null].includes(Object.getPrototypeOf(input))&&Object.getOwnPropertySymbols(input).length===0,'invalid_review_record');
 const props=Object.getOwnPropertyDescriptors(input);
 requireThat(Object.keys(props).length===fields.length&&fields.every(k=>props[k]?.enumerable&&Object.hasOwn(props[k],'value')&&typeof props[k].value==='string'),'invalid_review_record');
 return Object.fromEntries(fields.map(k=>[k,props[k].value]));
}
function rowFor(db,{source_id,version}){
 const row=db.prepare('SELECT * FROM publisher_packages WHERE source_id=? AND version=?').get(source_id,version);
 requireThat(row,'unknown_publisher_version');return row;
}
async function checkedRow(row){
 const {package:pkg,package_sha256}=await validatePublisherPackage(JSON.parse(row.package_json));
 requireThat(package_sha256===row.content_sha256&&digest(pkg)===row.package_sha256&&pkg.lesson.source.source_id===row.source_id&&pkg.lesson.version===row.version&&pkg.lesson.id===row.lesson_id,'publisher_store_integrity');
 return pkg;
}
/** Full answer keys and rights records are intentional here: this is a private operator bundle. */
export async function publisherReviewBundle(db,target,{assetRoot,now}={}){
 const before=publisherStoreDigest(db),row=rowFor(db,target),pkg=await checkedRow(row),proofs=[],asset_checks=[];
 for(const asset of pkg.assets){
  try{const proof=verifyPublisherAsset(asset,assetRoot);proofs.push(proof);asset_checks.push({id:asset.id,status:'decoded',sha256:asset.sha256});}
  catch(error){asset_checks.push({id:asset.id,status:'needs_correction',error:['asset_decode_failed','asset_stream_missing','asset_codec_mismatch','asset_dimensions_mismatch','asset_duration_mismatch','asset_hash_mismatch','asset_size_or_type','asset_mime_mismatch','asset_path_refused','symlink_path_refused'].includes(error.message)?error.message:'asset_unavailable'});}
 }
 const readiness=await publisherReadiness(pkg,{now,assetProofs:proofs});
 requireThat(publisherStoreDigest(db)===before,'stale_review_snapshot');
 if(row.state==='withdrawn'){readiness.blockers.push('withdrawn_version');readiness.publication_ready=false;readiness.counts_toward_source_collection=false;}
 const stale_reviews=pkg.reviews.filter(r=>r.package_sha256!==row.content_sha256||Date.parse(r.reviewed_at)>Date.parse(now)).map(r=>r.kind);
 const correction=pkg.reviews.some(r=>r.status==='needs_correction')||stale_reviews.length>0||asset_checks.some(a=>a.status==='needs_correction');
 let state=row.state==='withdrawn'?'withdrawn':correction?'needs_correction':readiness.publication_ready&&pkg.reviews.every(r=>r.status==='approved')?'approved':readiness.technical_ready?'verified':'draft';
 const catalogue=publisherCatalogueMembership(db,{source_id:row.source_id,version:row.version,content_sha256:row.content_sha256});
 if(state==='approved'&&catalogue.ever_published)state='published';
 return {format:'r2l-private-publisher-review/1',visibility:'private_operator_only',source_id:row.source_id,version:row.version,package_sha256:row.package_sha256,content_sha256:row.content_sha256,state,package:pkg,asset_checks,stale_reviews,readiness,catalogue,publication:state==='published'?'private_local_catalogue':'not_performed',production_release_authorized:false,
  audit:db.prepare('SELECT id,kind,payload_json FROM publisher_events WHERE source_id=? AND version=? ORDER BY id').all(row.source_id,row.version).map(r=>({id:r.id,kind:r.kind,...JSON.parse(r.payload_json)}))};
}
/** Caller supplies the exact package checksum shown in the inspected bundle. */
export async function planPublisherReview(db,{source_id,version,expected_package_sha256,reviews},{assetRoot,now}={}){
 const before=publisherStoreDigest(db),row=rowFor(db,{source_id,version});
 requireThat(row.state!=='withdrawn','withdrawn_version');
 requireThat(row.package_sha256===expected_package_sha256,'stale_review_package');
 requireThat(Array.isArray(reviews)&&reviews.length>0&&reviews.length<=10,'invalid_review_batch');
 const changes=reviews.map(reviewSnapshot);
 requireThat(new Set(changes.map(r=>r.kind)).size===changes.length,'duplicate_review');
 for(const review of changes){
  requireThat(review.package_sha256===row.content_sha256,'stale_review_content');
  requireThat(Number.isFinite(Date.parse(now))&&Number.isFinite(Date.parse(review.reviewed_at))&&Date.parse(review.reviewed_at)<=Date.parse(now),'invalid_review_time');
  requireThat(!review.kind.startsWith('human_')||review.method==='human','human_review_required');
  requireThat(!editorial.has(review.kind)||review.method!=='automated','editorial_review_required');
  requireThat(review.reviewer.trim()&&review.evidence_ref.trim(),'review_evidence_required');
 }
 const pkg=await checkedRow(row),byKind=new Map(pkg.reviews.map(r=>[r.kind,r]));
 for(const review of changes)byKind.set(review.kind,review);
 pkg.reviews=[...byKind.values()].sort((a,b)=>a.kind.localeCompare(b.kind));
 const imported=await planPublisherImport(db,[pkg],{assetRoot,now});
 requireThat(publisherStoreDigest(db)===before,'stale_review_snapshot');
 const plan={format:'r2l-publisher-review-plan/1',source_id,version,expected_package_sha256,changes,package:pkg,import_plan:imported.plan,import_plan_sha256:imported.plan_sha256};
 return {plan,plan_sha256:digest(plan),readiness:imported.readiness[0],writes:0,publication:'not_performed'};
}
export async function applyPublisherReview(db,{plan,plan_sha256},{assetRoot,now,commit=work=>work()}={}){
 requireThat(plan?.format==='r2l-publisher-review-plan/1'&&digest(plan)===plan_sha256,'invalid_review_plan');
 // Validate the saved plan through the same input path before its first application.
 // A durable receipt allows exact retries after subsequent reviews or withdrawal.
 const receipt=db.prepare('SELECT result_json FROM publisher_receipts WHERE plan_sha256=?').get(plan.import_plan_sha256);
 if(!receipt){
  requireThat(publisherStoreDigest(db)===plan.import_plan.store_sha256,'stale_store_plan');
  const fresh=await planPublisherReview(db,{source_id:plan.source_id,version:plan.version,expected_package_sha256:plan.expected_package_sha256,reviews:plan.changes},{assetRoot,now});
  requireThat(digest(fresh.plan.package)===digest(plan.package),'invalid_review_plan');
 }
 requireThat(plan.package.lesson.source.source_id===plan.source_id&&plan.package.lesson.version===plan.version,'invalid_review_plan');
 const result=await applyPublisherImport(db,[plan.package],{plan:plan.import_plan,plan_sha256:plan.import_plan_sha256,assetRoot,now,commit});
 const current=await publisherReviewBundle(db,{source_id:plan.source_id,version:plan.version},{assetRoot,now});
 return {format:'r2l-publisher-review-result/1',replayed:Boolean(receipt),result,current,learner_writes:0,publication:'not_performed'};
}
