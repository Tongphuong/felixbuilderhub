/** Shared browser contract for the synthetic gift API; no credentials or local wallet authority. */
import {publicGiftView,publicGiftReceipt,publicStaffOrder,publicStaffOrders} from '../../../../functions/lib/read2lead/self-learn/gift-views.mjs';
import {validateGiftGoal} from '../../../../functions/lib/read2lead/self-learn/gift-policy.mjs';
import {validId,canonical} from './session-contract.mjs';
export class GiftError extends Error{constructor(code){super(code);this.code=code;}}
export const giftNeed=(ok,code='invalid_response')=>{if(!ok)throw new GiftError(code);};
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uint=x=>Number.isSafeInteger(x)&&x>=0;
export const GIFT_REJECTION_REASONS=['Không thể chuẩn bị quà mẫu.','Yêu cầu mẫu cần được hoàn lại.','Dừng lượt thử theo đề nghị.'];
export function acceptGifts(value,child){try{giftNeed(value?.child_id===child);return publicGiftView(value);}catch{throw new GiftError('invalid_response');}}
export function acceptStaffOrders(value){try{return publicStaffOrders(value);}catch{throw new GiftError('invalid_response');}}
export function acceptStaffOrder(value,id){try{const result=publicStaffOrder(value);if(id!==undefined)giftNeed(result.order.redemption_id===id);return result;}catch{throw new GiftError('invalid_response');}}
export function validGiftOperation(p,kind,subject){
 try{
  if(!exact(p,['route','data'])||!validId(p.data?.request_id))return false;const d=p.data;
  if(kind==='child'){
   if(d.child_id!==subject)return false;
   if(p.route==='gifts/goal')return exact(d,['request_id','child_id','expected_revision','goal'])&&uint(d.expected_revision)&&d.expected_revision<Number.MAX_SAFE_INTEGER&&canonical(validateGiftGoal(d.goal))===canonical(d.goal);
   return p.route==='gifts/redeem'&&exact(d,['request_id','child_id','gift_id','quoted_version'])&&validId(d.gift_id)&&validId(d.quoted_version);
  }
  if(kind!=='staff'||typeof d.redemption_id!=='string'||!d.redemption_id.length||d.redemption_id.length>300)return false;
  if(p.route==='fulfil')return exact(d,['request_id','redemption_id','status'])&&['preparing','delivered'].includes(d.status);
  return p.route==='refund'&&exact(d,['request_id','redemption_id','reason'])&&GIFT_REJECTION_REASONS.includes(d.reason);
 }catch{return false;}
}
export function acceptGiftResult(value,pending,kind,subject){
 try{
  giftNeed(value?.ok===true&&typeof value.replayed==='boolean'&&validGiftOperation(pending,kind,subject));const d=pending.data;
  if(kind==='child'){
   const current=acceptGifts(value.current_gifts,subject),isGoal=pending.route==='gifts/goal';
   const receipt=publicGiftReceipt({ok:value.ok,replayed:value.replayed,goal:value.receipt?.goal,redemption:value.receipt?.redemption,balance:value.receipt?.balance},isGoal?'goal':'redeem',subject);
   if(isGoal){giftNeed(receipt.receipt.goal.revision===d.expected_revision+1&&canonical(receipt.receipt.goal.goal)===canonical(d.goal)&&current.goal.revision>=receipt.receipt.goal.revision);}
   else{const r=receipt.receipt.redemption;giftNeed(r.redemption_id===subject+':'+d.request_id&&r.gift_id===d.gift_id&&r.gift_version===d.quoted_version&&value.receipt.currency==='diamonds');}
   return {...receipt,current_gifts:current};
  }
  const current=acceptStaffOrder(value.current_order,d.redemption_id),receipt=publicGiftReceipt({ok:value.ok,replayed:value.replayed,goal:value.receipt?.goal,redemption:value.receipt?.redemption,balance:value.receipt?.balance},pending.route);
  giftNeed(receipt.receipt.redemption.redemption_id===d.redemption_id&&receipt.receipt.redemption.status===(pending.route==='refund'?'refunded':d.status));if(pending.route==='refund')giftNeed(value.receipt.currency==='diamonds');return {...receipt,current_order:current};
 }catch{throw new GiftError('invalid_response');}
}
/** Only IDs,versions and safe preset reasons are durable; cookies and CSRF remain in memory. */
export class PendingGiftAction{
 #row;#raw=null;#invalid=false;
 constructor(storage,kind,subject){giftNeed(['child','staff'].includes(kind)&&validId(subject),'wrong_scope');Object.assign(this,{storage,kind,subject,key:'r2l-gift-pending:'+kind+':'+subject});this.#row=null;try{this.#raw=storage.getItem(this.key);}catch{throw new GiftError('storage_unavailable');}if(this.#raw!==null){let v;try{if(this.#raw.length<=4096)v=JSON.parse(this.#raw);}catch{}if(exact(v,['format','kind','subject','pending'])&&v.format===1&&v.kind===kind&&v.subject===subject&&validGiftOperation(v.pending,kind,subject))this.#row=v.pending;else this.#invalid=true;}}
 get pending(){return structuredClone(this.#row);}
 get invalid(){return this.#invalid;}
 verify(){try{giftNeed(this.storage.getItem(this.key)===this.#raw,'gift_storage_changed');}catch(e){if(e instanceof GiftError)throw e;throw new GiftError('storage_unavailable');}}
 #write(pending){this.verify();const raw=pending?JSON.stringify({format:1,kind:this.kind,subject:this.subject,pending}):null;try{if(raw===null)this.storage.removeItem(this.key);else this.storage.setItem(this.key,raw);}catch{throw new GiftError('storage_unavailable');}this.#raw=raw;this.#row=structuredClone(pending);this.#invalid=false;}
 begin(pending){giftNeed(!this.#invalid,'gift_storage_invalid');giftNeed(!this.#row,'gift_pending');giftNeed(validGiftOperation(pending,this.kind,this.subject),'invalid_request');this.#write(pending);}
 acknowledge(pending){giftNeed(canonical(this.#row)===canonical(pending),'gift_pending_changed');this.#write(null);}
 clear(){this.#write(null);}
}
