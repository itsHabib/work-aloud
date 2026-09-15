import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

export const instructions=`You are a programmer demonstrating your work in a live coding conversation. The learner watches your code appear while hearing your explanation. Generate the implementation requested by the learner, not a prepared lesson.
Output ONLY newline-delimited JSON. Each line is either {"say":"one short spoken explanation","code":"the complete current file after this small edit"} or the final {"done":true}. No markdown fences or other text.
Each edit adds or changes 1 to 4 meaningful lines. Start by writing a small beginning, never the entire solution in your first record. Prefer 6 to 12 edits for a small task. Keep the final file under 90 lines and the whole response under 24 edits. Say 12 to 35 words about WHY this particular edit helps, as a programmer would explain their work in an interview. Do not read punctuation aloud. Show actual useful code, not pseudocode unless requested. Ordinary incomplete code is fine while you are typing; make the final file complete.
For QUESTION turns, answer the actual question in 1 to 3 short spoken records with code:null. Keep the visible file frozen. For CONTINUE turns, continue or correct the implementation from the exact visible file supplied, incorporating the learner's questions. That visible file is authoritative: any earlier code you drafted but the learner has not seen must not be presumed to exist. It may end in a partially typed line.
Explain design decisions, never private internal reasoning or an original author's historical thought process. Do not claim to have executed or tested code. Use no tools, commands, file access or network. Produce content for this editor only. If a request is too large, implement one coherent small part and explain its limit. Finish with {"done":true} only when this turn's requested demonstration or answer is complete.`;

export class BeatParser {
  buffer=''; count=0; finished=false;
  constructor(onBeat){this.onBeat=onBeat;}
  push(delta){
    this.buffer+=delta;if(this.buffer.length>50000)throw Error('The model produced an oversized edit.');
    let end;
    while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).trim();this.buffer=this.buffer.slice(end+1);if(line)this.line(line);}
  }
  line(line){
    if(this.finished)throw Error('The model sent content after finishing.');
    const beat=JSON.parse(line);
    if(beat.done===true){this.finished=true;return;}
    if(typeof beat.say!=='string'||!beat.say.trim()||beat.say.length>900||(beat.code!==null&&typeof beat.code!=='string')||(beat.code?.length??0)>24000)throw Error('The model produced an invalid narration/edit pair.');
    if(++this.count>24)throw Error('This demonstration exceeded 24 edits. Ask for a smaller part.');
    this.onBeat({say:beat.say,code:beat.code});
  }
  end(){if(this.buffer.trim())this.line(this.buffer.trim());this.buffer='';if(!this.finished||!this.count)throw Error('The model stopped before completing its response.');}
}

