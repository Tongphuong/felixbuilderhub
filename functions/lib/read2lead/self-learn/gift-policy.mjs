/** Provisional synthetic gift contract. Goals never debit; prices come from immutable server versions. */
export class GiftPolicyError extends Error {constructor(code){super(code);this.code=code;}}
const requireThat=(ok,code)=>{if(!ok)throw new GiftPolicyError(code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const uint=x=>Number.isSafeInteger(x)&&x>=0;
const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
export const GIFT_STATUSES=['requested','preparing','delivered','rejected','refunded'];
export function validateSyntheticGiftCatalogue(value){
 requireThat(exact(value,['format','purpose','real_rewards','funding_status','items'])&&value.format===1&&value.purpose==='read2lead-local-synthetic-gifts'&&value.real_rewards===false&&value.funding_status==='not_funded'&&Array.isArray(value.items)&&value.items.length>0&&value.items.length<=40,'invalid_gift_catalogue');
 const seen=new Set();const items=value.items.map(p=>{requireThat(exact(p,['gift_id','version','title_vi','description_vi','price_diamonds','available'])&&id(p.gift_id)&&p.gift_id.startsWith('synthetic-')&&id(p.version)&&text(p.title_vi,100)&&text(p.description_vi,500)&&Number.isSafeInteger(p.price_diamonds)&&p.price_diamonds>0&&p.price_diamonds<=1000000&&typeof p.available==='boolean'&&!seen.has(p.gift_id),'invalid_gift_catalogue');seen.add(p.gift_id);return structuredClone(p);});
 return {format:1,purpose:value.purpose,real_rewards:false,funding_status:'not_funded',items};
}
export function validateGiftGoal(value){
 if(value===null)return null;requireThat(exact(value,['gift_id','quoted_version'])&&id(value.gift_id)&&id(value.quoted_version),'invalid_gift_goal');return structuredClone(value);
}
export function applyGiftGoal(snapshot,goal){requireThat(object(snapshot),'invalid_gift_snapshot');return {...structuredClone(snapshot),goal:validateGiftGoal(goal)};}
export function publicGift(row){
 requireThat(object(row)&&id(row.id)&&id(row.version)&&text(row.title,100)&&Number.isSafeInteger(row.price)&&row.price>0&&row.price<=1000000&&[0,1].includes(row.available),'invalid_gift_view');
 return {gift_id:row.id,version:row.version,title_vi:row.title,price_diamonds:row.price,available:row.available===1,currency:'diamonds',synthetic:true,real_rewards:false};
}
export function giftGoalView(goal,catalogue,balance){
 const wanted=validateGiftGoal(goal);requireThat(Array.isArray(catalogue)&&catalogue.length<=100&&uint(balance),'invalid_gift_view');const gifts=catalogue.map(publicGift);requireThat(new Set(gifts.map(g=>g.gift_id)).size===gifts.length,'invalid_gift_view');
 if(wanted===null)return {state:'none',goal:null,gift:null,remaining_diamonds:null,ready:false};
 const gift=gifts.find(g=>g.gift_id===wanted.gift_id);if(!gift)return {state:'missing',goal:wanted,gift:null,remaining_diamonds:null,ready:false};
 const state=gift.version!==wanted.quoted_version?'changed':!gift.available?'unavailable':'current';return {state,goal:wanted,gift,remaining_diamonds:Math.max(0,gift.price_diamonds-balance),ready:state==='current'&&balance>=gift.price_diamonds};
}
/** Check display transitions only; actual ledger mutation remains in the existing transactional store. */
export function permittedGiftTransition(from,to){return from==='requested'&&['preparing','rejected'].includes(to)||from==='preparing'&&['delivered','rejected'].includes(to)||from==='rejected'&&to==='refunded';}
export function publicGiftOrder(row){
 requireThat(object(row)&&text(row.id,300)&&id(row.gift_id)&&id(row.gift_version)&&Number.isSafeInteger(row.price)&&row.price>0&&row.price<=1000000&&GIFT_STATUSES.includes(row.status)&&timestamp(row.created_at)&&timestamp(row.updated_at),'invalid_gift_view');
 requireThat(text(row.title,100),'invalid_gift_view');return {redemption_id:row.id,gift_id:row.gift_id,gift_version:row.gift_version,title_vi:row.title,price_diamonds:row.price,status:row.status,created_at:row.created_at,updated_at:row.updated_at,synthetic:true,real_rewards:false};
}
export function publicGiftAudit(rows){requireThat(Array.isArray(rows)&&rows.length<=100,'invalid_gift_view');return rows.map(r=>{requireThat(object(r)&&text(r.redemption_id,300)&&(r.from_status===null||GIFT_STATUSES.includes(r.from_status))&&GIFT_STATUSES.includes(r.to_status)&&timestamp(r.created_at),'invalid_gift_view');return {redemption_id:r.redemption_id,from_status:r.from_status,to_status:r.to_status,created_at:r.created_at};});}
