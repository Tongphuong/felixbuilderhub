#!/usr/bin/env node
/** Private editor-only loopback host. No learner route, production adapter or external service. */
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {openPublisherStore} from './lib/read2lead-publisher-import.mjs';
import {createPublisherEditor} from './lib/read2lead-publisher-editor.mjs';
import {createPrivateEditorAccess,initializePrivateEditorAccess} from './lib/read2lead-private-editor-access.mjs';
import {createEditorHandlers} from '../functions/lib/read2lead/self-learn/editor-handlers.mjs';
const PAGE='/read2lead/editor/',PREFIX='/api/read2lead/editor/';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",'Permissions-Policy':'microphone=(), camera=(), geolocation=()'};
const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2'};
function safeFile(root,relative){const file=path.join(root,relative);if(fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())throw Error('unsafe_static_target');return file;}
function absolute(value){if(!path.isAbsolute(value||'')||path.resolve(value)!==value)throw Error('absolute_paths_required');return value;}
export async function startPrivatePublisherEditor({mode,publisherDb,assetRoot,accessFile,distRoot,port=8877,now,ttlMs}={}){
 if(mode!=='private-local'||!Number.isInteger(port)||(port!==0&&(port<1024||port>65535)))throw Error('unsafe_editor_server_config');
 for(const name of [publisherDb,assetRoot,accessFile,distRoot])absolute(name);
 for(const name of [publisherDb,assetRoot])if(name.split(path.sep).some(x=>['public','dist','.git'].includes(x))||fs.realpathSync(name)!==name)throw Error('private_publisher_path_required');
 if(!fs.lstatSync(publisherDb).isFile()||!fs.lstatSync(assetRoot).isDirectory()||fs.realpathSync(distRoot)!==distRoot||!fs.lstatSync(distRoot).isDirectory())throw Error('unsafe_editor_server_config');
 const html=fs.readFileSync(safeFile(distRoot,'read2lead/editor/index.html'),'utf8');
 if(html.split('id="editor-root"').length!==2||!html.includes('BẢN QA CỤC BỘ · Nội dung mẫu · Chưa duyệt phát hành'))throw Error('private_editor_page_marker_required');
 const page=html.replace('id="editor-root"','id="editor-root" data-editor-environment="private-local"').replace('BẢN QA CỤC BỘ · Nội dung mẫu · Chưa duyệt phát hành','CHUẨN BỊ RIÊNG TƯ · Chưa phát hành công khai');
 const store=createPrivateEditorAccess({filename:accessFile}),db=openPublisherStore(publisherDb);let server,api,origin;
 try{
  const publisher=createPublisherEditor({mode:'private-local',db,assetRoot});
  server=createServer(async(req,res)=>{
   const send=(status,body,extra={})=>{const merged=new Headers(headers);for(const [key,value] of Object.entries(extra))merged.set(key,value);res.writeHead(status,Object.fromEntries(merged));res.end(body);};
   try{
    const raw=req.url||'/';if(!raw.startsWith('/')||raw.startsWith('//')||/\\|%2f|%5c|%2e|(?:^|\/)\.\.(?:\/|\?|$)/i.test(raw)){send(400,'Invalid path');return;}
    const url=new URL(raw,origin);if(req.headers.host!==url.host){send(403,'Origin refused');return;}
    if(url.pathname.startsWith(PREFIX)){
     const abort=new AbortController();req.on('aborted',()=>abort.abort());const request=new Request(url,{method:req.method,headers:req.headers,signal:abort.signal,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
     const response=await api.handle(request);send(response.status,Buffer.from(await response.arrayBuffer()),Object.fromEntries(response.headers));return;
    }
    if(!['GET','HEAD'].includes(req.method)){send(405,'Method not allowed',{Allow:'GET, HEAD'});return;}
    if(!url.search&&(url.pathname==='/'||url.pathname===PAGE.slice(0,-1))){send(302,'',{Location:PAGE});return;}
    if(!url.search&&url.pathname===PAGE){send(200,req.method==='HEAD'?'':page,{'Content-Type':'text/html; charset=utf-8'});return;}
    if(!url.search&&/^\/_astro\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?)$/.test(url.pathname)){const file=safeFile(distRoot,url.pathname.slice(1));send(200,req.method==='HEAD'?'':fs.readFileSync(file),{'Content-Type':mime[path.extname(file)]});return;}
    send(404,'Not found');
   }catch{send(404,'Not found');}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=3000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  api=createEditorHandlers({mode:'private-local',origin,store,publisher,...(now?{now}:{}),...(ttlMs?{ttlMs}:{})});
 }catch(error){server?.close();db.close();throw error;}
 let closed=false;return{url:origin+PAGE,origin,environment:'private-local',publication_scope:'private_catalogue_only',async close(){if(closed)return;closed=true;await new Promise(done=>{server.close(done);server.closeAllConnections();});db.close();}};
}
export async function runPrivatePublisherEditor(args){
 const opts={};args=[...args];while(args.length){const k=args.shift();if(k==='--init-access'){if(opts.init)throw Error('duplicate_option');opts.init=true;continue;}if(!['--publisher-db','--asset-root','--access-file','--dist-root','--port'].includes(k)||opts[k]!==undefined||!args.length)throw Error('invalid_arguments');opts[k]=args.shift();}
 for(const k of ['--publisher-db','--asset-root','--access-file','--dist-root'])absolute(opts[k]);
 if(opts.init)initializePrivateEditorAccess(opts['--access-file']);
 return startPrivatePublisherEditor({mode:'private-local',publisherDb:opts['--publisher-db'],assetRoot:opts['--asset-root'],accessFile:opts['--access-file'],distRoot:opts['--dist-root'],port:opts['--port']===undefined?8877:Number(opts['--port'])});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const editor=await runPrivatePublisherEditor(process.argv.slice(2));console.log(JSON.stringify({status:'ready',url:editor.url,environment:editor.environment,publication_scope:editor.publication_scope,production_release_authorized:false}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await editor.close();process.exit(0);});}
 catch(error){console.error(JSON.stringify({status:'refused',error:error.message}));process.exitCode=1;}
}
