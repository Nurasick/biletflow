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
