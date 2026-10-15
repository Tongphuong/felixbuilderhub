/** Marked synthetic process/crash fixture. No remote resources or credentials. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SyntheticFamilyStore } from '../../../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticGameStore } from '../../../scripts/lib/read2lead-self-learn-game.mjs';
import { defaultFreeMonster } from '../../../functions/lib/read2lead/self-learn/game-policy.mjs';
import { canonical } from '../../../src/lib/read2lead/self-learn/session-contract.mjs';
const read = name => JSON.parse(readFileSync(new URL('./'+name+'.json',import.meta.url),'utf8'));
const [root,operation,boundary='',requestId='game-worker'] = process.argv.slice(2);
const family = new SyntheticFamilyStore({mode:'synthetic-local',root});
const game = new SyntheticGameStore({mode:'synthetic-local',root,themes:read('game-seasons').themes,interestIds:read('library-interests').groups.map(g=>g.id),fault(name){if(name===boundary)process.kill(process.pid,'SIGKILL');}});
try {
 const now='2026-09-19T00:00:00.000Z';let result;
 if(operation==='select') result=game.selectMonster({...family.authenticateAccess('DEMO-FAMILY-A'),childId:'synthetic-an'},{request_id:requestId,expected_revision:0,monster:{...defaultFreeMonster(),color:'grape'}},now);
 else if(operation==='import'){const snapshot=read('game-legacy').snapshot;result=game.importLegacy({active:true,role:'staff',id:'synthetic-qa'},{child_id:'synthetic-an',request_id:requestId,expected_sha256:createHash('sha256').update(canonical(snapshot)).digest('hex'),snapshot},now);}
 else throw Error('unknown_fixture_operation');
 console.log(JSON.stringify(result));
} catch(error){console.log(JSON.stringify({error:error.code||error.message}));process.exitCode=2;}
finally{game.close();family.close();}
