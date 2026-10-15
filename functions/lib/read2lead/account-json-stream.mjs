import {jsonStreamStringify} from './vendor/json-stream-lite/stringify.js';
import {sha256} from './vendor/js-sha256/index.mjs';

const encoder=new TextEncoder();
const CHUNK_BYTES=65536;

/** Exact compact JSON for the plain JSON values in protected snapshots.
 * Native string escaping is retained in the pinned stringifier. Carry UTF-16
 * pairs across its string boundaries before encoding, then emit bounded bytes.
 * No whole-snapshot JSON string or UTF-8 buffer is constructed.
 */
export function* accountJsonBytes(value) {
  let pending='',buffer=new Uint8Array(CHUNK_BYTES),used=0;
  for(let text of jsonStreamStringify(value,null,0,{stringChunkSize:16384})) {
    text=pending+text;pending='';
    const last=text.charCodeAt(text.length-1);
    if(last>=0xd800&&last<=0xdbff){pending=text.slice(-1);text=text.slice(0,-1);}
    const bytes=encoder.encode(text);
    for(let offset=0;offset<bytes.length;){
      const count=Math.min(CHUNK_BYTES-used,bytes.length-offset);
      buffer.set(bytes.subarray(offset,offset+count),used);used+=count;offset+=count;
      if(used===CHUNK_BYTES){yield buffer;buffer=new Uint8Array(CHUNK_BYTES);used=0;}
    }
  }
  // Native escaping means an unmatched surrogate cannot remain here.
  if(pending)throw Error('account_json_incomplete_unicode');
  if(used)yield buffer.slice(0,used);
}

export function accountJsonDigest(value) {
  const hash=sha256.create();
  for(const bytes of accountJsonBytes(value))hash.update(bytes);
  return hash.hex();
}

export function accountJsonStream(value) {
  const iterator=accountJsonBytes(value);
  return new ReadableStream({type:'bytes',
    pull(controller){
      try{
        const next=iterator.next();
        if(next.done){controller.close();controller.byobRequest?.respond(0);}
        else controller.enqueue(next.value);
      }
      catch(error){iterator.return?.();controller.error(error);}
    },
    cancel(){iterator.return?.();},
  });
}
