/** Bounded allowlisted HTTP views; never serialize raw historical imports. */
import { freeMonsterCatalogue, validateFreeMonster } from './game-policy.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uint=x=>Number.isSafeInteger(x)&&x>=0;
const str=x=>typeof x==='string'&&x.length<=300;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const nullable=validator=>x=>x===null||validator(x);
const bool=x=>typeof x==='boolean';
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const requireThat=ok=>{if(!ok)throw Error('invalid_game_view');};
function fields(value,validators,optional=[]){requireThat(object(value));const result={};for(const [key,valid] of Object.entries(validators)){if(optional.includes(key)&&!Object.hasOwn(value,key))continue;requireThat(valid(value[key]));result[key]=value[key];}return result;}
const numericOrUnknown=nullable(uint);
function rank(value){if(value===null)return null;return fields(value,{rank_points:uint,tier_index:uint,tier_name_vi:str,tier_name_en:str,tier_color:str,division:nullable(str),stars:uint,stars_per_division:uint,stars_to_next:uint,is_apex:bool,apex_points:uint,label_vi:str,next_label_vi:nullable(str),capped:bool,cap_unlock_hint_vi:nullable(str)},['apex_points']);}
function medal(value){return fields(value,{season_id:id,name_vi:str,emoji:str,peak_label_vi:str,peak_tier_index:uint,reward_diamonds:uint,ts:nullable(date),kind:str,honors_rank:uint},['name_vi','emoji','peak_label_vi','peak_tier_index','reward_diamonds','ts','kind','honors_rank']);}
function progress(value){
 const result=fields(value,{origin:x=>['new_local','legacy_snapshot'].includes(x),current_level:x=>/^L[0-5]$/.test(x)&&typeof x==='string',lifetime_xp:numericOrUnknown,xp_in_level:numericOrUnknown,lifetime_rank_points:numericOrUnknown,legacy_rank_points:numericOrUnknown});
 requireThat(Array.isArray(value.medals)&&value.medals.length<=1000);
 return {...result,rank_ladder:rank(value.rank_ladder),legacy_season:value.legacy_season===null?null:fields(value.legacy_season,{id,rp:uint,peak_tier_index:uint,peak_label_vi:str},['peak_tier_index','peak_label_vi']),medals:value.medals.map(medal),mastery_validated:false,xp_spendable:false};
}
function theme(value){if(value===null)return null;const result=fields(value,{id,name_vi:str,starts_at:date,ends_at:date});requireThat(Array.isArray(value.interest_ids)&&value.interest_ids.length<=10&&value.interest_ids.every(id));return {...result,interest_ids:[...value.interest_ids]};}
export function publicGamePreferences(value){const result=fields(value,{revision:uint,source:x=>['default','selected','legacy_snapshot'].includes(x)});return {...result,monster:validateFreeMonster(value.monster)};}
export function publicGameView(value){const result=fields(value,{child_id:id,declared_level:x=>typeof x==='string'&&/^L[0-5]$/.test(x)});requireThat(value.monster_policy==='all-supported-free-v1');return {...result,preferences:publicGamePreferences(value.preferences),legacy_progress:progress(value.legacy_progress),wallet:{...fields(value.wallet,{balance:uint,currency:x=>x==='diamonds'}),real_rewards:false},theme:theme(value.theme),monster_policy:'all-supported-free-v1',automatic_promotion:false};}
export function publicGameCatalogue(value){
 const expected=freeMonsterCatalogue();requireThat(object(value)&&value.policy===expected.policy&&JSON.stringify(value.slots)===JSON.stringify(expected.slots)&&JSON.stringify(value.colors)===JSON.stringify(expected.colors)&&object(value.parts));
 for(const slot of expected.slots){requireThat(Array.isArray(value.parts[slot])&&value.parts[slot].length===expected.parts[slot].length);for(let i=0;i<expected.parts[slot].length;i++){const p=value.parts[slot][i],e=expected.parts[slot][i];requireThat(object(p)&&p.id===e.id&&p.file===e.file&&p.free===true&&p.price_diamonds===0);}}
 return {policy:expected.policy,slots:expected.slots,colors:expected.colors,parts:Object.fromEntries(expected.slots.map(slot=>[slot,expected.parts[slot].map(p=>({id:p.id,asset_url:!p.file?'':p.file.startsWith('/')?p.file:'/assets/monsters/raw/'+p.file.split('/').map(encodeURIComponent).join('/'),rarity:p.rarity,...(p.color?{color:p.color}:{}),free:true,price_diamonds:0}))]))};
}
export function publicGameAudit(rows){requireThat(Array.isArray(rows)&&rows.length<=100);return rows.map(row=>fields(row,{action:x=>['monster_selected','legacy_imported'].includes(x),revision:uint,source_sha256:nullable(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)),created_at:date}));}
