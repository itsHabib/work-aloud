import {editBetween,codeAt} from './typing.mjs';
const $=id=>document.getElementById(id);
const state={code:'',task:'',session:null,model:null,phase:'idle',kind:'start',epoch:0,edits:0,generating:false,queue:[],current:null,complete:false};
const events=[];const log=(type,detail={})=>events.push({type,at:Math.round(performance.now()),...detail});
let stream,speech,audio,frame,finishAudio,pumping=false;

function controls(message){
  const exists=Boolean(state.session),speaking=Boolean(audio&&!audio.paused);
  $('pause').disabled=!audio;$('pause').textContent=speaking?'Pause':'Resume speech';
  $('continue').disabled=!exists||state.kind!=='question'&&(state.generating||Boolean(audio)||pumping||state.phase==='working');
  $('stop').disabled=!exists&&!state.generating&&state.phase!=='starting';
  $('question').disabled=!exists;$('ask').disabled=!exists||state.kind==='question'&&state.generating&&!audio;
  $('start').disabled=state.generating&&!exists;
  $('copy').disabled=!state.code;
  $('activity').classList.toggle('active',speaking);
  $('connection').textContent=state.model?`${state.model} · Cedar`:'Codex + Cedar';
  $('edit-count').textContent=state.current&&state.kind!=='question'?`Writing edit ${state.edits+1}`:state.edits?`${state.edits} edits · ${state.code.split('\n').length} lines`:'Ready when you are';
  if(message)$('status').textContent=message;
}

function renderCode(writing=false){
  const before=$('code-scroll');const follow=before.scrollHeight-before.scrollTop-before.clientHeight<100;
  $('code').replaceChildren();
  const cursor=state.current?.edit?state.current.edit.prefix.length+Math.floor(state.current.edit.insert.length*(state.current.progress??0)):state.code.length;
  const activeLine=state.code.slice(0,cursor).split('\n').length-1;
  state.code.split('\n').forEach((line,index)=>{
    const row=document.createElement('span');row.className='code-line';row.classList.toggle('writing',writing&&index===activeLine);
    const number=document.createElement('span');number.className='line-number';number.textContent=index+1;number.setAttribute('aria-hidden','true');
    const text=document.createElement('span');text.className='line-text';text.textContent=line||' ';
    if(writing&&index===activeLine){const caret=document.createElement('span');caret.className='caret';text.append(caret);}
    row.append(number,text);$('code').append(row);
  });
  if(follow)before.scrollTop=before.scrollHeight;
}

function history(text,user=false){const p=document.createElement('p');p.classList.toggle('user',user);p.textContent=text;$('history').append(p);}
async function post(path,body,signal){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok)throw Error((await response.json()).error??'The local server could not complete that request.');
  return response;
}

function stopPlayback(){
  speech?.abort();speech=null;cancelAnimationFrame(frame);
  if(audio){audio.pause();URL.revokeObjectURL(audio.src);audio=null;}
  finishAudio?.();finishAudio=null;state.current=null;
}
function freeze(message='Paused. Ask a question or resume when ready.'){
  if(audio){audio.pause();cancelAnimationFrame(frame);}
  state.phase='paused';controls(message);log('paused',{code:state.code,offset:audio?.currentTime??null});
}
function animate(ticket){
  if(ticket!==state.epoch||!audio||audio.paused)return;
  const progress=Math.min(1,audio.currentTime/(audio.duration*.88||1));
  state.current.progress=progress;
  if(state.current.edit){state.code=codeAt(state.current.edit,progress);renderCode(true);}
  $('progress').value=audio.currentTime/(audio.duration||1);
  frame=requestAnimationFrame(()=>animate(ticket));
}

async function playBeat(beat,ticket){
  speech=new AbortController();
  controls('Preparing the next spoken explanation…');
  const response=await post('/api/speech',{text:beat.say},speech.signal);const blob=await response.blob();
  if(ticket!==state.epoch)return;
  const el=new Audio(URL.createObjectURL(blob));audio=el;
  state.current={...beat,edit:beat.code===null?null:editBetween(state.code,beat.code),progress:0};
  $('caption').textContent=beat.say;$('voice-title').textContent=state.kind==='question'?'Your question':'Coding, out loud';
  log('speech-ready',{say:beat.say,codeBefore:state.code,codeAfter:beat.code});
  await new Promise((resolve,reject)=>{
    finishAudio=resolve;
    el.onplaying=()=>{
      if(ticket!==state.epoch)return;
      state.phase=state.kind==='question'?'answering':'working';
      log('speaking',{code:state.code,offset:el.currentTime});controls(state.kind==='question'?'Answering your question. The code stays paused.':'Speaking and typing. Interrupt whenever you want.');animate(ticket);
    };
    el.onended=()=>{
      if(ticket!==state.epoch)return;
      if(beat.code!==null){state.code=beat.code;state.edits++;renderCode();}
      history(beat.say);log('spoken',{say:beat.say,code:state.code});
      URL.revokeObjectURL(el.src);audio=null;finishAudio=null;state.current=null;resolve();
    };
    el.onerror=()=>reject(Error('This browser could not play the generated speech.'));
    if(state.phase==='paused'){controls('Paused. Press Resume speech when ready.');return;}
    el.play().catch(()=>{if(ticket!==state.epoch||audio!==el)return;state.phase='paused';controls('Press Resume speech to allow playback.');});
  });
}

