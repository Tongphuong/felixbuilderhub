/** Browser-only, bounded public game data. No legacy state normalization or wallet writes. */
import { MONSTER_MANIFEST as manifest } from '../../../../functions/api/_monster-manifest.js';
import { ApiError } from './api-client.mjs';
export const GAME_SLOTS = ['body','eyes','mouth','arms','detail','hat','pet','wings','effects','frame'];
export const GAME_COLORS = ['mint','coral','sky','lemon','grape'];
export const SLOT_LABELS = {body:'Thân',eyes:'Mắt',mouth:'Miệng',arms:'Tay',detail:'Chi tiết',hat:'Mũ',pet:'Thú cưng',wings:'Cánh',effects:'Hiệu ứng',frame:'Khung'};
export const COLOR_LABELS = {mint:'Xanh bạc hà',coral:'Hồng san hô',sky:'Xanh trời',lemon:'Vàng chanh',grape:'Tím nho'};
const optional = new Set(['detail','hat','pet','wings','effects','frame']);
export const gameObject = x => x!==null && typeof x==='object' && !Array.isArray(x);
export const gameExact = (x,keys) => gameObject(x) && Object.keys(x).length===keys.length && keys.every(k=>Object.hasOwn(x,k));
export const gameRevision = x => Number.isSafeInteger(x) && x>=0 && x<Number.MAX_SAFE_INTEGER;
const uint = x => Number.isSafeInteger(x)&&x>=0, text = x => typeof x==='string'&&x.length<=300;
const id = x => typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const iso = x => typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const nullable = f => x=>x===null||f(x);
export const gameRequire = (ok,code='invalid_response') => { if(!ok)throw new ApiError(code); };
function pick(v,rules,optionalKeys=[]) {gameRequire(gameObject(v));const out={};for(const [k,test] of Object.entries(rules)){if(optionalKeys.includes(k)&&!Object.hasOwn(v,k))continue;gameRequire(test(v[k]));out[k]=v[k];}return out;}
const catalogue = {policy:'all-supported-free-v1',slots:[...GAME_SLOTS],colors:[...GAME_COLORS],parts:Object.fromEntries(GAME_SLOTS.map(slot=>[slot,[...(optional.has(slot)?[{id:'',file:'',rarity:'common'}]:[]),...manifest[slot]].map(p=>({id:p.id,asset_url:!p.file?'':p.file.startsWith('/')?p.file:'/assets/monsters/raw/'+p.file.split('/').map(encodeURIComponent).join('/'),rarity:p.rarity||'common',...(p.color?{color:p.color}:{}),free:true,price_diamonds:0}))]))};
export function browserGameCatalogue(){return structuredClone(catalogue);}
export function acceptGameCatalogue(value){
 gameRequire(gameObject(value)&&value.policy===catalogue.policy&&JSON.stringify(value.slots)===JSON.stringify(catalogue.slots)&&JSON.stringify(value.colors)===JSON.stringify(catalogue.colors)&&gameObject(value.parts));
 for(const slot of GAME_SLOTS){gameRequire(Array.isArray(value.parts[slot])&&value.parts[slot].length===catalogue.parts[slot].length);value.parts[slot].forEach((p,i)=>{const expected=catalogue.parts[slot][i];gameRequire(gameObject(p)&&Object.entries(expected).every(([k,v])=>p[k]===v));});}
 return browserGameCatalogue();
}
export function validGameMonster(value){return gameExact(value,[...GAME_SLOTS,'color'])&&GAME_COLORS.includes(value.color)&&GAME_SLOTS.every(slot=>catalogue.parts[slot].some(p=>p.id===value[slot]));}
export function acceptGamePreferences(value){gameRequire(gameObject(value)&&gameRevision(value.revision)&&['default','selected','legacy_snapshot'].includes(value.source)&&validGameMonster(value.monster));return {revision:value.revision,source:value.source,monster:structuredClone(value.monster)};}
export function acceptGame(value,childId){
 gameRequire(value?.child_id===childId&&id(childId)&&typeof value.declared_level==='string'&&/^L[0-5]$/.test(value.declared_level)&&value.monster_policy===catalogue.policy&&value.automatic_promotion===false);
 const p=value.legacy_progress;gameRequire(p?.mastery_validated===false&&p.xp_spendable===false&&Array.isArray(p.medals)&&p.medals.length<=1000);
 const progress=pick(p,{origin:x=>['new_local','legacy_snapshot'].includes(x),current_level:x=>typeof x==='string'&&/^L[0-5]$/.test(x),lifetime_xp:nullable(uint),xp_in_level:nullable(uint),lifetime_rank_points:nullable(uint),legacy_rank_points:nullable(uint)});
 progress.rank_ladder=p.rank_ladder===null?null:pick(p.rank_ladder,{rank_points:uint,tier_index:uint,tier_name_vi:text,tier_name_en:text,tier_color:text,division:nullable(text),stars:uint,stars_per_division:uint,stars_to_next:uint,is_apex:x=>typeof x==='boolean',apex_points:uint,label_vi:text,next_label_vi:nullable(text),capped:x=>typeof x==='boolean',cap_unlock_hint_vi:nullable(text)},['apex_points']);
 progress.legacy_season=p.legacy_season===null?null:pick(p.legacy_season,{id,rp:uint,peak_tier_index:uint,peak_label_vi:text},['peak_tier_index','peak_label_vi']);
 progress.medals=p.medals.map(m=>pick(m,{season_id:id,name_vi:text,emoji:text,peak_label_vi:text,peak_tier_index:uint,reward_diamonds:uint,ts:nullable(iso),kind:text,honors_rank:uint},['name_vi','emoji','peak_label_vi','peak_tier_index','reward_diamonds','ts','kind','honors_rank']));
 progress.mastery_validated=false;progress.xp_spendable=false;
 gameRequire(value.wallet?.currency==='diamonds'&&uint(value.wallet.balance)&&value.wallet.real_rewards===false);
 const theme=value.theme===null?null:pick(value.theme,{id,name_vi:text,starts_at:iso,ends_at:iso});
 if(theme){gameRequire(Array.isArray(value.theme.interest_ids)&&value.theme.interest_ids.length<=10&&value.theme.interest_ids.every(id));theme.interest_ids=[...value.theme.interest_ids];}
 return {child_id:childId,declared_level:value.declared_level,preferences:acceptGamePreferences(value.preferences),legacy_progress:progress,wallet:{balance:value.wallet.balance,currency:'diamonds',real_rewards:false},theme,monster_policy:catalogue.policy,automatic_promotion:false};
}
export function acceptGameAudit(value){gameRequire(Array.isArray(value)&&value.length<=100);return value.map(row=>pick(row,{action:x=>['monster_selected','legacy_imported'].includes(x),revision:uint,created_at:iso}));}
