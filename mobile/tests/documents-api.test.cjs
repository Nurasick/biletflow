const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync(require.resolve('../src/shared/api/documents.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const links=[];global.document={body:{appendChild(){}},createElement(){return{click(){links.push({href:this.href,download:this.download});},remove(){}};}};
const apiExports={};const mockRequire=id=>id==='expo-file-system'?{File:class{},Paths:{cache:{}}}:id==='expo-sharing'?{}:id==='react-native'?{Linking:{},Platform:{OS:'web'}}:id==='@/constants/api'?{API_V1_URL:'https://api.example.test/api/v1'}:{};
new Function('exports','module','require',compiled)(apiExports,{exports:apiExports},mockRequire);

test('calendar export uses the public event ICS endpoint and a useful filename',async()=>{
 links.length=0;
 await apiExports.openEventCalendar('indie-night');
 assert.deepEqual(links,[{href:'https://api.example.test/api/v1/events/indie-night/calendar.ics',download:'indie-night.ics'}]);
});

test('calendar export appends encoded access_token for private events',async()=>{
 links.length=0;
 await apiExports.openEventCalendar('secret-gala','tok/123+4');
 assert.deepEqual(links,[{href:'https://api.example.test/api/v1/events/secret-gala/calendar.ics?access_token=tok%2F123%2B4',download:'secret-gala.ics'}]);
});

test('order calendar export uses authenticated order ICS endpoint with text/calendar accept header',async()=>{
 links.length=0;
 const calls=[];
 const fetcher=async(path,init)=>{calls.push({path,init});return new Response('BEGIN:VCALENDAR\nEND:VCALENDAR',{status:200,headers:{'Content-Type':'text/calendar'}});};
 const origSetTimeout=global.setTimeout;
 const origCreateObjectURL=URL.createObjectURL;
 const origRevokeObjectURL=URL.revokeObjectURL;
 const revoked=[];
 global.setTimeout=(fn)=>{fn();return 0;};
 URL.createObjectURL=()=>'blob:https://api.example.test/order-cal';
 URL.revokeObjectURL=(url)=>{revoked.push(url);};
 try{
  await apiExports.downloadOrderCalendar(fetcher,'ORD-42/A','secret-gala');
 }finally{
  global.setTimeout=origSetTimeout;
  URL.createObjectURL=origCreateObjectURL;
  URL.revokeObjectURL=origRevokeObjectURL;
 }
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/orders/ORD-42%2FA/calendar.ics');
 assert.equal(calls[0].init.headers.Accept,'text/calendar');
 assert.deepEqual(links,[{href:'blob:https://api.example.test/order-cal',download:'secret-gala.ics'}]);
 assert.deepEqual(revoked,['blob:https://api.example.test/order-cal']);
});
