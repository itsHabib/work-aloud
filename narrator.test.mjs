import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BeatParser,Narrator} from './narrator.mjs';
import {validateTurn,narratorApi} from './narrator-api.mjs';
import {editBetween,codeAt} from './public/typing.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';

test('streamed edits survive token splits inside escaped strings and unicode',()=>{
  const result=[],parser=new BeatParser(beat=>result.push(beat));
  const beat={say:'Count "words" — not characters.',code:'function count(text) {\n  return text.trim();\n}'};
  const stream=JSON.stringify(beat)+'\n'+JSON.stringify({say:'Why tabs work.',code:null})+'\n{"done":true}';
  for(const character of stream)parser.push(character);parser.end();
  assert.deepEqual(result,[beat,{say:'Why tabs work.',code:null}]);
});

test('incomplete or malformed model output cannot be presented as a completed demonstration',()=>{
  for(const stream of ['{"say":"x","code":""}\n','{"done":true}', '```json\n', '{"say":"x","code":3}\n', '{"done":true}\n{"say":"late","code":""}\n']){
    assert.throws(()=>{const parser=new BeatParser(()=>{});parser.push(stream);parser.end();});
  }
});

test('typing a middle replacement keeps the untouched suffix and reaches the exact generated file',()=>{
  const before='function f() {\n  return 0;\n}\n';const after='function f() {\n  return items.length;\n}\n';
  const edit=editBetween(before,after);
  assert.equal(codeAt(edit,1),after);assert.equal(codeAt(edit,0),'function f() {\n  return ;\n}\n');
  assert.ok(codeAt(edit,0.5).endsWith(';\n}\n'));
  assert.equal(codeAt(editBetween(after,''),1),'');
});

test('turn inputs bind continuation and real questions to an existing session and bounded visible code',()=>{
  const valid={kind:'start',session:null,task:'Write a cache',code:'',question:''};assert.equal(validateTurn(valid),valid);
  for(const change of [{kind:'shell'},{kind:'continue'},{kind:'question',session:'id'},{code:'x'.repeat(24001)},{task:''},{session:3}])assert.throws(()=>validateTurn({...valid,...change}));
  assert.equal(validateTurn({...valid,kind:'question',session:'id',question:'Why a map?'}).question,'Why a map?');
});

async function fixture(t,open){
  const api=narratorApi({open,speak:async()=>Buffer.from('fixture')});
  const server=createServer(async(req,res)=>{if(!await api.handle(req,res,`http://127.0.0.1:${server.address().port}`))res.writeHead(404).end();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,close:api.close,post:(input,signal)=>fetch(origin+'/api/narrate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input),signal})};
}

test('a disconnected initial request closes a late-created model session without starting inference',async t=>{
  let opened,finish,closed=0,calls=0;const started=new Promise(resolve=>{opened=resolve;});
  const {post}=await fixture(t,async()=>{opened();await new Promise(resolve=>{finish=resolve;});return {model:'fixture',close:async()=>{closed++;},turn:async()=>{calls++;}};});
  const abort=new AbortController();const pending=post({kind:'start',session:null,task:'Build',code:'',question:''},abort.signal);
  await started;abort.abort();await assert.rejects(pending);await new Promise(resolve=>setTimeout(resolve,30));finish();
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,0);assert.equal(closed,1);
});

test('the server rejects cross-origin generation before creating a model process',async t=>{
  let calls=0;const {origin}=await fixture(t,async()=>{calls++;});
  const response=await fetch(origin+'/api/narrate',{method:'POST',headers:{Origin:'https://elsewhere.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,403);assert.equal(calls,0);
});

test('server shutdown waits for an opening model connection and prevents inference',async t=>{
  let opened,finish,closed=false,calls=0;const started=new Promise(resolve=>{opened=resolve;});
  const {post,close}=await fixture(t,async()=>{opened();await new Promise(resolve=>{finish=resolve;});return {close:async()=>{closed=true;},turn:async()=>{calls++;}};});
  const abort=new AbortController(),pending=post({kind:'start',session:null,task:'Build',code:'',question:''},abort.signal).catch(()=>{});
  await started;let ended=false;const shutdown=close().then(()=>{ended=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(ended,false);
  finish();await shutdown;assert.equal(closed,true);assert.equal(calls,0);abort.abort();await pending;
});

test('a missing Codex executable can close without waiting for an exit that cannot happen',{timeout:1000},async()=>{
  const narrator=new Narrator();narrator.process=spawn('/does-not-exist/work-aloud-codex-test');
  await once(narrator.process,'error');await narrator.close();await narrator.close();assert.equal(narrator.closed,true);
});

test('questions wait for an interrupted response and use the exact submitted visible code',async t=>{
  let finish,stopped=0;const requests=[];
  const {post}=await fixture(t,async()=>({model:'fixture',close:async()=>{},stop:async()=>{if(finish){stopped++;finish();finish=null;}},turn:async(input,emit)=>{
    requests.push(input);emit({say:'A real response would go here.',code:input.kind==='question'?null:'future code'});
    if(input.kind==='start')await new Promise(resolve=>{finish=resolve;});
  }}));
  const start=await post({kind:'start',session:null,task:'Build',code:'',question:''});
  const reader=start.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);const session=JSON.parse(first.split('\n')[0]).id;
  const response=await post({kind:'question',session,task:'Build',code:'partly typed',question:'Why?'});
  assert.match(await response.text(),/"type":"done"/);assert.equal(stopped,1);
  assert.equal(requests[1].code,'partly typed');assert.equal(requests[1].question,'Why?');await reader.cancel();
});
