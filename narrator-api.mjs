import {randomUUID} from 'node:crypto';
import {Narrator} from './narrator.mjs';
import {synthesize} from './speech.mjs';

export function validateTurn(input){
  if(!['start','continue','question'].includes(input.kind))throw Error('Choose a demonstration or a question.');
  for(const [key,max] of [['task',2000],['code',24000],['question',2000]])if(typeof input[key]!=='string'||input[key].length>max)throw Error(`The ${key} is missing or too long.`);
  if(!input.task.trim())throw Error('Enter something to build.');
  if(input.kind==='question'&&!input.question.trim())throw Error('Enter your question.');
  if(input.session!==null&&typeof input.session!=='string')throw Error('Invalid session.');
  if(!input.session&&input.kind!=='start')throw Error('Start a demonstration first.');
  return input;
}

export function narratorApi({open=Narrator.open,speak=synthesize}={}){
  const sessions=new Map();let closed=false;
  const sweep=setInterval(()=>{for(const [id,session] of sessions)if(Date.now()-session.used>600000){sessions.delete(id);session.narrator?.close();}},60000);sweep.unref();
  async function body(req){let value='';for await(const chunk of req){value+=chunk;if(value.length>40000)throw Error('Request too large.');}return JSON.parse(value);}
  const json=(res,status,value)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(value));
  async function handle(req,res,origin){
    if(!['/api/narrate','/api/speech','/api/end'].includes(req.url))return false;
    if(req.method!=='POST'||req.headers.origin!==origin||req.headers['content-type']!=='application/json'){json(res,403,{error:'Use the local demonstration page.'});return true;}
    if(closed){json(res,503,{error:'The local server is shutting down.'});return true;}
    const abort=new AbortController();res.on('close',()=>abort.abort());
    let session,newId,release;
    try{
      const input=await body(req);abort.signal.throwIfAborted();
      if(req.url==='/api/speech'){
        const audio=await speak(input.text,AbortSignal.any([abort.signal,AbortSignal.timeout(30000)]));if(!res.destroyed)res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':audio.length,'Cache-Control':'no-store'}).end(audio);return true;
      }
      if(req.url==='/api/end'){
        session=sessions.get(input.session);sessions.delete(input.session);await session?.narrator.close();json(res,200,{closed:true});return true;
      }
      validateTurn(input);
      if(input.session){session=sessions.get(input.session);if(!session)throw Error('This demonstration expired. Start a new one.');}
      if(!session){
        if(sessions.size>=2)throw Error('Close the other demonstration before starting another.');
        newId=randomUUID();session={narrator:null,used:Date.now(),busy:false};sessions.set(newId,session);
        session.opening=open();
        try{session.narrator=await session.opening;}catch(error){sessions.delete(newId);throw error;}
        if(abort.signal.aborted||closed){sessions.delete(newId);await session.narrator.close();return true;}
      }
      if(session.busy){await session.narrator.stop();await session.finished;}
      if(session.busy)throw Error('Another response just started. Wait for it to finish.');
      session.busy=true;session.used=Date.now();
      session.finished=new Promise(resolve=>{release=resolve;});
      await session.narrator.stop();abort.signal.throwIfAborted();
      res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      const emit=value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n');};
      emit({type:'session',id:input.session??newId,model:session.narrator.model});
      await session.narrator.turn(input,beat=>emit({type:'beat',...beat}),abort.signal);
      emit({type:'done'});res.end();
    }catch(error){
      if(res.destroyed)return true;
      const message=error.name==='AbortError'?'Generation stopped.':error.message;
      if(res.headersSent){res.end(JSON.stringify({type:'error',message})+'\n');return true;}
      json(res,400,{error:message});
    }finally{if(release){session.busy=false;release();}}
    return true;
  }
  async function close(){
    closed=true;clearInterval(sweep);
    await Promise.all([...sessions.values()].map(async session=>{const narrator=session.narrator??await session.opening?.catch(()=>null);await narrator?.close();}));sessions.clear();
  }
  return {handle,close};
}
