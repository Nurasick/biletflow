const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
function load(file){const source=fs.readFileSync(require.resolve(file),'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const value={exports:{}};new Function('exports','module',js)(value.exports,value);return value.exports;}
const {managementApi,adminManagementApi}=load('../src/shared/api/management.ts');

test('organizer management API uses event-scoped campaign and timeline contracts',async()=>{
 const calls=[];const fetcher=async(path,init={})=>{calls.push({path,init});return Response.json({ok:true});};
 await managementApi.duplicate(fetcher,12);
 await managementApi.updateCampaign(fetcher,12,8,{is_active:false});
 await managementApi.timeline(fetcher,12,{action:'campaign.created'});
 assert.equal(calls[0].path,'/organizer/events/12/duplicate');
 assert.equal(calls[1].path,'/organizer/events/12/campaigns/8');
 assert.equal(calls[2].path,'/organizer/events/12/timeline?limit=100&offset=0&action=campaign.created');
});

test('admin API applies payment and order status filters',async()=>{
 const calls=[];const fetcher=async(path)=>{calls.push(path);return Response.json([]);};
 await adminManagementApi.orders(fetcher,'concert','confirmed');
 await adminManagementApi.payments(fetcher,'failed');
 assert.match(calls[0],/\/admin\/orders\?.*q=concert.*status=confirmed/);
 assert.match(calls[1],/\/admin\/payments\?.*status=failed/);
});
