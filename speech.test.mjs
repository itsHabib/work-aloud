import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speechKey,synthesize} from './speech.mjs';

test('speech requires an explicit environment key and trims surrounding whitespace',async()=>{
  assert.equal(await speechKey({OPENAI_API_KEY:' environment-fixture '}),'environment-fixture');
  await assert.rejects(speechKey({}),/Set OPENAI_API_KEY/);
  await assert.rejects(speechKey({OPENAI_API_KEY:'  '}),/Set OPENAI_API_KEY/);
});

test('gateway credentials are not sent to the public OpenAI endpoint',async()=>{
  await assert.rejects(speechKey({OPENAI_API_KEY:'sk-bf-fixture'}),/gateway key/);
  await assert.rejects(speechKey({OPENAI_API_KEY:'fixture',OPENAI_BASE_URL:'https://gateway.example/v1'}),/custom OPENAI_BASE_URL/);
  await assert.rejects(speechKey({OPENAI_API_KEY:'credential-fixture\nsecond-line'}),error=>error.message==='The speech API key contains invalid characters. Check the configured key.');
});

test('Cedar receives only narration and returns audio without exposing the API key',async()=>{
  let request;const audio=Buffer.from('audio-fixture');
  const result=await synthesize('Start with a map.',new AbortController().signal,{key:async()=>'secret-fixture',send:async(url,options)=>{
    request={url,...options};return new Response(audio,{headers:{'Content-Type':'audio/mpeg'}});
  }});
  assert.equal(request.url,'https://api.openai.com/v1/audio/speech');assert.equal(request.redirect,'error');
  assert.equal(request.headers.Authorization,'Bearer secret-fixture');
  const input=JSON.parse(request.body);assert.equal(input.voice,'cedar');assert.equal(input.model,'gpt-4o-mini-tts');assert.equal(input.input,'Start with a map.');
  assert.equal(input.response_format,'mp3');assert.deepEqual(result,audio);assert.ok(!request.body.includes('secret-fixture'));
});

test('cancellation while loading a key prevents a paid speech request',async()=>{
  const abort=new AbortController();let calls=0;
  await assert.rejects(synthesize('A short explanation.',abort.signal,{key:async()=>{abort.abort();return 'fixture';},send:async()=>{calls++;}}),{name:'AbortError'});
  assert.equal(calls,0);
});

test('provider errors and empty speech fail without returning sensitive response text',async()=>{
  for(const status of [401,429,500]){
    await assert.rejects(synthesize('Explain.',new AbortController().signal,{key:async()=>'secret-fixture',send:async()=>new Response('secret-fixture private diagnostics',{status})}),error=>!error.message.includes('secret-fixture')&&/OpenAI/.test(error.message));
  }
  for(const response of [new Response('{}',{headers:{'Content-Type':'application/json'}}),new Response('',{headers:{'Content-Type':'audio/mpeg'}})]){
    await assert.rejects(synthesize('Explain.',new AbortController().signal,{key:async()=>'fixture',send:async()=>response}),/speech/);
  }
});

test('header validation and body failures never return credential-bearing diagnostics',async()=>{
  const secret='credential-fixture\nsecond-line';
  await assert.rejects(synthesize('Explain.',new AbortController().signal,{key:async()=>secret,send:(url,options)=>new Headers(options.headers)}),error=>error.message==='OpenAI speech could not connect. Try again.');
  const response=new Response('audio',{headers:{'Content-Type':'audio/mpeg'}});response.arrayBuffer=()=>{throw Error(secret);};
  await assert.rejects(synthesize('Explain.',new AbortController().signal,{key:async()=>'fixture',send:async()=>response}),error=>error.message==='The OpenAI speech download was interrupted. Try again.');
  const abort=new AbortController();
  await assert.rejects(synthesize('Explain.',abort.signal,{key:async()=>'fixture',send:()=>{abort.abort();throw Error(secret);}}),{name:'AbortError'});
});
