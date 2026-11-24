const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync(require.resolve('../src/lib/offline-checkin.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const values=new Map();const secure={getItemAsync:async key=>values.get(key)??null,setItemAsync:async(key,value)=>values.set(key,value),deleteItemAsync:async key=>values.delete(key)};
const api={exports:{}};new Function('exports','module','require',compiled)(api.exports,{exports:api.exports},name=>name==='expo-secure-store'?secure:{});

test('admission snapshots are stored securely and exact QR matches are required',async()=>{
 const {storeAdmissionSnapshot,findCachedAdmission}=api.exports;
 await storeAdmissionSnapshot(19,[{public_code:'BF-QA-1',qr_payload:'BF1.adm.payload-one'},{public_code:'BF-QA-2',qr_payload:'BF1.adm.payload-two'}]);
 assert.equal((await findCachedAdmission(19,'BF1.adm.payload-two')).public_code,'BF-QA-2');
 assert.equal(await findCachedAdmission(19,'BF1.adm.payload-forged'),null);
});

test('offline scans remain pending until sync and conflicts can be dismissed',async()=>{
 const {queueOfflineAdmission,listQueuedAdmissions,markQueuedConflict,removeQueuedAdmission}=api.exports;
 const item=await queueOfflineAdmission(19,'BF-QA-1','BF1.adm.payload-one','2026-11-24T12:00:00.000Z');
 assert.equal((await listQueuedAdmissions(19))[0].state,'pending');
 await markQueuedConflict(19,item.client_scan_id,'Server result: already_used');
 assert.equal((await listQueuedAdmissions(19))[0].state,'conflict');
 await removeQueuedAdmission(19,item.client_scan_id);
 assert.deepEqual(await listQueuedAdmissions(19),[]);
});
