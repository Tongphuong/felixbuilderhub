/** Local synthetic process fixture. A kill simulates power loss at a transaction boundary. */
import {SyntheticFamilyStore} from '../../../scripts/lib/read2lead-self-learn-family.mjs';
import {SyntheticGiftStore} from '../../../scripts/lib/read2lead-self-learn-gifts.mjs';
const [root,operation,boundary='',requestId='gift-worker']=process.argv.slice(2);
const family=new SyntheticFamilyStore({mode:'synthetic-local',root});
const gifts=new SyntheticGiftStore({mode:'synthetic-local',root,fault(name){if(name===boundary)process.kill(process.pid,'SIGKILL');}});
try{
 const p={...family.authenticateAccess('DEMO-FAMILY-A'),childId:'synthetic-an'},now='2026-09-19T00:00:00.000Z',chosen={gift_id:'synthetic-encouragement-card',quoted_version:'sample-v1'};let result;
 if(operation==='goal')result=gifts.setGoal(p,{request_id:requestId,expected_revision:0,goal:chosen},now);
 else if(operation==='redeem')result=gifts.redeem(p,{request_id:requestId,...chosen},now);
 else if(operation==='refund')result=gifts.refund({active:true,role:'staff',id:'synthetic-qa'},{request_id:requestId,redemption_id:'synthetic-an:gift-worker',reason:'synthetic sample'},now);
 else throw Error('unknown_fixture_operation');
 console.log(JSON.stringify(result));
}catch(error){console.log(JSON.stringify({error:error.code||error.message}));process.exitCode=2;}
finally{gifts.close();family.close();}
