/** Selected-child gift actions. Recovery repeats one exact request; it never invents a replacement purchase. */
import {GiftError,giftNeed,PendingGiftAction,acceptGifts,acceptGiftResult} from './gift-contract.mjs';
import {validId,canonical} from './session-contract.mjs';
const definite=new Set(['insufficient_funds','gift_changed','gift_unavailable','stale_revision']);
export class GiftClient{
 #active=true;#epoch=0;#csrf;#pending;#view=null;#quote=null;#busy=false;#reconciled=false;#failure=null;#read=0;#version=0;#last=null;
 constructor({api,storage,access,id=()=> 'gift-'+crypto.randomUUID()}){giftNeed(validId(access?.active_child_id)&&typeof access.csrf==='string'&&access.csrf===api?.csrf,'wrong_scope');Object.assign(this,{api,childId:access.active_child_id,id});this.#csrf=access.csrf;this.#pending=new PendingGiftAction(storage,'child',this.childId);}
 get gifts(){return this.#active?structuredClone(this.#view):null;}
 get confirmation(){return this.#active?structuredClone(this.#quote):null;}
 get pending(){return this.#active?this.#pending.pending:null;}
 get storageInvalid(){return this.#active&&this.#pending.invalid;}
 get busy(){return this.#busy;}
 get reconciled(){return this.#reconciled;}
 get failureCode(){return this.#failure;}
 get canDiscard(){return this.#reconciled&&(this.#pending.invalid||definite.has(this.#failure));}
 get lastReceipt(){return this.#active?structuredClone(this.#last):null;}
 deactivate(){this.#active=false;this.#epoch++;this.#view=null;this.#quote=null;this.#last=null;}
 #current(epoch=this.#epoch){giftNeed(this.#active&&epoch===this.#epoch,'gift_scope_expired');giftNeed(this.api.csrf===this.#csrf,'csrf_failed');}
 #idle(){this.#current();giftNeed(!this.#busy,'operation_busy');}
 async #live(epoch){this.#current(epoch);const access=await this.api.request('me');this.#current(epoch);giftNeed(access.active_child_id===this.childId,'wrong_child');giftNeed(access.csrf===this.#csrf,'csrf_failed');}
 async #refresh(epoch){const read=++this.#read,version=this.#version;await this.#live(epoch);const result=await this.api.request('gifts');await this.#live(epoch);const current=acceptGifts(result.gifts,this.childId);this.#pending.verify();if(read===this.#read&&version===this.#version){this.#view=current;this.#reconciled=true;}return this.gifts;}
 async refresh(){this.#idle();return this.#refresh(this.#epoch);}
 async chooseGoal(giftId){this.#idle();giftNeed(this.#view,'gift_refresh_required');giftNeed(!this.#pending.pending&&!this.#pending.invalid,'gift_pending');let goal=null;if(giftId!==null){const gift=this.#view.catalogue.find(g=>g.gift_id===giftId);giftNeed(gift,'gift_unavailable');goal={gift_id:gift.gift_id,quoted_version:gift.version};}return this.#new('gifts/goal',{expected_revision:this.#view.goal.revision,goal});}
 async preparePurchase(giftId){this.#idle();giftNeed(!this.#pending.pending&&!this.#pending.invalid,'gift_pending');this.#quote=null;this.#busy=true;const epoch=this.#epoch;try{await this.#refresh(epoch);const gift=this.#view.catalogue.find(g=>g.gift_id===giftId);giftNeed(gift?.available,'gift_unavailable');giftNeed(this.#view.wallet.balance>=gift.price_diamonds,'insufficient_funds');this.#quote=structuredClone(gift);return this.confirmation;}finally{this.#busy=false;}}
 cancelPurchase(){this.#idle();this.#quote=null;}
 async confirmPurchase(){this.#idle();giftNeed(this.#quote,'gift_confirmation_required');giftNeed(!this.#pending.pending&&!this.#pending.invalid,'gift_pending');this.#busy=true;const epoch=this.#epoch,quote=structuredClone(this.#quote);try{await this.#refresh(epoch);const current=this.#view.catalogue.find(g=>g.gift_id===quote.gift_id);if(!current||canonical(current)!==canonical(quote)){this.#quote=null;throw new GiftError('gift_confirmation_changed');}giftNeed(this.#view.wallet.balance>=current.price_diamonds,'insufficient_funds');await this.#live(epoch);const pending={route:'gifts/redeem',data:{request_id:this.id(),child_id:this.childId,gift_id:quote.gift_id,quoted_version:quote.version}};this.#pending.begin(pending);this.#quote=null;this.#reconciled=false;this.#failure=null;return await this.#send(epoch);}finally{this.#busy=false;}}
 async #new(route,data){this.#busy=true;const epoch=this.#epoch;try{await this.#live(epoch);this.#pending.begin({route,data:{request_id:this.id(),child_id:this.childId,...data}});this.#quote=null;this.#reconciled=false;this.#failure=null;return await this.#send(epoch);}finally{this.#busy=false;}}
 async #send(epoch){const pending=this.#pending.pending;giftNeed(pending,'gift_pending_missing');this.#pending.verify();await this.#live(epoch);this.#version++;this.#reconciled=false;
  try{const result=await this.api.request(pending.route,pending.data);await this.#live(epoch);const accepted=acceptGiftResult(result,pending,'child',this.childId);this.#version++;this.#view=accepted.current_gifts;this.#last=accepted.receipt;this.#pending.acknowledge(pending);this.#failure=null;return accepted;}
  catch(error){if(this.#active&&epoch===this.#epoch&&definite.has(error.code))this.#failure=error.code;throw error;}
 }
 async retry(){this.#idle();giftNeed(!this.#pending.invalid,'gift_storage_invalid');giftNeed(this.#pending.pending,'gift_pending_missing');this.#busy=true;try{return await this.#send(this.#epoch);}finally{this.#busy=false;}}
 async discardRejected(){this.#idle();giftNeed(this.canDiscard,'gift_reconcile_required');const epoch=this.#epoch;this.#busy=true;try{await this.#refresh(epoch);giftNeed(this.canDiscard,'gift_reconcile_required');this.#pending.clear();this.#failure=null;this.#quote=null;this.#reconciled=false;}finally{this.#busy=false;}}
}
