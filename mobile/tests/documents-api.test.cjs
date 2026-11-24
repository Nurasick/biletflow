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
 await apiExports.openEventCalendar('indie-night');
 assert.deepEqual(links,[{href:'https://api.example.test/api/v1/events/indie-night/calendar.ics',download:'indie-night.ics'}]);
});
