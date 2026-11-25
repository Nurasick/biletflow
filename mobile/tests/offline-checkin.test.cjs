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

test('clearOfflineEventData removes cached snapshots from memory and storage as well as queued scans',async()=>{
 const {storeAdmissionSnapshot,findCachedAdmission,queueOfflineAdmission,listQueuedAdmissions,clearOfflineEventData}=api.exports;
 const tickets=Array.from({length:10},(_,index)=>({public_code:`BF-CLR-${index}`,qr_payload:`BF1.adm.clear-${index}`}));
 await storeAdmissionSnapshot(42,tickets);
 await queueOfflineAdmission(42,'BF-CLR-0','BF1.adm.clear-0','2026-11-24T12:00:00.000Z');
 await queueOfflineAdmission(42,'BF-CLR-1','BF1.adm.clear-1','2026-11-24T12:01:00.000Z');
 assert.equal((await findCachedAdmission(42,'BF1.adm.clear-9')).public_code,'BF-CLR-9');
 assert.equal((await listQueuedAdmissions(42)).length,2);

 await clearOfflineEventData(42);

 assert.equal(await findCachedAdmission(42,'BF1.adm.clear-0'),null);
 assert.equal(await findCachedAdmission(42,'BF1.adm.clear-9'),null);
 assert.deepEqual(await listQueuedAdmissions(42),[]);
 const remainingKeys=[...values.keys()].filter(key=>key.startsWith('biletflow.offline.42.'));
 assert.deepEqual(remainingKeys,[]);
});

test('unavailable SecureStore rejects writes and deletes with a clean user-facing error',async()=>{
 const webApi={exports:{}};
 const webSecure={
   isAvailableAsync:async()=>false,
   getItemAsync:async()=>{throw new TypeError('ExpoSecureStore.getValueWithKeyAsync is not a function');},
   setItemAsync:async()=>{throw new TypeError('ExpoSecureStore.setValueWithKeyAsync is not a function');},
   deleteItemAsync:async()=>{throw new TypeError('ExpoSecureStore.deleteValueWithKeyAsync is not a function');},
 };
 new Function('exports','module','require',compiled)(webApi.exports,{exports:webApi.exports},name=>name==='expo-secure-store'?webSecure:{});
 await assert.rejects(
   webApi.exports.storeAdmissionSnapshot(99,[{public_code:'BF-WEB-1',qr_payload:'BF1.adm.web'}]),
   /Secure offline cache is available on iOS and Android only\./,
 );
 await assert.rejects(
   webApi.exports.clearOfflineEventData(99),
   /Secure offline cache is available on iOS and Android only\./,
 );
 assert.deepEqual(await webApi.exports.listQueuedAdmissions(99),[]);
});
