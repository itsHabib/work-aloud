const endpoint='https://api.openai.com/v1/audio/speech';

export async function speechKey(env=process.env){
  const configured=(env.OPENAI_API_KEY??'').trim();
  const base=(env.OPENAI_BASE_URL??'').trim().replace(/\/+$/,'');
  if(configured&&base&&base!=='https://api.openai.com/v1')throw Error('Cedar needs a direct OpenAI API key, without a custom OPENAI_BASE_URL.');
  if(!configured)throw Error('Cedar needs an OpenAI API key. Set OPENAI_API_KEY in your environment or .env file.');
  return directKey(configured);
}

function directKey(key){
  if(key.startsWith('sk-bf-'))throw Error('This is a gateway key. Cedar needs a direct OpenAI API key.');
  if(/\s|[^\x21-\x7e]/.test(key))throw Error('The speech API key contains invalid characters. Check the configured key.');
  return key;
}

export async function synthesize(text,signal,{key=speechKey,send=fetch}={}){
  if(typeof text!=='string'||!text.trim()||text.length>900)throw Error('A short narration is required.');
  signal.throwIfAborted();const apiKey=await key();signal.throwIfAborted();
  let response;
  try{
    response=await send(endpoint,{
      method:'POST',redirect:'error',signal,
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'cedar',input:text,response_format:'mp3',instructions:'Speak like a relaxed programmer explaining this small edit to a colleague. Be warm, clear, and conversational, with natural emphasis and brief pauses. Keep a steady, unhurried pace. Do not add words or read punctuation aloud.'})
    });
  }catch{signal.throwIfAborted();throw Error('OpenAI speech could not connect. Try again.');}
  if(!response.ok){
    await response.body?.cancel().catch(()=>{});
    if(response.status===401)throw Error('OpenAI rejected the speech API key. Check the configured key.');
    if(response.status===429)throw Error('OpenAI speech is rate-limited or its API quota is exhausted. Check the API project.');
    throw Error(`OpenAI speech could not generate this explanation (HTTP ${response.status}).`);
  }
  if(!response.headers.get('content-type')?.startsWith('audio/')){await response.body?.cancel().catch(()=>{});throw Error('OpenAI returned no playable speech.');}
  let audio;
  try{audio=Buffer.from(await response.arrayBuffer());}catch{signal.throwIfAborted();throw Error('The OpenAI speech download was interrupted. Try again.');}
  signal.throwIfAborted();
  if(!audio.length)throw Error('OpenAI returned empty speech.');
  return audio;
}
