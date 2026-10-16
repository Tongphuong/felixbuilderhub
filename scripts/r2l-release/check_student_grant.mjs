#!/usr/bin/env node
// Runs the candidate's OWN student-voice loader against the candidate's OWN manifest grant + wrangler var.
// Used by build_candidate.py --student-voice-grant. Prints one JSON line; exit 0 only when the loader is
// enabled, even with the clock set far past the old batch grant's expiry (the pool has no expiry).
// Usage: check_student_grant.mjs --source-root <candidate/source> --manifest <package.json> --config <wrangler.release.json>
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=n=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
const fail=(msg)=>{console.log(JSON.stringify({ok:false,error:msg}));process.exit(1);};
const root=arg('source-root'),manifestPath=arg('manifest'),configPath=arg('config');
if(!root||!manifestPath||!configPath)fail('usage: --source-root --manifest --config');
const mod=f=>import(pathToFileURL(path.join(root,f)).href);
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
const {studentVoiceConfiguration}=await mod('functions/lib/read2lead/student-voice.mjs');
const {verifiedLessonCatalogue}=await mod('functions/lib/read2lead/private-voice.mjs');
// Minimal in-memory stand-in for the SQL store: the loader only creates tables and reads pool usage.
const store={db:{exec(){},prepare(){return {get:()=>({n:0,total:0}),run(){},all:()=>[]};}}};
const env={R2L_STUDENT_VOICE_CONFIG:cfg.vars?.R2L_STUDENT_VOICE_CONFIG,AI:{run(){}}};
// Same inputs student-story.mjs gives the loader: catalogue + grant from manifest.studentRelease,
// package pin from manifest.sourcePackageSha256.
const release=manifest.studentRelease||{};
const lessonCatalogue=await verifiedLessonCatalogue(release).catch(()=>null);
const farFuture=()=>new Date('2031-01-01T00:00:00.000Z');
const res=await studentVoiceConfiguration({store,env,now:farFuture,packageSha256:manifest.sourcePackageSha256,
  lessonCatalogue,approvedGrant:release.approvedGrant});
const out={ok:res.status.enabled===true,enabled:res.status.enabled,reason:res.status.reason,
  budget:res.config?.budget?.config??null,checkedAt:farFuture().toISOString()};
console.log(JSON.stringify(out));
process.exit(out.ok?0:1);
