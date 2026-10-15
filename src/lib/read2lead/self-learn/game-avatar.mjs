/** New free-choice preview. Reuses measured geometry without legacy flags, CSS injection or gates. */
import geometry from '../../../../public/assets/monsters/monster-parts.json' with { type:'json' };
import { bodyBoxFromFile,computeArmPairPlacement,computePartPlacement,computeAnchoredPlacement,resolvePartAnchor,armDualAnchor,armSingleAnchors,isDualArmSprite,MONSTER_SLOT_REGIONS } from '../../monster-slot-layout.ts';
import { browserGameCatalogue,validGameMonster,gameRequire } from './game-contract.mjs';
const catalog=browserGameCatalogue(),namespace='http://www.w3.org/2000/svg',dimensionsCache=new Map();
const tintColors={mint:'#6ee7b7',coral:'#fb7185',sky:'#38bdf8',lemon:'#fde047',grape:'#a78bfa'};let renderSequence=0;
const shape=(x,y,w,h)=>({leftPct:x/165*100,topPct:y/165*100,widthPct:w/165*100,heightPct:h/165*100});
export function gameAvatarLayers(monster,dimensions){
 gameRequire(validGameMonster(monster));const selected=Object.fromEntries(catalog.slots.map(slot=>[slot,catalog.parts[slot].find(p=>p.id===monster[slot])]));
 const body=geometry.body.find(p=>p.id===monster.body),arms=geometry.arms.find(p=>p.id===monster.arms),box=bodyBoxFromFile(body.file),out=[];
 const add=(slot,p,flip=false)=>{if(selected[slot]?.asset_url)out.push({slot,src:selected[slot].asset_url,placement:p,flip,tint:slot==='body'?monster.color:selected[slot].color||null});};
 add('wings',shape(-25,3,215,145));add('frame',shape(-28,-28,221,221));
 if(body.geom&&body.sockets&&arms.geom){const pair=computeArmPairPlacement(body,arms.geom,box);add('arms',pair.left,pair.left.flip);add('arms',pair.right,pair.right.flip);}
 else {const size=dimensions[selected.arms.asset_url];gameRequire(size?.width>0&&size?.height>0);const anchor=isDualArmSprite(arms.file)?{left:armDualAnchor(box)}:armSingleAnchors(box);for(const [side,a] of Object.entries(anchor))add('arms',computeAnchoredPlacement(size.width,size.height,a),side==='right');}
 for(const slot of ['body','detail','eyes','mouth']){if(!selected[slot].asset_url)continue;const size=dimensions[selected[slot].asset_url];gameRequire(Number.isFinite(size?.width)&&size.width>0&&Number.isFinite(size?.height)&&size.height>0);const file=geometry[slot].find(p=>p.id===monster[slot]).file;add(slot,slot==='body'?computePartPlacement(size.width,size.height,MONSTER_SLOT_REGIONS.body):computeAnchoredPlacement(size.width,size.height,resolvePartAnchor(slot,file,box)));}
 add('effects',shape(-28,-28,221,221));add('pet',shape(112,117,65,65));add('hat',shape(box.x+box.w/2-34,box.y-30,68,58));
 gameRequire(out.every(l=>['leftPct','topPct','widthPct','heightPct'].every(k=>Number.isFinite(l.placement[k]))));return out;
}
function measure(src){if(!dimensionsCache.has(src))dimensionsCache.set(src,new Promise((done,fail)=>{const image=new Image();image.onload=()=>done({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>{dimensionsCache.delete(src);fail(new Error('image_unavailable'));};image.src=src;}));return dimensionsCache.get(src);}
export async function renderGameAvatar(target,monster){
 if(!target)return;const ticket={};target.gameRenderTicket=ticket;target.textContent='Đang mở hình bạn đồng hành…';
 try{gameRequire(validGameMonster(monster));const urls=catalog.slots.map(slot=>catalog.parts[slot].find(p=>p.id===monster[slot]).asset_url).filter(Boolean);const sizes=Object.fromEntries(await Promise.all(urls.map(async src=>[src,await measure(src)])));if(target.gameRenderTicket!==ticket||!target.isConnected)return;
  const svg=document.createElementNS(namespace,'svg'),prefix='game-avatar-'+(++renderSequence)+'-';
  const defs=document.createElementNS(namespace,'defs');for(const [color,hex] of Object.entries(tintColors)){const filter=document.createElementNS(namespace,'filter');filter.id=prefix+color;filter.setAttribute('color-interpolation-filters','sRGB');const flood=document.createElementNS(namespace,'feFlood');flood.setAttribute('flood-color',hex);const composite=document.createElementNS(namespace,'feComposite');composite.setAttribute('in2','SourceAlpha');composite.setAttribute('operator','in');filter.append(flood,composite);defs.appendChild(filter);}svg.appendChild(defs);svg.setAttribute('viewBox','-35 -45 235 255');svg.setAttribute('role','img');svg.setAttribute('aria-label','Hình bạn đồng hành với những phần con đang chọn');svg.setAttribute('class','game-avatar color-'+monster.color);
  for(const layer of gameAvatarLayers(monster,sizes)){const image=document.createElementNS(namespace,'image'),p=layer.placement,x=p.leftPct*1.65,y=p.topPct*1.65,w=p.widthPct*1.65,h=p.heightPct*1.65;image.setAttribute('href',layer.src);image.setAttribute('x',String(x));image.setAttribute('y',String(y));image.setAttribute('width',String(w));image.setAttribute('height',String(h));image.setAttribute('data-slot',layer.slot);if(layer.tint)image.setAttribute('filter','url(#'+prefix+layer.tint+')');image.setAttribute('preserveAspectRatio','xMidYMid meet');if(layer.flip)image.setAttribute('transform',`translate(${2*x+w} 0) scale(-1 1)`);svg.appendChild(image);}
  target.replaceChildren(svg);target.dataset.preview='ready';
 }catch{if(target.gameRenderTicket!==ticket||!target.isConnected)return;target.dataset.preview='unavailable';target.textContent='Chưa mở được hình xem trước. Lựa chọn của con vẫn được giữ; con thử tải lại hình nhé.';}
}
