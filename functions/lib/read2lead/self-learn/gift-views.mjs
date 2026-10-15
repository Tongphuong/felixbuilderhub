/** Strict HTTP projections for provisional gifts. Never spread a database result into JSON. */
import {publicGift,publicGiftOrder,publicGiftAudit,validateGiftGoal,giftGoalView} from './gift-policy.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uint=x=>Number.isSafeInteger(x)&&x>=0;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const need=ok=>{if(!ok)throw Error('invalid_gift_view');};
function flags(value){need(object(value)&&value.synthetic===true&&value.real_rewards===false);}
function wallet(value){need(object(value)&&uint(value.balance)&&value.currency==='diamonds');return {balance:value.balance,currency:'diamonds'};}
function gift(value){flags(value);need(value.currency==='diamonds'&&typeof value.available==='boolean');return publicGift({id:value.gift_id,version:value.version,title:value.title_vi,price:value.price_diamonds,available:Number(value.available)});}
export function publicOrder(value,childId){flags(value);const order=publicGiftOrder({id:value.redemption_id,gift_id:value.gift_id,gift_version:value.gift_version,title:value.title_vi,price:value.price_diamonds,status:value.status,created_at:value.created_at,updated_at:value.updated_at});if(childId!==undefined)need(id(childId)&&order.redemption_id.startsWith(childId+':'));return order;}
export function publicGoalReceipt(value){need(object(value)&&uint(value.revision));return {revision:value.revision,goal:validateGiftGoal(value.goal)};}
export function publicGiftView(value){
 flags(value);need(id(value.child_id)&&value.funding_status==='not_funded'&&Array.isArray(value.catalogue)&&value.catalogue.length<=100&&Array.isArray(value.orders)&&value.orders.length<=100);
 const balance=wallet(value.wallet),catalogue=value.catalogue.map(gift),goal=publicGoalReceipt(value.goal),raw=catalogue.map(g=>({id:g.gift_id,version:g.version,title:g.title_vi,price:g.price_diamonds,available:Number(g.available)}));
 const audit=publicGiftAudit(value.audit);need(audit.every(a=>a.redemption_id.startsWith(value.child_id+':')));
 return {child_id:value.child_id,synthetic:true,real_rewards:false,funding_status:'not_funded',wallet:balance,catalogue,goal:{...goal,...giftGoalView(goal.goal,raw,balance.balance)},orders:value.orders.map(r=>publicOrder(r,value.child_id)),audit,history_limit:100};
}
export function publicGiftReceipt(value,kind,childId){
 need(object(value)&&value.ok===true&&typeof value.replayed==='boolean');
 if(kind==='goal')return {ok:true,replayed:value.replayed,receipt:{goal:publicGoalReceipt(value.goal)}};
 need(['redeem','fulfil','refund'].includes(kind));const redemption=publicOrder(value.redemption,childId);if(kind!=='fulfil')need(uint(value.balance));
 return {ok:true,replayed:value.replayed,receipt:{redemption,...(kind==='fulfil'?{}:{balance:value.balance,currency:'diamonds'})}};
}
export function publicStaffOrders(rows){need(Array.isArray(rows)&&rows.length<=100);return rows.map(r=>{need(id(r.child_id));return {child_id:r.child_id,...publicOrder(r,r.child_id)};});}
export function publicStaffOrder(value){need(object(value)&&id(value.child_id));const audit=publicGiftAudit(value.audit),order=publicOrder(value.order,value.child_id);need(audit.every(a=>a.redemption_id===order.redemption_id));return {child_id:value.child_id,order,wallet:wallet(value.wallet),audit};}
