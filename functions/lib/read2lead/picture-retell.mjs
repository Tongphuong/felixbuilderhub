import {isStoryInterview} from '../../../src/lib/read2lead-story-mission.mjs';

export const PICTURE_RETELL_TASK='picture-retell-v1';
export const PICTURE_RETELL_DIAMONDS=200;
export const PICTURE_RETELL_SECONDS=120;
const SOURCE='osad-51fda697ea22c07a08f16b8f-s01';
const facts=[
  ['sent','The uncle sends the narrator a picture.','Bức ảnh chú gửi'],
  ['sky','The picture shows a blue sky and white clouds.','Bầu trời xanh và mây trắng'],
  ['happy','The uncle feels happy or excited to see the blue sky.','Niềm vui của chú'],
  ['wonder','The narrator wonders whether the sky is always blue, or thinks it is always blue.','Điều bạn nhỏ thắc mắc'],
  ['city','The sky in the uncle’s city is often grey because there are too many cars.','Bầu trời xám và xe cộ trong thành phố'],
];

const skyFrames=[[14,6,582,460],[611,6,470,460],[1095,6,562,460],[14,480,706,445],[735,480,922,445]]
  .map(([x,y,width,height])=>({x,y,width,height}));

/** Only explicitly authored, validated OSAD interview packages opt in. Keep
 * already assigned Sky1.2.8 unchanged, including its original grading facts. */
export function pictureRetellFor(lesson) {
  if(!isStoryInterview(lesson))return null;
  const p=lesson.picture_retell;
  if(p&&p.version===PICTURE_RETELL_TASK&&lesson.source?.kind==='user_supplied_publisher'&&
    /^osad-/.test(lesson.source.source_id)&&/^osad-collection-[123]$/.test(lesson.source.collection_id)) {
    return {id:PICTURE_RETELL_TASK,kind:'picture_retell',source:'story',
      prompt:`Retell ${lesson.title_en} in your own words using the ${p.frames.length} pictures. Include the main events and their reasons. Do not add story facts.`,
      criteria:p.criteria.map(({id,meaning})=>({id,meaning})),labels:p.criteria.map(c=>c.label_vi),
      assetId:p.asset_id,frames:p.frames.map(f=>({...f})),maxSeconds:PICTURE_RETELL_SECONDS};
  }
  if(lesson.source?.source_id!==SOURCE||lesson.version!=='1.2.8')return null;
  return {id:PICTURE_RETELL_TASK,kind:'picture_retell',source:'story',
    prompt:'Retell The Sky Is Blue! in your own words using the five pictures. Include the main events and why the uncle is happy. Do not add story facts.',
    criteria:facts.map(([id,meaning])=>({id,meaning})),
    labels:facts.map(([,,label])=>label),frames:skyFrames.map(f=>({...f})),sheetWidth:1672,sheetHeight:941,
    picture:'/story-retell/sky/storyboard-v1.png',maxSeconds:PICTURE_RETELL_SECONDS};
}

export function pictureRetellResult(task,judgment,pronunciation=null) {
  const assessed=judgment?.reliability==='confirmed'&&(!judgment.intent||judgment.intent==='answer');
  const matched=assessed?task.criteria.filter(c=>judgment.matchedCriteria.includes(c.id)).map(c=>c.id):[];
  return {status:!assessed?'unassessed':matched.length===task.criteria.length?'complete':'needs_practice',
    matched:matched.length,total:task.criteria.length,
    meanings:task.criteria.map(({id},i)=>({label:task.labels[i],met:matched.includes(id)})),
    pronunciation:assessed?pronunciation:null,
    speech:!assessed?'unassessed':pronunciation?'azure':'understood'};
}
