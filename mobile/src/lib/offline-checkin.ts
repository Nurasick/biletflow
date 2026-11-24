import * as SecureStore from 'expo-secure-store';

export type CachedAdmission = { public_code:string; qr_payload:string };
export type QueuedAdmission = { client_scan_id:string; public_code:string; qr_payload:string; scanned_at:string; state:'pending'|'conflict'; detail?:string };
const prefix=(eventId:number)=>`biletflow.offline.${eventId}`;
const snapshotMeta=(eventId:number)=>`${prefix(eventId)}.snapshot.meta`;
const snapshotPage=(eventId:number,page:number)=>`${prefix(eventId)}.snapshot.${page}`;
const queueMeta=(eventId:number)=>`${prefix(eventId)}.queue.meta`;
const queueEntry=(eventId:number,id:string)=>`${prefix(eventId)}.queue.${id}`;
// Keep each SecureStore value comfortably below the size some iOS Keychain
// versions accept. A QR plus its code is small, but a larger JSON page is not.
const PAGE_SIZE=8;
const MAX_SNAPSHOT=2000;
const MAX_QUEUE=50;
const snapshotCache=new Map<number,Map<string,CachedAdmission>>();
function localId(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return(c==='x'?r:(r&3)|8).toString(16);});}

async function readJson<T>(key:string,fallback:T):Promise<T>{try{const value=await SecureStore.getItemAsync(key);return value?JSON.parse(value) as T:fallback;}catch{return fallback;}}

export async function storeAdmissionSnapshot(eventId:number,tickets:CachedAdmission[]){
  if(tickets.length>MAX_SNAPSHOT)throw new Error(`Offline snapshot is limited to ${MAX_SNAPSHOT} tickets per event.`);
  const old=await readJson<{pages:number}>(snapshotMeta(eventId),{pages:0});
  const pages=Math.ceil(tickets.length/PAGE_SIZE);
  for(let page=0;page<pages;page++)await SecureStore.setItemAsync(snapshotPage(eventId,page),JSON.stringify(tickets.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)));
  await SecureStore.setItemAsync(snapshotMeta(eventId),JSON.stringify({pages,updated_at:new Date().toISOString()}));
  for(let page=pages;page<old.pages;page++)await SecureStore.deleteItemAsync(snapshotPage(eventId,page));
  snapshotCache.set(eventId,new Map(tickets.map(ticket=>[ticket.qr_payload,ticket])));
}

export async function findCachedAdmission(eventId:number,qrPayload:string){
  let cache=snapshotCache.get(eventId);
  if(!cache){
    const meta=await readJson<{pages:number}>(snapshotMeta(eventId),{pages:0});
    const pages=Number.isInteger(meta.pages)?Math.min(meta.pages,Math.ceil(MAX_SNAPSHOT/PAGE_SIZE)):0;
    const chunks=await Promise.all(Array.from({length:pages},(_,page)=>readJson<CachedAdmission[]>(snapshotPage(eventId,page),[])));
    cache=new Map(chunks.flat().map(ticket=>[ticket.qr_payload,ticket]));
    snapshotCache.set(eventId,cache);
  }
  return cache.get(qrPayload)??null;
}

export async function queueOfflineAdmission(eventId:number,publicCode:string,qrPayload:string,scannedAt=new Date().toISOString()):Promise<QueuedAdmission>{
  const ids=await readJson<string[]>(queueMeta(eventId),[]);
  if(ids.length>=MAX_QUEUE)throw new Error(`The offline queue is full (${MAX_QUEUE} check-ins). Reconnect and sync it.`);
  const item:QueuedAdmission={client_scan_id:localId(),public_code:publicCode,qr_payload:qrPayload,scanned_at:scannedAt,state:'pending'};
  await SecureStore.setItemAsync(queueEntry(eventId,item.client_scan_id),JSON.stringify(item));
  await SecureStore.setItemAsync(queueMeta(eventId),JSON.stringify([...ids,item.client_scan_id]));
  return item;
}

export async function listQueuedAdmissions(eventId:number){
  const ids=await readJson<string[]>(queueMeta(eventId),[]);
  const entries=await Promise.all(ids.map(id=>readJson<QueuedAdmission|null>(queueEntry(eventId,id),null)));
  return entries.filter((item):item is QueuedAdmission=>item!==null);
}

export async function removeQueuedAdmission(eventId:number,id:string){
  const ids=await readJson<string[]>(queueMeta(eventId),[]);
  await SecureStore.deleteItemAsync(queueEntry(eventId,id));
  await SecureStore.setItemAsync(queueMeta(eventId),JSON.stringify(ids.filter(item=>item!==id)));
}

export async function markQueuedConflict(eventId:number,id:string,detail:string){
  const item=await readJson<QueuedAdmission|null>(queueEntry(eventId,id),null);
  if(item)await SecureStore.setItemAsync(queueEntry(eventId,id),JSON.stringify({...item,state:'conflict',detail}));
}

export function clearOfflineEventData(eventId:number){
  return SecureStore.deleteItemAsync(snapshotMeta(eventId));
}
