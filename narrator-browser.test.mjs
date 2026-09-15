import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

// Four seconds of local PCM silence exercise real media timing without an API call.
function silence(){
  const rate=8000,bytes=rate*4*2,clip=Buffer.alloc(44+bytes);
  clip.write('RIFF');clip.writeUInt32LE(36+bytes,4);clip.write('WAVEfmt ',8);
  clip.writeUInt32LE(16,16);clip.writeUInt16LE(1,20);clip.writeUInt16LE(1,22);
  clip.writeUInt32LE(rate,24);clip.writeUInt32LE(rate*2,28);clip.writeUInt16LE(2,32);clip.writeUInt16LE(16,34);
  clip.write('data',36);clip.writeUInt32LE(bytes,40);return clip;
}

test('generated edit playback, frozen questions, continuation and model failures in the browser',{timeout:60000},async t=>{
  const server=spawn(process.execPath,['server.mjs','0'],{cwd:fileURLToPath(new URL('./',import.meta.url)),stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(server.exitCode!==null)return;server.kill();await once(server,'exit');});
  const origin=await new Promise((resolve,reject)=>{server.on('error',reject);server.stdout.on('data',chunk=>{const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)resolve(url);});});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const requests=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  const clip=silence();
  const initial='function twice(value) {\n  return value * 2;\n}\n';
  const final=initial+'const example = twice(3);\n';
  let fail=false;
  await page.route('**/api/speech',route=>route.fulfill({status:200,contentType:'audio/wav',body:clip}));
  await page.route('**/api/end',route=>route.fulfill({status:200,json:{closed:true}}));
  await page.route('**/api/narrate',route=>{
    const input=route.request().postDataJSON();requests.push(input);
    const records=[{type:'session',id:'browser-fixture',model:'fixture'}];
    if(fail)records.push({type:'error',message:'Deliberate interrupted-stream fixture.'});
    if(!fail&&input.kind==='start')records.push({type:'beat',say:'I am writing a small function as this audio plays.',code:initial},{type:'beat',say:'Now a concrete example shows how to call it.',code:final},{type:'done'});
    if(!fail&&input.kind==='question')records.push({type:'beat',say:'This is an automated answer fixture, not a live model.',code:null},{type:'done'});
    if(!fail&&input.kind==='continue')records.push({type:'beat',say:'Continue from the visible partial code.',code:final},{type:'done'});
    return route.fulfill({status:200,contentType:'application/x-ndjson',body:records.map(JSON.stringify).join('\n')+'\n'});
  });
  await page.addInitScript(()=>{const Native=window.Audio;window.Audio=function(...args){const audio=new Native(...args);audio.playbackRate=8;return audio;};});
  await page.goto(origin);await page.waitForFunction(()=>window.narratorDemo);
  const snapshot=()=>page.evaluate(()=>window.narratorDemo.snapshot());
  await page.locator('#start').click();await page.waitForFunction(()=>window.narratorDemo.snapshot().current?.progress>0.15);
  const during=await snapshot();assert.ok(during.code.length>0&&during.code.length<initial.length,'code is typed while speech is playing');
  await page.locator('#question').fill('What happens for negative values?');const frozen=(await snapshot()).code;
  await page.waitForTimeout(300);assert.equal((await snapshot()).code,frozen,'focus freezes the exact partially typed code');
  await page.locator('#ask').click();await page.waitForFunction(()=>window.narratorDemo.snapshot().phase==='answering');
  assert.equal((await snapshot()).code,frozen,'answering cannot advance the editor');
  assert.equal(requests[1].code,frozen);assert.equal(requests[1].question,'What happens for negative values?');
  await page.locator('#continue').click();await page.waitForFunction(()=>window.narratorDemo.snapshot().phase==='complete');
  assert.equal(requests[2].code,frozen);assert.equal((await snapshot()).code,final);
  assert.ok((await snapshot()).events.some(event=>event.type==='spoken'));
  for(const width of [390,900,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no horizontal overflow at ${width}`);}
  await page.locator('#stop').click();assert.equal((await snapshot()).session,null);
  fail=true;await page.locator('#start').click();await page.waitForFunction(()=>window.narratorDemo.snapshot().phase==='error');
  assert.match(await page.locator('#status').innerText(),/Deliberate interrupted-stream fixture/);
  assert.equal((await snapshot()).complete,false);assert.deepEqual(errors,[]);
});

test('superseded playback and delayed session closure cannot revive stopped work',{timeout:30000},async t=>{
  const server=spawn(process.execPath,['server.mjs','0'],{cwd:fileURLToPath(new URL('./',import.meta.url)),stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(server.exitCode!==null)return;server.kill();await once(server,'exit');});
  const origin=await new Promise((resolve,reject)=>{server.on('error',reject);server.stdout.on('data',chunk=>{const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)resolve(url);});});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();const requests=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  const clip=silence();
  let questionRoute,endRoute;
  const response=question=>[{type:'session',id:'race-fixture',model:'fixture'},{type:'beat',say:'Automated race fixture.',code:question?null:'function example() {}'},{type:'done'}].map(JSON.stringify).join('\n')+'\n';
  await page.route('**/api/speech',route=>route.fulfill({status:200,contentType:'audio/wav',body:clip}));
  await page.route('**/api/end',route=>{endRoute=route;});
  await page.route('**/api/narrate',route=>{
    const input=route.request().postDataJSON();requests.push(input);
    if(input.kind==='question'){questionRoute=route;return;}
    return route.fulfill({status:200,contentType:'application/x-ndjson',body:response(false)});
  });
  await page.addInitScript(()=>{
    const Native=window.Audio;let first=true;
    window.Audio=function(...args){const audio=new Native(...args);audio.playbackRate=8;if(first){first=false;audio.play=()=>new Promise((resolve,reject)=>{window.rejectOldPlay=()=>reject(Error('Interrupted playback'));});}return audio;};
  });
  await page.goto(origin);await page.locator('#start').click();await page.waitForFunction(()=>window.rejectOldPlay);
  await page.locator('#question').fill('Explain this choice');await page.locator('#ask').click();
  await page.waitForFunction(()=>window.narratorDemo.snapshot().kind==='question');
  await page.evaluate(()=>window.rejectOldPlay());
  while(!questionRoute)await new Promise(resolve=>setImmediate(resolve));
  await questionRoute.fulfill({status:200,contentType:'application/x-ndjson',body:response(true)});
  await page.waitForFunction(()=>window.narratorDemo.snapshot().phase==='question');
  assert.equal(requests.length,2,'the new answer plays despite the old clip rejecting');
  await page.locator('#start').click();await page.waitForFunction(()=>window.narratorDemo.snapshot().phase==='starting');
  assert.equal(await page.locator('#stop').isEnabled(),true);await page.locator('#stop').click();
  while(!endRoute)await new Promise(resolve=>setImmediate(resolve));
  await endRoute.fulfill({status:200,json:{closed:true}});await page.waitForTimeout(100);
  assert.equal(requests.length,2,'no model request starts after the later End');
  assert.equal(await page.evaluate(()=>window.narratorDemo.snapshot().phase),'idle');assert.deepEqual(errors,[]);
});
