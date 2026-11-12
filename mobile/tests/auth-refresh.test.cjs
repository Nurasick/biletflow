const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
const sessionKey='biletflow.auth.session.v1';
const tokens=(prefix)=>({access_token:prefix+'-access',refresh_token:prefix+'-refresh'});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function until(predicate){for(let turn=0;turn<60;turn++){if(predicate())return;await new Promise(setImmediate);}throw new Error('Expected asynchronous step was not reached');}

function harness(initialStored){
 const slots=[];const effects=[];let cursor=0;let value;let cleanup=[];
 const values=new Map(initialStored?[[sessionKey,JSON.stringify(initialStored)]]:[]);
 const storageControl={setGate:null,setStarted:0};
 const storage={
   async getItemAsync(key){return values.get(key)??null;},
   async setItemAsync(key,data){storageControl.setStarted++;if(storageControl.setGate)await storageControl.setGate.promise;values.set(key,data);},
   async deleteItemAsync(key){values.delete(key);},
 };
 const react={
   createContext(){return {Provider:'provider'};},
   useContext(){return value;},
   useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];},
   useRef(initial){const index=cursor++;if(!slots[index])slots[index]={current:initial};return slots[index];},
   useCallback(callback){cursor++;return callback;},
   useMemo(factory){cursor++;return factory();},
   useEffect(callback){const index=cursor++;if(!slots[index]){slots[index]={effect:true};effects.push(callback);}},
 };
 function load(file){
   const output={exports:{}};
   const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
   const localRequire=(specifier)=>{
     if(specifier==='react')return react;
     if(specifier==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
     if(specifier==='@/lib/session-storage')return storage;
     if(specifier==='@/constants/api')return {API_V1_URL:'https://api.example.test/api/v1'};
     if(specifier==='@/lib/single-flight')return load(path.join(__dirname,'../src/lib/single-flight.ts'));
     throw new Error('Unexpected test import: '+specifier);
   };
   new Function('exports','module','require',compiled)(output.exports,output,localRequire);
   return output.exports;
 }
 const auth=load(path.join(__dirname,'../src/providers/auth-provider.tsx'));
 const render=()=>{cursor=0;value=auth.AuthProvider({children:null}).props.value;return value;};
 render();
 return {
   value:render,values,storageControl,
   runEffects(){cleanup=effects.splice(0).map(effect=>effect());},
   dispose(){for(const stop of cleanup)if(typeof stop==='function')stop();},
 };
}
async function login(app,remember=false){assert.equal(await app.value().login('operator@example.test','test-password',remember),true);assert.equal(app.value().isLoggedIn,true);}

 test('concurrent unauthorized requests share one token refresh and retry with the new token',async()=>{
   const refresh=deferred();let refreshes=0;const attempts=[];
   global.fetch=async(url,init)=>{
     if(url.endsWith('/auth/login'))return Response.json(tokens('first'));
     if(url.endsWith('/auth/refresh')){refreshes++;return refresh.promise;}
     attempts.push({url,authorization:new Headers(init.headers).get('Authorization')});
     return attempts.at(-1).authorization==='Bearer first-access'?new Response(null,{status:401}):Response.json({ok:true});
   };
   const app=harness();await login(app);
   const first=app.value().authenticatedFetch('/staff/events');
   const second=app.value().authenticatedFetch('/support/cases');
   await until(()=>refreshes===1);refresh.resolve(Response.json(tokens('rotated')));
   assert.deepEqual((await Promise.all([first,second])).map(response=>response.status),[200,200]);
   assert.equal(refreshes,1);assert.equal(attempts.filter(attempt=>attempt.authorization==='Bearer rotated-access').length,2);
   assert.equal(app.value().accessToken,'rotated-access');
 });

 test('a late refresh response cannot sign a logged-out operator back in',async()=>{
   const refresh=deferred();let started=false;
   global.fetch=async(url)=>{
     if(url.endsWith('/auth/login'))return Response.json(tokens('first'));
     if(url.endsWith('/auth/refresh')){started=true;return refresh.promise;}
     if(url.endsWith('/auth/logout'))return new Response(null,{status:204});
     return new Response(null,{status:401});
   };
   const app=harness();await login(app,true);
   const pending=app.value().authenticatedFetch('/staff/events');
   const rejection=assert.rejects(pending,/session has changed|session has ended/);
   await until(()=>started);await app.value().logout();refresh.resolve(Response.json(tokens('late')));await rejection;
   assert.equal(app.value().isLoggedIn,false);assert.equal(app.values.has(sessionKey),false);
 });

 test('temporary refresh network failure retains the current session for an explicit retry',async()=>{
   global.fetch=async(url)=>{
     if(url.endsWith('/auth/login'))return Response.json(tokens('first'));
     if(url.endsWith('/auth/refresh'))throw new TypeError('offline');
     return new Response(null,{status:401});
   };
   const app=harness();await login(app,true);
   await assert.rejects(app.value().authenticatedFetch('/staff/events'),/Could not reach/);
   assert.equal(app.value().isLoggedIn,true);assert.equal(app.value().accessToken,'first-access');assert.equal(app.values.has(sessionKey),true);
 });

 test('an aborted unauthorized request does not start a token refresh',async()=>{
   let refreshes=0;const controller=new AbortController();
   global.fetch=async(url)=>{
     if(url.endsWith('/auth/login'))return Response.json(tokens('first'));
     if(url.endsWith('/auth/refresh')){refreshes++;return Response.json(tokens('rotated'));}
     controller.abort();return new Response(null,{status:401});
   };
   const app=harness();await login(app);
   await assert.rejects(app.value().authenticatedFetch('/staff/events',{signal:controller.signal}),error=>error.name==='AbortError');
   assert.equal(refreshes,0);
 });

 test('aborting during a shared refresh never retries the cancelled API request',async()=>{
   const refresh=deferred();let started=false;let apiCalls=0;const controller=new AbortController();
   global.fetch=async(url)=>{
     if(url.endsWith('/auth/login'))return Response.json(tokens('first'));
     if(url.endsWith('/auth/refresh')){started=true;return refresh.promise;}
     apiCalls++;return new Response(null,{status:401});
   };
   const app=harness();await login(app);
   const pending=app.value().authenticatedFetch('/staff/events',{signal:controller.signal});
   const rejection=assert.rejects(pending,error=>error.name==='AbortError');
   await until(()=>started);controller.abort();refresh.resolve(Response.json(tokens('rotated')));await rejection;
   assert.equal(apiCalls,1);
 });

 test('logout wins over deferred restore persistence and removes the saved session',async()=>{
   global.fetch=async(url)=>{
     if(url.endsWith('/auth/refresh'))return Response.json(tokens('restored'));
     if(url.endsWith('/auth/logout'))return new Response(null,{status:204});
     throw new Error('Unexpected URL '+url);
   };
   const app=harness({email:'operator@example.test',refreshToken:'stored-refresh'});
   const gate=deferred();app.storageControl.setGate=gate;app.runEffects();
   await until(()=>app.storageControl.setStarted>0);
   const logout=app.value().logout();gate.resolve();await logout;
   await until(()=>app.value().isRestoring===false);
   assert.equal(app.value().isLoggedIn,false);assert.equal(app.values.has(sessionKey),false);app.dispose();
 });
