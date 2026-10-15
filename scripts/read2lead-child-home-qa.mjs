// Local-only synthetic account host. No production bindings or providers.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRead2LeadAccountService} from '../functions/lib/read2lead/account-service.mjs';
import {makeStoredBookPack} from '../tests/helpers/book-pack-fixture.mjs';

const build=path.resolve(process.argv[2]||'dist');
const db=new DatabaseSync(':memory:');
const transaction=work=>{db.exec('BEGIN');try{const value=work();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
const service=createRead2LeadAccountService({db,transaction,infrastructure:{R2L_CONTENT_SOURCE:'combined'}});
const put=(ns,key,value)=>db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(ns,key,JSON.stringify(value));
for(const [code,name,count] of [['R2L-SYNTHETIC-HOME','An',0],['R2L-SYNTHETIC-LONG','Nguyễn Hoàng Minh Khánh',3]]){
  put('codes',code,{uses_remaining:100,is_test:false,student_profile:{student_name:name,age:9,child_gender:'boy',level:'L1'},completed_books:[],progress:{current_level:'L1',completed_packs:count,packs_created:0,current_pack:null,review_history:[]}});
  put('progress','progress:'+code,{schema_version:2,level_reset_version:20260606,current_level:'L1',initial_level:'L1',total_xp:0,diamonds:270,completed_packs:count});
}
put('codes','config:book_levels',['L0','L1','L2','L3','L4']);
put('codes','book_index:L1',['book_1']);put('codes','book:book_1',makeStoredBookPack('book_1',{title:'A Morning in the Garden'}));
put('codes','book_index:L0',['book_2']);put('codes','book:book_2',makeStoredBookPack('book_2',{title:'A Little Bird',level:'L0',pages:3,sentencesPerPage:1}));
put('codes','r2l_link:'+'a'.repeat(32),{access_code:'R2L-SYNTHETIC-HOME',expires_at:'2030-01-01'});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
  try{
    const origin='http://127.0.0.1:'+server.address().port,url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/')){
      const body=[];for await(const chunk of req)body.push(chunk);
      const response=await service(new Request(url,{method:req.method,headers:{...req.headers,origin},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(body)})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    let file=path.resolve(build,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(build+path.sep)&&file!==build){res.writeHead(403);res.end();return;}
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));
  }catch(error){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Local fixture unavailable');}
});
server.listen(0,'127.0.0.1',()=>console.log(`SYNTHETIC PREVIEW http://127.0.0.1:${server.address().port}/r2l/start/?t=${'a'.repeat(32)}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