export class Narrator {
  pending=new Map();seq=0;active=null;closed=false;
  static async open(){
    const instance=new Narrator();
    instance.directory=await mkdtemp(join(tmpdir(),'work-aloud-'));
    const env={...process.env};delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
    instance.process=spawn('codex',['app-server','--disable','shell_tool','--disable','plugins','--disable','apps','--disable','multi_agent','--disable','memories','--disable','code_mode_host'],{cwd:instance.directory,env,stdio:['pipe','pipe','pipe']});
    createInterface({input:instance.process.stdout}).on('line',line=>instance.message(line));
    instance.process.stderr.on('data',()=>{}); // Provider diagnostics can contain private local context.
    instance.process.on('error',()=>instance.fail(Error('Codex could not start. Install it and sign in with ChatGPT.')));
    instance.process.on('exit',()=>instance.fail(Error('The local Codex connection ended. Start a new demonstration.')));
    try{
      await instance.request('initialize',{clientInfo:{name:'work_aloud',version:'0.2.0'},capabilities:{experimentalApi:true}});
      instance.send({method:'initialized',params:{}});
      const account=await instance.request('account/read',{});
      if(account.account?.type!=='chatgpt')throw Error('Sign in to Codex with ChatGPT to use this local demonstration.');
      const settings=await instance.request('config/read',{includeLayers:false});
      const mcp=Object.fromEntries(Object.keys(settings.config.mcp_servers??{}).map(name=>[name,{enabled:false}]));
      const result=await instance.request('thread/start',{ephemeral:true,cwd:instance.directory,environments:[],dynamicTools:[],sandbox:'read-only',approvalPolicy:'never',modelProvider:'openai',baseInstructions:instructions,config:{mcp_servers:mcp,web_search:'disabled','features.skip_host_skill_discovery':true}});
      instance.threadId=result.thread.id;instance.model=result.model;return instance;
    }catch(error){await instance.close();throw error;}
  }
  send(message){if(!this.closed)this.process.stdin.write(JSON.stringify(message)+'\n');}
  request(method,params){
    if(this.closed)return Promise.reject(Error('The demonstration connection is closed.'));
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex did not respond in time.'));},30000);
      this.pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});
      this.send({id,method,params});
    });
  }
  message(line){
    let message;try{message=JSON.parse(line);}catch{return;}
    if(this.pending.has(message.id)){
      const pending=this.pending.get(message.id);this.pending.delete(message.id);
      if(message.error){pending.reject(Error(message.error.message));return;}
      pending.resolve(message.result);return;
    }
    // This client provides no tools or approvals, even if the provider requests one.
    if(message.id!==undefined){this.send({id:message.id,error:{code:-32601,message:'This editor has no tools or approvals.'}});return;}
    const active=this.active;if(!active)return;
    if(message.method==='turn/started')active.id=message.params.turn.id;
    if(message.method==='item/agentMessage/delta'){
      try{active.parser.push(message.params.delta);}catch(error){active.reject(error);this.cancel();}
    }
    if(message.method==='turn/completed'){
      this.active=null;
      if(message.params.turn.status!=='completed'){active.reject(Error('Generation interrupted. The visible code is preserved.'));return;}
      try{active.parser.end();active.resolve();}catch(error){active.reject(error);}
    }
  }
  async turn({kind,task,code,question},onBeat,signal){
    if(this.active)throw Error('A response is already in progress. Wait for it to stop.');
    signal.throwIfAborted();
    let finish,fail;const completed=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
    completed.catch(()=>{});
    const active={parser:new BeatParser(beat=>{
      if(kind==='question'&&beat.code!==null)throw Error('The model tried to edit during a question. Your code stays frozen.');
      if(!signal.aborted)onBeat(beat);
    }),resolve:finish,reject:fail,finished:completed,id:null};this.active=active;
    const cancel=()=>this.cancel();signal.addEventListener('abort',cancel,{once:true});
    let shutdown;
    const limit=setTimeout(()=>{cancel();shutdown=setTimeout(()=>{if(this.active===active)this.close();},5000);},120000);
    try{
      const text=JSON.stringify({mode:kind.toUpperCase(),originalTask:task,visibleCode:code,question:question??'',instruction:kind==='question'?'Answer this question about the visible code. Do not edit.':'Write and explain the next small edits from this exact visible code.'});
      const result=await this.request('turn/start',{threadId:this.threadId,environments:[],effort:'low',input:[{type:'text',text}]});
      active.id=result.turn.id;if(signal.aborted||active.cancelRequested)this.cancel();
      await completed;
    }catch(error){if(this.active===active&&!active.id){this.active=null;fail(error);}throw error;}
    finally{clearTimeout(limit);clearTimeout(shutdown);signal.removeEventListener('abort',cancel);}
  }
  async stop(){const active=this.active;if(!active)return;this.cancel();await active.finished.catch(()=>{});}
  cancel(){
    const active=this.active;if(!active)return;
    active.cancelRequested=true;
    if(active.id)this.request('turn/interrupt',{threadId:this.threadId,turnId:active.id}).catch(()=>this.fail(Error('Could not interrupt the model.')));
  }
  fail(error){for(const request of this.pending.values())request.reject(error);this.pending.clear();this.active?.reject(error);this.active=null;}
  async close(){
    if(this.closing)return this.closing;
    this.fail(Error('The demonstration was closed.'));this.closed=true;
    this.closing=(async()=>{
      if(this.process?.pid&&this.process.exitCode===null&&this.process.signalCode===null){
        const exited=once(this.process,'exit').catch(()=>{});this.process.kill();
        const force=setTimeout(()=>this.process.kill('SIGKILL'),2000);
        await exited;clearTimeout(force);
      }
      if(this.directory)await rm(this.directory,{recursive:true,force:true});
    })();
    return this.closing;
  }
}
