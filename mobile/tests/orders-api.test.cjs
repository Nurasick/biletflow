const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync(require.resolve('../src/shared/api/orders.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const api={exports:{}};new Function('exports','module',compiled)(api.exports,api);
const {ordersApi,formatOrderMoney}=api.exports;

test('orders API requests list, payment outcome and cancellation contracts',async()=>{
 const calls=[];const fetcher=async(path,init={})=>{calls.push({path,init});return Response.json({order_number:'BF-1'});};
 await ordersApi.mine(fetcher);await ordersApi.pay(fetcher,'BF-1','fail');await ordersApi.cancel(fetcher,'BF-1');
 assert.equal(calls[0].path,'/users/me/orders');
 assert.equal(calls[1].path,'/orders/BF-1/pay');assert.deepEqual(JSON.parse(calls[1].init.body),{outcome:'fail'});
 assert.equal(calls[2].init.method,'POST');
});

test('order money formatting accepts the selected locale',()=>{
 assert.match(formatOrderMoney(125000,'KZT','ru'),/₸/);
});
