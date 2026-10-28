const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/lib/session-storage.web.ts'), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const storage = {exports:{}};
new Function('exports','module',compiled)(storage.exports,storage);
const api = storage.exports;
const originalWindow = global.window;
afterEach(() => { if(originalWindow === undefined) delete global.window; else global.window = originalWindow; });
test('browser remembered session can be saved, restored and removed without native APIs', async () => {
 const values = new Map();
 global.window = {localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
 await api.setItemAsync('session','remembered');
 assert.equal(await api.getItemAsync('session'),'remembered');
 await api.deleteItemAsync('session');
 assert.equal(await api.getItemAsync('session'),null);
});
test('server rendering has no browser storage dependency', async () => {
 delete global.window;
 assert.equal(await api.getItemAsync('session'),null);
 await api.deleteItemAsync('session');
});
test('blocked storage starts signed out and gives actionable save error', async () => {
 global.window = {get localStorage(){throw new Error('blocked');}};
 assert.equal(await api.getItemAsync('session'),null);
 await assert.rejects(api.setItemAsync('session','token'),/Disable Remember me/);
});
test('native entry point retains encrypted SecureStore', () => {
 const native = fs.readFileSync(require.resolve('../src/lib/session-storage.ts'),'utf8');
 assert.match(native,/from 'expo-secure-store'/);
 assert.doesNotMatch(native,/localStorage/);
});
