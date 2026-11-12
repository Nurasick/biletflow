const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync(require.resolve('../src/shared/api/support.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const api={exports:{}};
new Function('exports','module',compiled)(api.exports,api);
const {supportApi,validateNewCase,visibleMessages,caseTransitions}=api.exports;
const summary={case_number:'SC-EXAMPLE',status:'open',messages:[],context:{event_id:7,event_title:'Example',order_number:null,ticket_code:null}};

test('attendee support requires context; organizer cases never accept attendee orders',()=>{
 assert.throws(()=>validateNewCase({audience:'attendee',category:'technical',body:'Help'}),/context/);
 assert.throws(()=>validateNewCase({audience:'organizer',category:'technical',body:'Help',order_number:'ORDER'}),/only include event context/);
 assert.deepEqual(validateNewCase({audience:'attendee',category:'ticket_delivery',body:'  Where is my ticket?  ',order_number:'ORDER'}),{audience:'attendee',category:'ticket_delivery',body:'Where is my ticket?',order_number:'ORDER'});
 assert.throws(()=>validateNewCase({audience:'attendee',category:'technical',body:'   ',event_id:1}),/1 and 5000/);
});

test('requester replies never send the internal-note flag, even if accidentally supplied',async()=>{
 const calls=[];const fetcher=async(path,init)=>{calls.push({path,init});return Response.json(summary);};
 await supportApi.reply(fetcher,'SC/A','requester',' Hello ',true);
 assert.equal(calls[0].path,'/support/cases/SC%2FA/messages');
 assert.deepEqual(JSON.parse(calls[0].init.body),{body:'Hello'});
 await supportApi.reply(fetcher,'SC/A','staff','Only staff',true);
 assert.deepEqual(JSON.parse(calls[1].init.body),{body:'Only staff',is_internal_note:true});
 assert.equal(calls[1].path,'/staff/support/cases/SC%2FA/messages');
});

test('requester display excludes internal notes and orders messages chronologically',()=>{
 const detail={...summary,messages:[{id:2,created_at:'2026-11-12T10:01:00Z',body:'Public'},{id:1,created_at:'2026-11-12T10:00:00Z',body:'Private',is_internal_note:true}]};
 assert.deepEqual(visibleMessages(detail,'requester').map(m=>m.body),['Public']);
 assert.deepEqual(visibleMessages(detail,'staff').map(m=>m.body),['Private','Public']);
});

test('only backend-defined staff status transitions can be submitted',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json(summary);};
 assert.deepEqual(caseTransitions.waiting_for_customer,['resolved']);
 assert.throws(()=>supportApi.transition(fetcher,{...summary,status:'waiting_for_customer'},'in_progress'),/not allowed/);
 assert.throws(()=>supportApi.transition(fetcher,{...summary,status:'resolved'},'in_progress'),/not allowed/);
 assert.equal(calls,0);
 await supportApi.transition(fetcher,summary,'in_progress');assert.equal(calls,1);
});

test('staff assignment preserves explicit null to unassign',async()=>{
 let init;await supportApi.assign(async(path,options)=>{init=options;return Response.json(summary);},'SC-EXAMPLE',null);
 assert.equal(init.method,'PATCH');assert.deepEqual(JSON.parse(init.body),{assigned_to_user_id:null});
 assert.throws(()=>supportApi.assign(async()=>Response.json(summary),'SC-EXAMPLE',-1),/valid staff user ID/);
});

test('support access denial is visible and mutations are never silently retried',async()=>{
 let attempts=0;
 await assert.rejects(supportApi.read(async()=>{attempts++;return Response.json({detail:'Forbidden'},{status:403});},'SC-EXAMPLE','staff'),/permission/);
 assert.equal(attempts,1);attempts=0;
 await assert.rejects(supportApi.reply(async()=>{attempts++;throw new TypeError('offline');},'SC-EXAMPLE','requester','Hello'),/may have reached the server/);
 assert.equal(attempts,1);
});

test('authorized staff queue loads every page instead of hiding older cases',async()=>{
 const urls=[];const result=await supportApi.list(async(path)=>{urls.push(path);return Response.json(urls.length===1?Array.from({length:100},()=>summary):[summary]);},'staff');
 assert.equal(result.length,101);assert.equal(urls[1],'/staff/support/cases?limit=100&offset=100');
});
