/** Explicit integration command only: node scripts/checkin-integration.cjs --isolated
 * Starts unique disposable containers, migrates a fresh tmpfs Postgres database,
 * exercises the actual mobile API adapters over HTTP, and removes only its own resources.
 * No Compose services, existing databases, real users, SMTP, or production secrets are used.
 */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

if(!process.argv.includes('--isolated')){
 console.error('Usage: node scripts/checkin-integration.cjs --isolated');
 process.exit(2);
}
const suffix=Date.now().toString(36)+'-'+randomBytes(4).toString('hex');
const prefix='biletflow-mobile-qa-'+suffix;
const names={network:prefix,db:prefix+'-db',api:prefix+'-api',image:prefix+':test'};
const password=randomBytes(24).toString('base64url');
const signingKey=randomBytes(48).toString('base64url');
const label='biletflow.mobile.qa='+suffix;
let assertions=0;
const dockerChildren=new Set();
let cleanupPromise;
let stopping=false;
function pass(label){assertions++;console.log('PASS '+label);}
function run(args,{input,allowFailure=false,timeout=600000}={}){
 return new Promise((resolve,reject)=>{
   const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
   dockerChildren.add(child);
   let stdout='',stderr='';
   child.stdout.on('data',data=>{stdout+=data;});
   child.stderr.on('data',data=>{stderr+=data;});
   const timer=setTimeout(()=>{child.kill();if(allowFailure)resolve({code:124,stdout,stderr});else reject(new Error('Docker operation timed out: '+args[0]));},timeout);
   child.on('error',()=>{dockerChildren.delete(child);clearTimeout(timer);if(allowFailure)resolve({code:127,stdout,stderr});else reject(new Error('Docker CLI is unavailable'));});
   child.on('close',code=>{dockerChildren.delete(child);clearTimeout(timer);if(code!==0&&!allowFailure){const error=new Error('Docker operation failed: '+args[0]);error.operation=args[0];error.stderr=stderr;reject(error);}else resolve({code,stdout,stderr});});
   child.stdin.end(input??'');
 });
}
function loadAdapter(relative){
 const output={exports:{}};
 const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('exports','module',compiled)(output.exports,output);
 return output.exports;
}
async function waitUntil(check,label,limit=90){
 for(let attempt=0;attempt<limit;attempt++){try{if(await check())return;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
 throw new Error('Timed out waiting for '+label);
}
function cleanup(){
 if(cleanupPromise)return cleanupPromise;
 cleanupPromise=(async()=>{
 for(const container of [names.api,names.db]){
   const result=await run(['inspect','--format','{{index .Config.Labels "biletflow.mobile.qa"}}',container],{allowFailure:true,timeout:12000});
   if(result.code===0&&result.stdout.trim()===suffix)await run(['rm','--force',container],{allowFailure:true,timeout:12000});
 }
 const network=await run(['network','inspect','--format','{{index .Labels "biletflow.mobile.qa"}}',names.network],{allowFailure:true,timeout:12000});
 if(network.code===0&&network.stdout.trim()===suffix)await run(['network','rm',names.network],{allowFailure:true,timeout:12000});
 await run(['image','rm',names.image],{allowFailure:true,timeout:12000});
 })();
 return cleanupPromise;
}
async function stop(){
 if(stopping)return;
 stopping=true;
 for(const child of dockerChildren)child.kill();
 await cleanup();
 process.exit(130);
}
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());

(async()=>{
 let ticker;
 try{
   if((await run(['info'],{allowFailure:true,timeout:12000})).code!==0){
     if(process.platform!=='win32')throw new Error('Start Docker before running isolated integration');
     await run(['desktop','start'],{timeout:45000});
     await waitUntil(async()=>(await run(['info'],{allowFailure:true,timeout:12000})).code===0,'Docker',3);
   }
   console.log('SETUP disposable backend image and database');
   ticker=setInterval(()=>console.log('SETUP isolated backend image is still building'),25000);
   await run(['build','--label',label,'--tag',names.image,path.resolve(__dirname,'../../backend')],{timeout:360000});
   clearInterval(ticker);ticker=null;
   await run(['network','create','--label',label,names.network]);
   await run(['run','--detach','--rm','--name',names.db,'--label',label,'--network',names.network,'--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_DB=mobile_qa','--env','POSTGRES_USER=mobile_qa','--env','POSTGRES_PASSWORD='+password,'postgres:17']);
   await waitUntil(async()=>(await run(['exec',names.db,'pg_isready','-U','mobile_qa','-d','mobile_qa'],{allowFailure:true,timeout:12000})).code===0,'QA Postgres');
   const env={DATABASE_URL:'postgresql+psycopg://mobile_qa:'+password+'@'+names.db+':5432/mobile_qa',SECRET_KEY:signingKey,BILETFLOW_MOBILE_QA:'1',HOLD_SWEEP_INTERVAL_SECONDS:'0',NOTIFY_INTERVAL_SECONDS:'0',SMTP_HOST:'',MEDIA_ROOT:'/tmp/qa-media',ENVIRONMENT:'local'};
   const args=['run','--detach','--rm','--name',names.api,'--label',label,'--network',names.network,'--publish','127.0.0.1::8000','--mount','type=bind,source='+path.resolve(__dirname)+',target=/qa,readonly'];
   for(const [key,value]of Object.entries(env))args.push('--env',key+'='+value);
   args.push(names.image,'sh','-c','alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning');
   await run(args);
   const mapping=await run(['port',names.api,'8000/tcp']);
   const match=mapping.stdout.match(/127\.0\.0\.1:(\d+)/);
   if(!match)throw new Error('No isolated loopback port was allocated');
   const base='http://127.0.0.1:'+match[1]+'/api/v1';
   await waitUntil(async()=>{const response=await fetch(base+'/health',{signal:AbortSignal.timeout(3000)});return response.ok;},'migrated API');
   const seeded=await run(['exec','--interactive',names.api,'python','/qa/qa-seed.py','init'],{input:JSON.stringify({password})});
   const fixture=JSON.parse(seeded.stdout.trim());
   const {staffApi}=loadAdapter('../src/shared/api/staff.ts');
   const {supportApi,visibleMessages}=loadAdapter('../src/shared/api/support.ts');
   async function raw(route,{token,body,method='GET',expect=200}={}){
     const headers={...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})};
     const response=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
     assert.equal(response.status,expect,'Unexpected HTTP status for '+method+' '+route);
     return response.status===204?null:response.json();
   }
   const auth={};
   for(const [role,user]of Object.entries(fixture.users)){
     const response=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Auth-Mode':'bearer'},body:JSON.stringify({email:user.email,password})});
     assert.equal(response.status,200,'QA login failed');
     const token=(await response.json()).access_token;
     auth[role]={token,fetcher:(route,init={})=>fetch(base+route,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:'Bearer '+token}})};
   }
   pass('real bearer login for fixture accounts');
   const [eventId,otherId,unassignedId]=fixture.event_ids;
   const assigned=await staffApi.events(auth.door.fetcher);
   assert.deepEqual(assigned.map(event=>event.id).sort((a,b)=>a-b),[eventId,otherId]);
   assert.deepEqual(await staffApi.events(auth.outsider.fetcher),[]);
   pass('assigned-event filtering excludes unrelated events');
   await assert.rejects(staffApi.attendance(auth.door.fetcher,unassignedId),error=>error.status===403);
   await assert.rejects(staffApi.attendance(auth.outsider.fetcher,eventId),error=>error.status===403);
   pass('unassigned and outsider accounts are denied');
   const order=await raw('/events/'+fixture.slug+'/orders',{method:'POST',token:auth.attendee.token,expect:201,body:{contact_name:'QA Attendee',contact_email:fixture.users.attendee.email,items:[{ticket_type_id:fixture.ticket_type_id,attendees:Array.from({length:6},(_,index)=>({full_name:'QA Guest '+index}))}]}});
   assert.equal(order.status,'confirmed');assert.equal(order.tickets.length,6);
   pass('real free checkout issues server-signed tickets');
   const tickets=order.tickets;
   const states=await run(['exec','--interactive',names.api,'python','/qa/qa-seed.py','ticket-states'],{input:JSON.stringify({cancelled:tickets[2].public_code,refunded:tickets[3].public_code,campaign_source:tickets[0].public_code})});
   const {campaign}=JSON.parse(states.stdout.trim());
   const scan=async(index,target=eventId)=>staffApi.scan(auth.door.fetcher,target,tickets[index].qr_payload,'isolated mobile QA');
   assert.equal((await scan(0)).outcome,'valid');
   assert.equal((await scan(0)).outcome,'already_used');
   pass('admission succeeds once and rejects duplicate entry');
   assert.equal((await scan(1,otherId)).outcome,'wrong_event');
   const tampered=tickets[1].qr_payload.slice(0,-1)+(tickets[1].qr_payload.endsWith('A')?'B':'A');
   assert.equal((await staffApi.scan(auth.door.fetcher,eventId,tampered,'isolated mobile QA')).outcome,'invalid');
   assert.equal((await staffApi.scan(auth.door.fetcher,eventId,campaign,'isolated mobile QA')).outcome,'invalid');
   assert.equal((await staffApi.scan(auth.door.fetcher,eventId,'https://example.test/event?campaign=example','isolated mobile QA')).outcome,'invalid');
   pass('wrong-event, tampered, signed campaign and campaign-link codes never admit');
   assert.equal((await scan(2)).outcome,'cancelled');assert.equal((await scan(3)).outcome,'refunded');
   pass('cancelled and refunded tickets are rejected distinctly');
   const races=await Promise.all([scan(4),scan(4)]);
   assert.deepEqual(races.map(result=>result.outcome).sort(),['already_used','valid']);
   pass('concurrent scans produce exactly one admission on PostgreSQL');
   const found=await staffApi.search(auth.door.fetcher,eventId,'QA Guest 1');
   assert.equal(found.length,1);assert.equal(found[0].public_code,tickets[1].public_code);
   assert.equal((await staffApi.checkIn(auth.door.fetcher,eventId,tickets[1].public_code,'isolated mobile QA')).outcome,'valid');
   assert.equal((await staffApi.reverse(auth.door.fetcher,eventId,tickets[1].public_code,'isolated mobile QA')).status,'valid');
   assert.equal((await staffApi.search(auth.door.fetcher,eventId,tickets[1].public_code))[0].status,'valid');
   pass('manual search, check-in and reversal reconcile ticket status');
   const counts=await staffApi.attendance(auth.door.fetcher,eventId);
   assert.equal(counts.registered,4);assert.equal(counts.checked_in,2);assert.equal(counts.absent,2);
   pass('attendance totals match authoritative ticket states');
   const supportCase=await supportApi.create(auth.attendee.fetcher,{audience:'attendee',category:'check_in',body:'QA contextual support request',ticket_code:tickets[1].public_code});
   assert.equal(supportCase.context.event_id,eventId);assert.equal(supportCase.context.order_number,order.order_number);assert.equal(supportCase.context.ticket_code,tickets[1].public_code);
   pass('support request retains event, order and ticket context');
   assert.ok((await supportApi.list(auth.owner.fetcher,'staff')).some(item=>item.case_number===supportCase.case_number));
   assert.deepEqual(await supportApi.list(auth.door.fetcher,'staff'),[]);
   await assert.rejects(supportApi.read(auth.outsider.fetcher,supportCase.case_number,'requester'),/not found|access/);
   pass('support queues and conversations enforce relationship authorization');
   let current=await supportApi.assign(auth.owner.fetcher,supportCase.case_number,fixture.users.owner.id);
   assert.equal(current.status,'in_progress');
   const privateMarker='internal-'+suffix;
   await supportApi.reply(auth.owner.fetcher,supportCase.case_number,'staff',privateMarker,true);
   const requesterRead=await supportApi.read(auth.attendee.fetcher,supportCase.case_number,'requester');
   assert.equal(visibleMessages(requesterRead,'requester').some(message=>message.body===privateMarker),false);
   assert.equal(requesterRead.messages.some(message=>Object.hasOwn(message,'is_internal_note')),false);
   pass('staff internal notes never appear in requester responses');
   current=await supportApi.reply(auth.owner.fetcher,supportCase.case_number,'staff','QA public reply');
   current=await supportApi.transition(auth.owner.fetcher,current,'waiting_for_customer');
   assert.equal(current.status,'waiting_for_customer');
   await raw('/staff/support/cases/'+supportCase.case_number,{method:'PATCH',token:auth.owner.token,body:{status:'in_progress'},expect:409});
   current=await supportApi.reply(auth.attendee.fetcher,supportCase.case_number,'requester','QA requester follow-up');assert.equal(current.status,'in_progress');
   current=await supportApi.transition(auth.owner.fetcher,current,'resolved');
   current=await supportApi.reply(auth.attendee.fetcher,supportCase.case_number,'requester','QA reopened question');assert.equal(current.status,'in_progress');
   pass('support replies and status transitions match the backend state machine');
   const feed=await raw('/users/me/notifications',{token:auth.attendee.token});
   assert.ok(feed.items.some(item=>item.template_key==='order.confirmed'));assert.ok(feed.unread>0);
   await raw('/users/me/notifications/read',{method:'POST',token:auth.attendee.token,expect:204});
   assert.equal((await raw('/users/me/notifications',{token:auth.attendee.token})).unread,0);
   pass('order notification feed and mark-read work over HTTP');
   console.log('PASS '+assertions+' integration groups completed against fresh PostgreSQL');
 }finally{
   if(ticker)clearInterval(ticker);
   await cleanup();
 }
})().catch(error=>{console.error('FAIL '+error.message);process.exitCode=1;});
