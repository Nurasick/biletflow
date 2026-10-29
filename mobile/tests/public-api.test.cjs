const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/api/public.ts'), 'utf8').replace("import { API_V1_URL } from '@/constants/api';", "const API_V1_URL = 'https://api.example.test/api/v1';");
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const api = {exports: {}};
new Function('exports', 'module', compiled)(api.exports, api);
const {all, decode, eventDate, money} = api.exports;
const originalFetch = global.fetch;
afterEach(() => {global.fetch = originalFetch;});
test('inventory pagination keeps tickets beyond the first page', async () => {
 const calls = [];
 global.fetch = async url => {calls.push(url); return Response.json(calls.length === 1 ? Array.from({length:100}, (_,id)=>({id})) : [{id:100}]);};
 const tickets = await all('/events/42/tickets');
 assert.equal(tickets.length,101);
 assert.equal(calls[1],'https://api.example.test/api/v1/events/42/tickets?limit=100&offset=100');
});
test('reservation conflicts retain the server explanation', async () => {
 await assert.rejects(decode(Response.json({detail:'One or more requested tickets are no longer available'},{status:409})), /no longer available/);
});
test('registration validation errors are readable', async () => {
 await assert.rejects(decode(Response.json({detail:[{msg:'Invalid email'},{msg:'Password too short'}]},{status:422})), /Invalid email\nPassword too short/);
});
test('pagination failures do not return incomplete inventory', async () => {
 let calls=0; global.fetch=async()=> ++calls===1 ? Response.json(Array.from({length:100},(_,id)=>({id}))) : Response.json({detail:'Unavailable'},{status:503});
 await assert.rejects(all('/events/42/tickets'), /Unavailable/);
});
test('event dates use the event timezone', () => {
 const date=eventDate({starts_at:'2026-10-28T20:00:00Z',timezone:'Asia/Almaty'});
 assert.match(date,/29 Oct 2026/);assert.match(date,/01:00/);
 assert.equal(money('8500.50'),'8,500.50 KZT');
});

test('checkout uses ticket types and named attendees for the current backend contract', () => {
 const type = {id:7,available:5,max_per_order:2,sales_start_at:null,sales_end_at:null};
 assert.deepEqual(api.exports.checkoutItems('{"7":2}',[type],{'7-0':' Alice ','7-1':'Bob'}), [{ticket_type_id:7,attendees:[{full_name:'Alice'},{full_name:'Bob'}]}]);
 assert.throws(()=>api.exports.checkoutItems('{"7":3}',[type],{}),/no longer available/);
 assert.throws(()=>api.exports.checkoutItems('{"8":1}',[type],{}),/no longer available/);
 assert.throws(()=>api.exports.checkoutItems('{"7":1}',[type],{}),/name for every attendee/);
});
test('closed sales and the global quantity limit cannot proceed', () => {
 const type={id:7,available:100,max_per_order:null,sales_start_at:null,sales_end_at:'2000-01-01T00:00:00Z'};
 assert.equal(api.exports.ticketLimit(type),0);
 assert.equal(api.exports.ticketLimit({...type,sales_end_at:null}),20);
});