async function pump(ticket){
  if(pumping||ticket!==state.epoch)return;
  pumping=true;
  try{
    while(state.queue.length&&ticket===state.epoch){const beat=state.queue.shift();await playBeat(beat,ticket);}
  }catch(error){
    if(ticket===state.epoch&&error.name!=='AbortError'){
      stream?.abort();state.generating=false;state.queue=[];stopPlayback();state.phase='error';controls(error.message);log('error',{message:error.message});
    }
  }finally{
    if(ticket===state.epoch){
      pumping=false;
      if(!state.generating&&!audio&&state.phase!=='error'){
        state.phase=state.kind==='question'?'question':'complete';
        controls(state.kind==='question'?'Answer finished. Ask more, or Continue coding.':'That implementation is complete. Ask a question or request a change.');
      }
    }
  }
}

async function generate(kind,question=''){
  state.epoch++;const ticket=state.epoch;
  stream?.abort();stopPlayback();state.queue=[];pumping=false;state.kind=kind;state.complete=false;state.generating=true;state.phase='working';
  stream=new AbortController();controls(kind==='question'?'Thinking about your question…':'Working on your request…');
  log('request',{kind,question,code:state.code});
  try{
    const response=await post('/api/narrate',{session:state.session,kind,task:state.task,code:state.code,question},stream.signal);
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    while(true){
      const {done,value}=await reader.read();if(done)break;if(ticket!==state.epoch){await reader.cancel();return;}
      buffer+=decoder.decode(value,{stream:true});let end;
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;
        const event=JSON.parse(line);
        if(event.type==='session'){state.session=event.id;state.model=event.model;controls();log('connected');}
        if(event.type==='beat'){state.queue.push(event);log('generated',{say:event.say});pump(ticket);}
        if(event.type==='done')state.complete=true;
        if(event.type==='error')throw Error(event.message);
      }
    }
    if(!state.complete)throw Error('The model connection ended early. Your visible code is preserved.');
  }catch(error){
    if(ticket!==state.epoch||error.name==='AbortError')return;
    state.queue=[];stopPlayback();state.phase='error';controls(error.message);log('error',{message:error.message});
  }finally{
    if(ticket===state.epoch){state.generating=false;if(!pumping&&state.phase!=='error')pump(ticket);controls();}
  }
}

async function end(){
  const session=state.session;state.epoch++;stream?.abort();stopPlayback();pumping=false;state.queue=[];state.generating=false;state.session=null;state.phase='idle';
  controls('Demonstration ended. Your code stays here.');
  if(session)await post('/api/end',{session}).catch(()=>{});
}
$('task-form').onsubmit=async event=>{
  event.preventDefault();if(!$('task').value.trim())return;
  const task=$('task').value.trim(),code=$('initial').value;
  const closing=end(),ticket=state.epoch;state.phase='starting';controls('Starting your demonstration…');
  await closing;if(ticket!==state.epoch)return;
  state.task=task;state.code=code;state.edits=0;$('history').replaceChildren();
  $('file-label').textContent='Implementation';$('caption').textContent='I’m getting started on your request…';renderCode();history(state.task,true);generate('start');
};
document.querySelectorAll('[data-task]').forEach(button=>{button.onclick=()=>{$('task').value=button.dataset.task;$('task').focus();};});
$('pause').onclick=()=>{
  if(!audio)return;
  if(!audio.paused){freeze();return;}
  const el=audio,ticket=state.epoch;el.play().catch(error=>{if(ticket===state.epoch&&audio===el)controls(error.message);});
};
$('question').onfocus=()=>{if(['working','answering'].includes(state.phase))freeze();};
$('question-form').onsubmit=event=>{event.preventDefault();const question=$('question').value.trim();if(!question||$('ask').disabled)return;history(question,true);$('question').value='';generate('question',question);};
$('continue').onclick=()=>generate('continue');$('stop').onclick=end;
$('copy').onclick=()=>navigator.clipboard.writeText(state.code).then(()=>controls('Code copied.'));
window.addEventListener('pagehide',()=>{const session=state.session;state.epoch++;stream?.abort();stopPlayback();if(session)fetch('/api/end',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session}),keepalive:true}).catch(()=>{});});
window.narratorDemo={snapshot:()=>({...state,queue:state.queue.length,current:state.current?{say:state.current.say,progress:state.current.progress}:null,events:[...events]}),pause:freeze};
controls();
