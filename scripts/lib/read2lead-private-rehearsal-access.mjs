/** Adult access gate for loopback draft rehearsal. Credentials never enter URLs. */
import {randomBytes} from 'node:crypto';
import {createPrivateEditorAccess} from './read2lead-private-editor-access.mjs';
const COOKIE='r2l_private_rehearsal',LOGIN='/private-rehearsal/login';
const page='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Private lesson rehearsal</title><h1>Private lesson rehearsal</h1><p>Unpublished drafts. Adult review only. Practice progress uses disposable test learners.</p><form method="post" action="'+LOGIN+'"><p><label>Editor ID <input name="editor_id" value="local-owner" autocomplete="username" required></label></p><p><label>Private access key <input name="access_secret" type="password" autocomplete="current-password" required></label></p><button>Open private rehearsal</button></form></html>';
export function createPrivateRehearsalAccess({accessFile,now=()=>Date.now(),ttlMs=900000,landingPath='/read2lead/self-learn/'}={}){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>900000)throw Error('invalid_rehearsal_access');
 if(!['/read2lead/self-learn/','/read2lead/lesson/?mission=story-mission-v1'].includes(landingPath))throw Error('invalid_rehearsal_destination');
 const access=createPrivateEditorAccess({filename:accessFile}),sessions=new Map();let windowAt=now(),attempts=0;
 const authenticate=req=>{const raw=req.headers.cookie||'';if(raw.length>8192)return null;const key=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1),s=key&&sessions.get(key);if(!s||s.expires<=now()){if(key)sessions.delete(key);return null;}try{access.access(s.principal);return s;}catch{sessions.delete(key);return null;}};
 const gate=async(req,url,send)=>{
  if(url.pathname===LOGIN){
   if(url.search){send(400,'Invalid request');return true;}
   // A native form POST can send Origin:null under no-referrer. Keep the origin
   // for this same-origin form without disclosing referrers to other sites.
   if(['GET','HEAD'].includes(req.method)){send(200,req.method==='HEAD'?'':page,{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'same-origin'});return true;}
   if(req.method!=='POST'){send(405,'Method not allowed');return true;}
   if(req.headers.origin!==url.origin||req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded'){send(403,'Origin refused');return true;}
   if(now()-windowAt>=60000){windowAt=now();attempts=0;}if(++attempts>20){send(429,'Try again later');return true;}
   let body='';for await(const chunk of req){body+=chunk.toString('utf8');if(Buffer.byteLength(body)>4096){send(413,'Request too large');return true;}}
   const form=new URLSearchParams(body);if([...form.keys()].sort().join(',')!=='access_secret,editor_id'){send(400,'Invalid request');return true;}
   try{
    const principal=access.authenticate(form.get('editor_id'),form.get('access_secret'));
    for(const [key,s] of sessions)if(s.expires<=now())sessions.delete(key);
    if(sessions.size>=20){send(429,'Too many sessions');return true;}
    const key=randomBytes(32).toString('hex');sessions.set(key,{principal,expires:now()+ttlMs});
    send(303,'',{'Location':landingPath,'Set-Cookie':`${COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttlMs/1000)}`});
   }catch{send(401,'Private access refused');}return true;
  }
  if(authenticate(req))return false;
  if(req.method==='GET'&&!url.pathname.startsWith('/api/'))send(303,'',{'Location':LOGIN});else send(401,'Private rehearsal access required');
  return true;
 };
 // Identity is resolved from the same revocable server session, never a URL/body.
 gate.principal=req=>authenticate(req)?.principal?.editorId||null;
 return gate;
}
