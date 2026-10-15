import { validatePublisherPackage, publisherReadiness } from './self-learn/publisher-contract.mjs';
import { STORY_MISSION_VERSION } from '../../../src/lib/read2lead-story-mission.mjs';
import { pictureRetellFor } from './picture-retell.mjs';

const identity = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
export const storyCatalogueEnabled = env => ['one-story-a-day', 'combined'].includes(env.R2L_CONTENT_SOURCE);
// An explicit choice wins over the old deployment default. Combined mode keeps
// existing books as the default for clients that do not yet send a collection.
export const usesStoryCatalogue = (env, collection) => collection === 'one-story-a-day'
  || (collection === undefined && env.R2L_CONTENT_SOURCE === 'one-story-a-day');
export const isStoryPack = pack => pack?.schema_version === STORY_MISSION_VERSION;
/** Add missing display metadata in memory only; saved answers are not migrated. */
export async function withStoryRetellRequirement(env, account, pack) {
  if (!isStoryPack(pack) || typeof pack.picture_retell_required === 'boolean') return pack;
  try {
    const loaded = await loadAssignedStory(env, account, pack.story_reference);
    return {...pack,picture_retell_required:Boolean(pictureRetellFor(loaded.pkg.lesson))};
  } catch { return pack; }
}
const fail = code => { throw Object.assign(new Error(code), { code, status: 409 }); };

/** Packages/asset proofs are server-owned. A child cannot make a draft assignable. */
export async function loadAssignedStory(env, codeData, reference, { now = new Date().toISOString() } = {}) {
  if (!env.R2L_STORY_CATALOGUE || !identity(reference?.id) || !identity(reference?.version)) fail('story_catalogue_unavailable');
  const record = await env.R2L_STORY_CATALOGUE.get(`package:${reference.id}@${reference.version}`, { type: 'json' });
  if (!record || !['accepted', 'private-draft'].includes(record.status)) fail('story_unavailable');
  const { package: pkg, package_sha256 } = await validatePublisherPackage(record.package);
  if (pkg.lesson.id !== reference.id || pkg.lesson.version !== reference.version ||
      (reference.sha256 && reference.sha256 !== package_sha256)) fail('story_version_changed');
  const privateDraft = record.status === 'private-draft';
  let contentComplete=false;
  if (privateDraft) {
    if (env.R2L_PRIVATE_QA !== 'adult-isolated' || codeData.is_test !== true) fail('story_not_accepted');
  } else {
    const readiness = await publisherReadiness(pkg, { now, assetProofs: record.assetProofs || [] });
    if (!readiness.publication_ready) fail('story_not_accepted');
    contentComplete=readiness.counts_toward_source_collection===true;
  }
  return { pkg, sha256: package_sha256, privateDraft, contentComplete };
}

export const STORY_SELECTION_BATCH = 16;
export async function selectAssignedStory(env, codeData, level) {
  if (!/^L[0-5]$/.test(level) || !env.R2L_STORY_CATALOGUE) fail('story_catalogue_unavailable');
  const index = await env.R2L_STORY_CATALOGUE.get(`index:${level}`, { type: 'json' });
  if (!Array.isArray(index) || index.length > 1095) fail('story_catalogue_unavailable');
  const archived=[codeData.progress?.current_pack,...Object.values(codeData.story_pack_history||{})];
  const completedRows=[...(codeData.progress?.review_history||[]).filter(row=>row.story_complete===true),
    ...archived.filter(p=>p?.story_complete===true||p?.story_session?.complete===true).map(p=>({story_id:p.story_reference?.id,story_source_id:p.story_reference?.source_id}))];
  const completed = new Set(completedRows.map(row=>row.story_source_id));
  const completedIds = new Set(completedRows.map(row=>row.story_id));
  // Resume only server-stored selection state, bound to this shelf and learning
  // history. A changed release/history restarts the scan; client offsets are ignored.
  const bytes=new TextEncoder().encode(JSON.stringify([level,index,completedRows.map(r=>[r.story_id,r.story_source_id])]));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const prior=codeData.story_selection;
  const valid=prior?.fingerprint===fingerprint&&Number.isSafeInteger(prior.offset)&&prior.offset>=0&&prior.offset<=index.length;
  let offset=valid?prior.offset:0,reviewReference=valid?prior.reviewReference:null,attempts=0;
  for(;offset<index.length;offset++) {
    const reference=index[offset];
    if(!identity(reference?.id)||!identity(reference?.version))continue;
    if(reviewReference&&(completedIds.has(reference.id)||(reference.source_id&&completed.has(reference.source_id))))continue;
    if(attempts>=STORY_SELECTION_BATCH)throw Object.assign(new Error('story_selection_pending'),{
      code:'story_selection_pending',cursor:{fingerprint,offset,reviewReference},status:202});
    attempts++;
    try {
      const loaded=await loadAssignedStory(env,codeData,reference),l=loaded.pkg.lesson;
      if(l.level!==level)continue;
      if(l.source.predecessor_source_id&&!completed.has(l.source.predecessor_source_id))continue;
      if(completed.has(l.source.source_id)||completedIds.has(l.id)) {
        // Retelling still owed is unfinished work, not a no-reward replay.
        const old=[codeData.progress?.current_pack,...Object.values(codeData.story_pack_history||{})]
          .find(p=>p?.story_reference?.source_id===l.source.source_id&&p.story_session?.picture_retell_complete===true);
        if(!reviewReference&&(!pictureRetellFor(l)||old))reviewReference={id:l.id,version:l.version,sha256:loaded.sha256};
        continue;
      }
      return loaded;
    } catch(error) {if(error.code==='story_selection_pending')throw error;}
  }
  throw Object.assign(new Error('story_catalogue_exhausted'),{code:'story_catalogue_exhausted',reviewReference,status:409});
}

export function storyLessonLink(accessCode, pack) {
  const params = new URLSearchParams({ code: accessCode, pack_id: pack.pack_id, mission: STORY_MISSION_VERSION });
  if(pack.review_only===true)params.set('review','1');
  return `/read2lead/lesson?${params}`;
}

export function storyAssignmentPack(loaded, level) {
  const l = loaded.pkg.lesson;
  return { pack_id: crypto.randomUUID(), schema_version: STORY_MISSION_VERSION,
    status: 'story_in_progress', created_at: new Date().toISOString(), level,
    story_title: l.title_en, topic: l.title_en,
    story_reference: { id: l.id, version: l.version, source_id: l.source.source_id, sha256: loaded.sha256 },
    private_draft: loaded.privateDraft, picture_retell_required: Boolean(pictureRetellFor(l)) };
}

/** Only public learning material; rubric, expected answers and review records stay server-side. */
export function storyLessonPayload(pack, loaded) {
  const l = loaded.pkg.lesson;
  const media = id => {
    const asset = loaded.pkg.assets.find(a => a.id === id);
    return asset ? `/api/read2lead-story-media/${asset.object_key}` : null;
  };
  return { schema_version: STORY_MISSION_VERSION, pack_id: pack.pack_id,
    review_only:pack.review_only===true,
    story_id: l.id, content_version: l.version, level: pack.level, title: l.title_en,
    story: { sentences: l.story.sentences.map(s => ({ id: s.id, text: s.text_en })) },
    illustrations: l.illustrations.map(i => ({ url: media(i.asset_id), alt: i.alt_en || l.title_en })),
    audio: { url: media(l.audio.asset_id), status: l.audio.status },
    attribution: l.source.attribution, private_draft: loaded.privateDraft, content_complete: loaded.contentComplete===true };
}
