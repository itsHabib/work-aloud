import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

test('the standalone server serves public assets and rejects source and cross-origin requests',{timeout:10000},async t=>{
  const server=spawn(process.execPath,['server.mjs','0'],{cwd:fileURLToPath(new URL('./',import.meta.url)),stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(server.exitCode!==null)return;server.kill();await once(server,'exit');});
  const origin=await new Promise((resolve,reject)=>{
    server.on('error',reject);
    server.stdout.on('data',chunk=>{const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)resolve(url);});
  });
  const page=await fetch(origin);
  assert.equal(page.status,200);assert.match(await page.text(),/<title>Work Aloud<\/title>/);
  assert.match(page.headers.get('content-security-policy'),/default-src 'self'/);
  const head=await fetch(origin+'/narrator-client.mjs',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const path of ['/.env','/speech.mjs','/package.json'])assert.equal((await fetch(origin+path)).status,404);
  assert.equal((await fetch(origin+'/%2e%2e%2fpackage.json')).status,403);
  const rejected=await fetch(origin+'/api/speech',{method:'POST',headers:{Origin:'https://elsewhere.example','Content-Type':'application/json'},body:'{"text":"This must not be spoken."}'});
  assert.equal(rejected.status,403);
});
