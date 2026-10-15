import { onRequestGet as resolveLink } from '../../api/r2l-link.js';
import { onRequestPost as questClaim } from '../../api/read2lead-quest-claim.js';
import { onRequestPost as shopList } from '../../api/read2lead-shop-list.js';
import { onRequestPost as shopAvatar } from '../../api/read2lead-shop.js';
import { onRequestGet as leaderboard } from '../../api/read2lead-leaderboard.js';
import { onRequestPost as chestOpen } from '../../api/read2lead-chest-open.js';
import { onRequestPost as dailyChestClaim } from '../../api/read2lead-daily-chest-claim.js';
import { normalizeProgressState } from '../../api/_read2lead-v2-state.js';
import { onRequestPost as generate } from '../../api/generate-read2lead-pack.js';
import { onRequestGet as readLesson } from '../../api/read2lead-lesson.js';
import { onRequestGet as progress } from '../../api/read2lead-progress.js';
import { onRequestGet as speakingContext } from '../../api/minny-speaking-context.js';
import { onRequestGet as honors } from '../../api/read2lead-honors.js';
import { createAccountStoryApi } from './account-story-api.mjs';
import { connectStoryProfileRewards } from './story-profile.mjs';
import { onRequestPost as ceremonyAck } from '../../api/read2lead-ceremony-ack.js';
import { onRequestPost as giftGoal } from '../../api/read2lead-gift-goal.js';
import { onRequestPost as practiceLog } from '../../api/minny-practice-log.js';
import { onRequestPost as shopBuy } from '../../api/read2lead-shop-buy.js';
import { onRequestPost as giftsRedeem } from '../../api/read2lead-gifts-redeem.js';
import { onRequestPost as giftsList } from '../../api/read2lead-gifts-list.js';
import { createPrivateContent } from './private-content.mjs';
import { onRequestPost as saveCheckpoint } from '../../api/read2lead-checkpoint-save.js';
import { onRequestPost as submitLesson } from '../../api/submit-read2lead-lesson.js';
import { onRequestPost as readVoice } from '../../api/read2lead-voice.js';
import { onRequestPost as minnyVoice } from '../../api/minny-voice.js';
import { onRequestPost as speakingCheck } from '../../api/read2lead-speaking-check.js';
import { runPrivateLegacyVoice } from './private-voice.mjs';
import { onRequestPost as minnyConversation } from '../../api/minny-conversation.js';
import { runPrivateConversation } from './private-conversation.mjs';

export const PRIVATE_SITE_CODE = 'R2L-ADULT-PRIVATE-QA';
export const PRIVATE_SECOND_SITE_CODE = 'R2L-ADULT-PRIVATE-QA-02';
export const PRIVATE_STORY_SITE_CODE = 'R2L-ADULT-STORY-QA';
export const PRIVATE_RETELL_SITE_CODE = 'R2L-ADULT-RETELL-QA';
export const PRIVATE_LESSON_SITE_CODE = 'R2L-ADULT-LESSON-QA';
const privateProfiles=new Set([PRIVATE_SITE_CODE,PRIVATE_SECOND_SITE_CODE,PRIVATE_STORY_SITE_CODE,PRIVATE_RETELL_SITE_CODE,PRIVATE_LESSON_SITE_CODE]);
const homeTokenKey=code=>code===PRIVATE_SITE_CODE?'private:home-token':'private:home-token:'+code;
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});

/** Same application handlers, isolated SQL-backed account, no external storage/providers.
 * The outer private-access gate is mandatory, including the original-domain
 * maintenance test lane. Never attach this adapter to real learner storage.
 */
