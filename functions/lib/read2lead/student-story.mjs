import {loadAssignedStory} from './story-catalogue.mjs';
import {studentVoiceConfiguration} from './student-voice.mjs';
import {verifiedLessonCatalogue} from './private-voice.mjs';

const identity=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** The caller supplies the checksum-verified, immutable deployment manifest.
 * References do not confer publication approval: the existing publisher gate
 * validates every listed package. No HTTP input, draft promotion or data write.
 */
export async function studentStoryConfiguration({manifest,store,env,now=()=>new Date()}) {
  const release=manifest.studentRelease;
  if(!release)return null;
  if(release.format!=='read2lead-student-release-v1'||!Array.isArray(release.records)||
    release.records.length>4380)return null;
  const records=new Map(),pins=new Map(),indexes=new Map(),selected=new Set(),seen=new Set();
  for(const reference of release.records){
    if(!identity(reference?.id)||!identity(reference.version)||!hash(reference.sha256)||
      reference.status!=='accepted'||!Array.isArray(reference.assetProofs))return null;
    const key=`package:${reference.id}@${reference.version}`;
    if(seen.has(key))return null;
    seen.add(key);
    const bundled=manifest.content.storyValue(key);
    if(!bundled?.package)continue;
    const record={status:'accepted',package:bundled.package,assetProofs:structuredClone(reference.assetProofs)};
    let loaded;
    try{
      loaded=await loadAssignedStory({R2L_STORY_CATALOGUE:{get:async()=>record}}, {}, reference,{now:now().toISOString()});
    }catch{continue;}
    records.set(key,record);
    pins.set(key,loaded.sha256);
    const lesson=loaded.pkg.lesson;
    if(!selected.has(lesson.id)){
      selected.add(lesson.id);
      if(selected.size>1095)return null;
      if(!indexes.has(lesson.level))indexes.set(lesson.level,[]);
      indexes.get(lesson.level).push({id:lesson.id,version:lesson.version,source_id:lesson.source.source_id});
    }
  }
  const catalogue={async get(key){
    return structuredClone(key.startsWith('index:')?indexes.get(key.slice(6))||[]:records.get(key)||null);
  }};
  const lessonCatalogue=await verifiedLessonCatalogue(release).catch(()=>null);
  const voice=await studentVoiceConfiguration({store,env,now,packageSha256:manifest.sourcePackageSha256,
    lessonCatalogue,approvedGrant:release.approvedGrant});
  // Reading saved, still-accepted work does not depend on fresh voice funding.
  return {catalogue,voiceConfig:voice.config,canAssign:lesson=>{
    const key=`package:${lesson?.id}@${lesson?.version}`;
    const verified=lessonCatalogue?.lessons.find(l=>l.id===lesson?.id&&l.version===lesson?.version);
    return !!verified&&pins.has(key)&&verified.packageSha256===pins.get(key)&&voice.canAssign(lesson);
  }};
}
