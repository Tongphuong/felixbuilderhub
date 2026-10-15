/** Single-owner local access. Never accepts public demo credentials or sends keys to a service. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {validId} from '../../src/lib/read2lead/self-learn/session-contract.mjs';
const refuse=code=>{throw Object.assign(Error(code),{code});};
const hash=value=>createHash('sha256').update(value).digest('hex');
function privateParent(filename){
 if(!path.isAbsolute(filename||'')||path.resolve(filename)!==filename||filename.split(path.sep).some(x=>['public','dist','.git'].includes(x)))refuse('unsafe_editor_access_file');
 const parent=path.dirname(filename),s=fs.lstatSync(parent);
 if(fs.realpathSync(parent)!==parent||!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o077)!==0)refuse('unsafe_editor_access_file');
}
export function initializePrivateEditorAccess(filename){
 privateParent(filename);const value={format:'r2l-private-editor-access/1',editor_id:'local-owner',access_secret:randomBytes(32).toString('hex')};
 fs.writeFileSync(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return{editor_id:value.editor_id,access_file:filename};
}
function readAccess(filename){
 privateParent(filename);let fd;
 try{
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const s=fs.fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>4096)refuse('unsafe_editor_access_file');
  const raw=fs.readFileSync(fd,'utf8'),v=JSON.parse(raw);
  if(Object.keys(v).sort().join(',')!=='access_secret,editor_id,format'||v.format!=='r2l-private-editor-access/1'||!validId(v.editor_id)||v.editor_id.startsWith('synthetic-')||!/^[a-f0-9]{64}$/.test(v.access_secret))refuse('unsafe_editor_access_file');
  return{...v,generation:hash(raw)};
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function createPrivateEditorAccess({filename}={}){
 readAccess(filename);
 const current=()=>{try{return readAccess(filename);}catch{refuse('editor_access_revoked');}};
 const authorize=p=>{const v=current();if(p?.role!=='editor'||p.editorId!==v.editor_id||p.credentialVersion!==v.generation)refuse('editor_access_revoked');return v;};
 return Object.freeze({environment:'private-local',
  authenticate(editorId,secret){const v=current();if(editorId!==v.editor_id||typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret)||!timingSafeEqual(Buffer.from(secret,'hex'),Buffer.from(v.access_secret,'hex')))refuse('invalid_editor_access');return{role:'editor',editorId:v.editor_id,credentialVersion:v.generation};},
  access(principal){const v=authorize(principal);return{editor_id:v.editor_id,display_name:'Local publisher editor',role:'editor'};},
  withPublisherCommit(principal,work,sessionGuard=()=>{}){
   sessionGuard();authorize(principal);if(typeof work!=='function')refuse('invalid_request');
   // Authorization is checked again after asynchronous preparation, just before the synchronous publisher transaction.
   const result=work();if(result&&typeof result.then==='function')refuse('invalid_request');sessionGuard();authorize(principal);return result;
  }
 });
}