export function createPrivateSiteApi({store,pkg,packages,legacyBooks,authenticate,voiceConfig=null,voiceStatus={enabled:false,reason:'not_configured'},now=()=>Date.now()}) {
  const content=createPrivateContent({pkg,packages,legacyBooks});
  const db=store.db;
  db.exec('CREATE TABLE IF NOT EXISTS private_site_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER)');
  db.exec('CREATE TABLE IF NOT EXISTS private_content_versions (identity TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
  let contentReady;
  function verifyContent() {
    if(!contentReady)contentReady=content.fingerprints().then(rows=>store.transaction(()=>{
      for(const row of rows) {
        const previous=db.prepare('SELECT sha256 FROM private_content_versions WHERE identity=?').get(row.key);
        if(previous&&previous.sha256!==row.sha256)throw Error('private_content_version_changed');
      }
      for(const row of rows)db.prepare('INSERT OR IGNORE INTO private_content_versions VALUES(?,?)').run(row.key,row.sha256);
    }));
    return contentReady;
  }
  let pendingWrites=null;
  const writeRow=(key,row)=>row===null
    ? db.prepare('DELETE FROM private_site_kv WHERE key=?').run(key)
    : db.prepare('INSERT INTO private_site_kv VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').run(key,row.value,row.expires);
  const kv={
    async get(key,options={}) {
      const book=content.bookValue(key);
      if(book!==undefined)return options.type==='json'||options==='json'?book:JSON.stringify(book);
      const row=pendingWrites?.has(key)?pendingWrites.get(key):db.prepare('SELECT value,expires FROM private_site_kv WHERE key=?').get(key);
      if(!row||(row.expires!==null&&row.expires<=now()))return null;
      return options.type==='json'||options==='json'?JSON.parse(row.value):row.value;
    },
    async put(key,value,options={}) {
      const row={value:String(value),expires:options.expirationTtl?now()+options.expirationTtl*1000:null};
      if(pendingWrites)pendingWrites.set(key,row);else writeRow(key,row);
    },
    async list({limit=100,cursor='',prefix=''}={}) {
      const size=Math.max(1,Math.min(1000,Number(limit)||100));
      const rows=db.prepare('SELECT key FROM private_site_kv WHERE key>? AND substr(key,1,length(?))=? AND (expires IS NULL OR expires>?) ORDER BY key LIMIT ?').all(String(cursor),String(prefix),String(prefix),now(),size+1);
      const keys=rows.slice(0,size).map(r=>({name:r.key})),more=rows.length>size;
      return {keys,list_complete:!more,cursor:more?keys.at(-1).name:''};
    },
    async delete(key) {if(pendingWrites)pendingWrites.set(key,null);else writeRow(key,null);},
  };
  function initializeProfile(profile) {return store.transaction(()=>{
    const existing=db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(profile);
    if(existing&&JSON.parse(existing.value)?.is_test!==true)throw Error('private_profile_collision');
    const put=(key,value)=>db.prepare('INSERT OR IGNORE INTO private_site_kv VALUES(?,?,NULL)').run(key,JSON.stringify(value));
    put(homeTokenKey(profile),{token:crypto.randomUUID().replaceAll('-','')});
    const homeToken=JSON.parse(db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(homeTokenKey(profile)).value).token;
    put('r2l_link:'+homeToken,{access_code:profile,expires_at:new Date(now()+365*86400000).toISOString().slice(0,10),revoked:false,uses:0,max_uses:null});
    put(profile,{is_test:true,uses_remaining:100,student_profile:{student_name:profile===PRIVATE_SITE_CODE?'Adult':profile===PRIVATE_STORY_SITE_CODE?'Story Review':profile===PRIVATE_RETELL_SITE_CODE?'Retell Review':profile===PRIVATE_LESSON_SITE_CODE?'Lesson Review':'Adult Review',age:10,child_gender:'boy',level:pkg.lesson.level},
      progress:{current_level:pkg.lesson.level,review_history:[],packs_created:0},completed_books:[]});
    put('progress:'+profile,{schema_version:2,level_reset_version:20260606,current_level:pkg.lesson.level,initial_level:'L0',
      unlocked_levels:['L0',pkg.lesson.level],xp_in_level:0,total_xp:100,diamonds:700,
      level_progress:{L0:5,L1:0,L2:0,L3:0,L4:0,L5:0},completed_packs:5,completed_pack_ids:[],coins:0,streak_days:0});
    const key='progress:'+profile;
    const raw=JSON.parse(db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(key).value);
    if(!raw.avatar){
      const account=JSON.parse(db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(profile).value);
      const state=normalizeProgressState(raw,{accessCode:profile,codeData:account,nowIso:new Date(now()).toISOString()});
      db.prepare('UPDATE private_site_kv SET value=? WHERE key=?').run(JSON.stringify(state),key);
    }
    return homeToken;
  });}
  initializeProfile(PRIVATE_SITE_CODE);
  function initializedProfile(code) {
    if(!privateProfiles.has(code))return null;
    const row=db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(code);
    return row&&JSON.parse(row.value)?.is_test===true?code:null;
  }
  connectStoryProfileRewards(store);
  const env={READ2LEAD_CODES:kv,R2L_CONTENT_SOURCE:content.contentSource,R2L_PRIVATE_QA:'adult-isolated',
    R2L_STORY_CATALOGUE:{async get(key){
      return content.storyValue(key);
    }}};
  async function runAccount(work) {
    // The outer queue serializes this buffer with every existing private route.
    pendingWrites=new Map();
    try {
      const response=await work(env);
      store.transaction(()=>{for(const [key,row] of pendingWrites)writeRow(key,row);});
      return response;
    }catch{return json({ok:false,error:'private_storage_unavailable'},503);}
    finally{pendingWrites=null;}
  }
  function voiceAccountContext() {
    let selected=null,conflict=false;
    return {owner:()=>conflict?null:selected,env:{...env,READ2LEAD_CODES:{...kv,
      async get(key,options={}) {
        const value=await kv.get(key,options),profile=initializedProfile(key);
        if(profile) {if(selected&&selected!==profile)conflict=true;selected=profile;}
        return value;
      },
    }}};
  }
  const routes={
    '/api/r2l-link':{GET:resolveLink},
    '/api/generate-read2lead-pack':{POST:generate}, '/api/read2lead-lesson':{GET:readLesson},
    '/api/read2lead-checkpoint-save':{POST:saveCheckpoint}, '/api/submit-read2lead-lesson':{POST:submitLesson},
    '/api/read2lead-voice':{POST:readVoice}, '/api/read2lead-speaking-check':{POST:speakingCheck},
    '/api/minny-voice':{POST:minnyVoice},
    '/api/minny-conversation':{POST:minnyConversation},
    '/api/read2lead-progress':{GET:progress}, '/api/minny-speaking-context':{GET:speakingContext},
    '/api/read2lead-honors':{GET:honors}, '/api/read2lead-leaderboard':{GET:leaderboard},
    '/api/read2lead-shop-list':{POST:shopList}, '/api/read2lead-shop':{POST:shopAvatar},
    '/api/read2lead-quest-claim':{POST:questClaim}, '/api/read2lead-chest-open':{POST:chestOpen}, '/api/read2lead-daily-chest-claim':{POST:dailyChestClaim},
    '/api/read2lead-ceremony-ack':{POST:ceremonyAck}, '/api/read2lead-gift-goal':{POST:giftGoal},
    '/api/minny-practice-log':{POST:practiceLog}, '/api/read2lead-shop-buy':{POST:shopBuy},
    '/api/read2lead-gifts-redeem':{POST:giftsRedeem}, '/api/read2lead-gifts-list':{POST:giftsList},
  };
  let tail=Promise.resolve();
  async function handle(request) {
    if(!await authenticate(request))return json({code:'authentication_required'},401);
    const url=new URL(request.url);
    if(request.headers.get('sec-fetch-site')==='cross-site'||(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin))return json({code:'origin_refused'},403);
    try {await verifyContent();}catch{return json({code:'private_content_unavailable'},503);}
    if(url.pathname==='/api/read2lead-private-status'&&request.method==='GET')return json({voice:voiceStatus});
    if(url.pathname==='/api/read2lead-private-voice-report'&&request.method==='GET') {
      if([...url.searchParams.keys()].sort().join(',')!=='requestId,sessionId')return json({code:'invalid_query'},400);
      const sessionId=url.searchParams.get('sessionId'),requestId=url.searchParams.get('requestId');
      if(![sessionId,requestId].every(v=>/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(v||'')))return json({code:'invalid_query'},400);
      try {
        const profile=initializedProfile(request.headers.get('X-Read2Lead-Code')||PRIVATE_SITE_CODE);
        if(!profile)return json({code:'private_report_unavailable'},404);
        const result=store.voiceResult(profile,sessionId,requestId);
        const c=voiceConfig?.budget?.config;
        let budget=null;
        if(c?.scope==='batch') {
          const scope='batch:'+c.batchId;
          const reserved=db.prepare('SELECT COALESCE(SUM(reserved),0) AS total FROM story_voice_reservations WHERE month=?').get(scope).total;
          const turns=db.prepare('SELECT t.state,COUNT(*) AS count FROM story_voice_turns t JOIN story_voice_reservations r ON t.session=r.session WHERE r.month=? GROUP BY t.state').all(scope);
          budget={batchId:c.batchId,approvedMicroUsd:c.approvedVoiceMicroUsd,reservedMicroUsd:reserved,perTurnReserveMicroUsd:c.worstCaseTurnMicroUsd,turns,actualBilledMicroUsd:null};
        }
        return json({sessionId,requestId,transcript:result.transcript,reply:result.reply,
          judgment:result.judgment,assessment:result.assessment,rewardsAwarded:result.rewardsAwarded,budget});
      }catch{return json({code:'private_report_unavailable'},404);}
    }
    if(url.pathname==='/api/read2lead-private-entry'&&request.method==='GET'){
      if(url.search&&[...url.searchParams.keys()].join(',')!=='profile')return json({code:'invalid_query'},400);
      const profile=url.searchParams.get('profile')??PRIVATE_SITE_CODE;
      if(!privateProfiles.has(profile))return json({code:'private_profile_not_found'},404);
      try{return json({homeHref:'/r2l/start?t='+initializeProfile(profile)});}
      catch{return json({code:'private_profile_unavailable'},503);}
    }
    if(['/api/read2lead-story-session','/api/read2lead-story-turn'].includes(url.pathname)) {
      const profile=initializedProfile(request.headers.get('X-Read2Lead-Code'));
      if(!profile)return json({code:'authentication_required'},401);
      return createAccountStoryApi({db,transaction:work=>store.transaction(work),run:runAccount,now,
        infrastructure:env,origin:url.origin,voiceConfig,hostStorage:{store,authorize:authenticate,readAccount:code=>{
          if(!initializedProfile(code))return null;
          const row=db.prepare('SELECT value,expires FROM private_site_kv WHERE key=?').get(code);
          return row&&(row.expires===null||row.expires>now())?JSON.parse(row.value):null;
        }}})(request);
    }
    const progressProfile=initializedProfile(url.searchParams.get('code'));
    if(url.pathname==='/api/read2lead-progress'&&progressProfile) {
      const account=await kv.get(progressProfile,{type:'json'}),ref=account?.progress?.current_pack?.story_reference;
      if(ref)store.transaction(()=>{
        const row=db.prepare('SELECT state FROM story_sessions WHERE owner=? AND story=? AND version=?').get(progressProfile,ref.id,ref.version);
        if(row)store.profileStateSink({owner:progressProfile,state:JSON.parse(row.state)});
      });
    }
    const handlers=routes[url.pathname];
    if(!handlers)return json({code:'private_route_not_enabled'},404);
    const handler=handlers[request.method];if(!handler)return json({code:'method_not_allowed'},405);
    if(handler===minnyConversation||handler===readVoice||handler===minnyVoice||handler===speakingCheck) {
      // Bind charging to the account the original handler actually authenticated.
      // Never use a caller's unrelated header to choose another profile's budget.
      const context=voiceAccountContext();
      if(handler===minnyConversation)return runPrivateConversation({handler,request,...context,voiceConfig,store,
        commit:rows=>store.transaction(()=>{for(const [key,row] of rows)writeRow(key,row);}),now});
      return runPrivateLegacyVoice({handler,request,...context,voiceConfig,store,
        service:handler===speakingCheck?'asr':'tts'});
    }
    {
      // Remaining original handlers share this isolated KV adapter. Commit
      // their complete read/write sequence together, including gift queue,
      // account balance and shared gift counters. SQL failure rolls all back.
      // Guarded provider/conversation requests have separate handling above;
      // the outer queue prevents another handler observing this buffer.
      return runAccount(env=>handler({request,env,waitUntil:()=>{}}));
    }
  }
  return request=>{
    // Serialize whole account mutations, including read→write handlers, within
    // this single isolated host. No ordinary eventually-consistent KV wallet.
    const result=tail.then(()=>handle(request));tail=result.catch(()=>{});return result;
  };
}
