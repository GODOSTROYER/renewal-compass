// Injected at build time: normalizeOrganizer and ASSETS; neither can read credentials.
const ORGANIZER_MCP='https://questathon.aihackerscollective.com/api/public/mcp';
const COOLDOWN=61000;
const READS=['get_my_accounts','get_signals','get_all_paperwork:A','get_all_paperwork:B'];
const CACHE_SELECT='SELECT name,retrieved_at,value FROM quest_cache';
const READ_TYPES=new Set(READS);
// Relative to each successful pull. Offset windows avoid bunching expensive paperwork reads.
const REFRESH_EVERY={'get_my_accounts':20*60000,'get_signals':COOLDOWN,'get_all_paperwork:A':22*60000,'get_all_paperwork:B':24*60000};
const api=(out,status=200,headers={})=>new Response(JSON.stringify(out),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const anonAllowed=env=>env.AQ_REVIEW_MODE==='normalized';
const reviewerAllowed=(req,env)=>anonAllowed(env)||(env.AQ_REVIEW_MODE==='site-authenticated'&&Boolean(req.headers.get('oai-authenticated-user-id')));
function secretMatches(header,secret){
 const expected='Bearer '+(secret??''), got=header??'';
 if(!secret||got.length!==expected.length)return false;
 let diff=0;for(let i=0;i<got.length;i++)diff|=got.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
const MAX_BODY=1_800_000;
const SIGNAL_FRESH_MS=180000;
const retryKey=key=>'retry:'+key;
function readMatches(x,id){
 return x&&x.id===id&&(Object.hasOwn(x,'result')||Object.hasOwn(x,'error'));
}
async function decode(response,id){
 const isSSE=(response.headers.get('Content-Type')??'').includes('text/event-stream');
 if(!response.body)throw Error('Organizer response unavailable');
 const stream=response.body.getReader(), decoder=new TextDecoder();
 let bytes=0, pending='';
 function frameResult(frame){
  const data=frame.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
  if(data)try{const event=JSON.parse(data);if(readMatches(event,id))return event;}catch{}
 }
 try{
  while(true){
   const {done,value}=await stream.read();
   if(done){pending+=decoder.decode();break;}
   bytes+=value.byteLength;if(bytes>MAX_BODY)throw Error('Organizer response too large');
   pending+=decoder.decode(value,{stream:true});
   if(isSSE){
    let boundary;
    while((boundary=/\r?\n\r?\n/.exec(pending))){
     const frame=pending.slice(0,boundary.index);pending=pending.slice(boundary.index+boundary[0].length);
     const result=frameResult(frame);if(result)return result;
    }
   }
  }
  const event=isSSE?frameResult(pending):JSON.parse(pending);
  if(readMatches(event,id))return event;
  throw Error('Organizer response unavailable');
 }finally{
  // Do not await the remote stream closing after a complete response.
  void stream.cancel().catch(()=>{});
 }
}
function payload(result){
 if(result&&Object.hasOwn(result,'structuredContent'))return result.structuredContent;
 if(Array.isArray(result?.content)){
  for(const b of result.content)if(b?.type==='text')try{return JSON.parse(b.text);}catch{}
  return null;
 }
 return result;
}
function validPayload(key,value){
 if(key==='get_my_accounts')return value?.format==='account-quest-v2-export/1'&&Array.isArray(value.accounts)&&value.accounts.every(x=>x&&typeof x.id==='string'&&typeof x.name==='string');
 if(key==='get_signals')return Array.isArray(value?.signals)&&value.signals.every(x=>x&&typeof x.id==='string'&&typeof x.account==='string'&&typeof x.title==='string');
 if(key.startsWith('get_all_paperwork:'))return value?.account===key.split(':')[1]&&Array.isArray(value.records);
 return false;
}
async function persist(db,key,at,value){
 await db.prepare('INSERT INTO quest_cache(name,retrieved_at,value) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET retrieved_at=excluded.retrieved_at,value=excluded.value').bind(key,at,JSON.stringify(value)).run();
}
async function reserve(db,now){
 // One linearizable D1/SQLite update: only a worker that won the slot may call MCP.
 const result=await db.prepare('INSERT INTO quest_rate_slot(singleton,next_ms) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET next_ms=excluded.next_ms WHERE quest_rate_slot.next_ms<=?').bind(now+COOLDOWN,now).run();
 if(result.meta?.changes===1)return true;
 return false;
}
async function cache(db){
 const rows=await db.prepare(CACHE_SELECT).all();
 const valid={};
 for(const x of rows.results){
  if(!READ_TYPES.has(x.name)&&!(x.name.startsWith('retry:')&&READ_TYPES.has(x.name.slice(6))))continue;
  try{
   const value=JSON.parse(x.value);
   if(x.name.startsWith('retry:')||validPayload(x.name,payload(value)))valid[x.name]={at:x.retrieved_at,value};
  }catch{/* Ignore a legacy or corrupt row, not the entire account snapshot. */}
 }
 return valid;
}
function privatePlans(env){
 const parsed=env.AQ_PRIVATE_PLAN?JSON.parse(env.AQ_PRIVATE_PLAN):{};
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error('Invalid plan');
 for(const id of ['A','B']){
  const input=env['AQ_PLAN_'+id];
  if(!input)continue;
  const plan=JSON.parse(input);
  if(!plan?.accountName||typeof plan.accountName!=='string')throw Error('Invalid account plan');
  const {accountName,currency,signalPolicy,deals,recommendation,gaps}=plan;
  parsed[id]={accountName,currency,signalPolicy,deals,recommendation,gaps};
 }
 return parsed;
}
async function upstream(env,key,args={},upstreamFetch=(...args)=>globalThis.fetch(...args),now=Date.now()){
 const write=key==='write_note';
 if(!env.DB||!env.AQ_TOKEN||(!write&&!READ_TYPES.has(key)))throw Error('Organizer not configured');
 if(!await reserve(env.DB,now))return {state:'cooldown'};
 const [name,account]=key.split(':'), id=now, at=new Date(now).toISOString();
 const response=await upstreamFetch(ORGANIZER_MCP,{method:'POST',redirect:'manual',headers:{
  'Authorization':'Bearer '+env.AQ_TOKEN,'Accept':'application/json, text/event-stream','Content-Type':'application/json'
 },body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:account?{account}:args}}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Organizer HTTP '+response.status);
 const envelope=await decode(response,id);
 if(envelope.error||envelope.result?.isError||!envelope.result||typeof envelope.result!=='object')throw Error('Organizer rejected request');
 if(write){
  const parsed=payload(envelope.result), receipt=parsed?.note_id??parsed?.id??parsed?.note?.id;
  const safeReceipt=typeof receipt==='string'&&/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(receipt)?receipt:undefined;
  if(parsed?.ok===false||parsed?.success===false||parsed?.error||!(safeReceipt||parsed?.ok===true||parsed?.success===true))
   throw Error('Organizer note acknowledgement missing');
  try{
   // Preserve an upstream identifier only if provided, keeping local row uniqueness separate.
   await env.DB.prepare('INSERT INTO quest_notes(id,account,created_at,title,body) VALUES(?,?,?,?,?)').bind(safeReceipt?'upstream:'+safeReceipt:'local:'+crypto.randomUUID(),args.account,at,args.title,args.text).run();
  }catch{return {state:'updated',reviewerIndexWritten:false,receiptId:safeReceipt};} // Upstream confirmed; prevent an accidental repeat.
  return {state:'updated',receiptId:safeReceipt};
 }else{
  const value=payload(envelope.result);
  if(!validPayload(key,value))throw Error('Organizer payload schema not recognized');
  await persist(env.DB,key,at,value);
 }
 return {state:'updated'};
}
function failureReason(err){
 const msg=String(err?.message??'');
 if(/^Organizer HTTP [0-9]{3}$/.test(msg))return msg;
 if(err?.name==='TimeoutError')return 'timeout';
 if(msg==='Organizer payload schema not recognized')return 'unexpected tool data';
 if(msg==='Organizer rejected request')return 'tool rejected';
 if(msg.includes('Organizer response'))return 'response incomplete';
 return 'connection or storage error';
}
async function refresh(env,snapshot,upstreamFetch,now){
 if(!env.AQ_TOKEN)return {state:'disabled'};
 const timing=key=>Date.parse(snapshot[key]?.at??'')||0;
 const lastAttempt=key=>Date.parse(snapshot[retryKey(key)]?.at??'')||0;
 const previouslyFailed=key=>lastAttempt(key)>timing(key)||lastAttempt(key)===timing(key)&&snapshot[retryKey(key)]?.value?.failures>0;
 const available=key=>!previouslyFailed(key)||now>=snapshot[retryKey(key)].value.retryAt;
 const proposals=READS.filter(key=>!snapshot[key]||now-timing(key)>=REFRESH_EVERY[key]);
 const work=proposals.filter(available).sort((a,b)=>{
  // Recover stale signals first, then let due reads use slots before the next stale threshold.
  const priority=key=>key==='get_my_accounts'&&!snapshot[key]?0
   :key==='get_signals'&&now-timing(key)>=SIGNAL_FRESH_MS?1:key==='get_signals'?3:2;
  return priority(a)-priority(b)||Number(Boolean(snapshot[a]))-Number(Boolean(snapshot[b]))
   ||lastAttempt(a)-lastAttempt(b)||timing(a)+REFRESH_EVERY[a]-timing(b)-REFRESH_EVERY[b];
 })[0];
 if(!work)return {state:proposals.length?'retry-pending':'fresh'};
 try{return await upstream(env,work,{},upstreamFetch,now);}
 catch(err){
  const failures=previouslyFailed(work)?(snapshot[retryKey(work)]?.value?.failures??0)+1:1;
  const reason=failureReason(err);
  try{await persist(env.DB,retryKey(work),new Date(now).toISOString(),{failures,retryAt:now+Math.min(300000,COOLDOWN*(2**Math.min(failures,3))),reason});}catch{}
  console.warn('Organizer refresh failed',reason);
  return {state:'failed',reason};
 }
}
async function confirmedNotes(db){
 const rows=await db.prepare('SELECT id,account,created_at,title,body FROM quest_notes ORDER BY created_at DESC LIMIT 100').all();
 return rows.results.map(x=>({at:x.created_at,value:{ok:true},localNote:{account:x.account,title:x.title,text:x.body}}));
}
function scrub(value){
 if(typeof value==='string')return value
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email redacted]')
  .replace(/\b(?:bearer\s+|access (?:key|token):?\s*|api[_ -]?key:?\s*)[A-Za-z0-9._-]{8,}/gi,'[credential redacted]');
 if(Array.isArray(value))return value.map(scrub);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v)]));
}
export function reviewerView(snapshot){
 return scrub({...snapshot,accounts:snapshot.accounts.map(account=>({...account,
  evidence:(account.evidence??[]).map(e=>{
   if(e.source==='Organizer paperwork / contract'||e.source==='Organizer signal attachment / email')return {...e,claim:undefined};
   return e;
  }),
  notes:(account.notes??[]).map(n=>({id:n.id,title:n.title,at:n.at,kind:n.kind??'Account note'}))
 }))});
}
async function getLive(req,env,ctx,upstreamFetch,now){
 if(!reviewerAllowed(req,env))return api({error:'Live reviewer data is not enabled for this session'},403);
 if(!env.DB)return api({error:'Durable organizer cache is not configured'},503);
 try{
  let results=await cache(env.DB);
  const signalAge=now-(Date.parse(results.get_signals?.at??'')||0);
  if(env.AQ_TOKEN){
   if(results.get_my_accounts&&signalAge>SIGNAL_FRESH_MS){
    const update=await refresh(env,results,upstreamFetch,now);
    if(update.state==='updated'||update.state==='failed')results=await cache(env.DB);
   }else ctx.waitUntil(refresh(env,results,upstreamFetch,now).catch(()=>{}));
  }
  if(!results.get_my_accounts)return api({error:env.AQ_TOKEN?'Waiting for the first organizer data pull':'Organizer connection has not been configured',status:'pending'},503);
  results.confirmed_notes=await confirmedNotes(env.DB);
  const normalized=normalizeOrganizer(results,privatePlans(env));
  if(!normalized)return api({error:'Organizer data requires a compatible schema'},503);
  const status=!normalized.signalCheckedAt?'awaiting-signals':!env.AQ_TOKEN||now-Date.parse(normalized.signalCheckedAt)>SIGNAL_FRESH_MS?'stale':!results['get_all_paperwork:A']||!results['get_all_paperwork:B']?'awaiting-paperwork':'ready';
  const signalAttempt=results[retryKey('get_signals')];
  const lastFailed=Number.isFinite(signalAttempt?.value?.retryAt)&&(!normalized.signalCheckedAt||Date.parse(signalAttempt.at)>=Date.parse(normalized.signalCheckedAt));
  const syncHealth={accountsCheckedAt:results.get_my_accounts?.at??null,
   paperworkCheckedAt:{A:results['get_all_paperwork:A']?.at??null,B:results['get_all_paperwork:B']?.at??null},signalState:!env.AQ_TOKEN?'not-connected':status==='stale'?'stale':!normalized.signalCheckedAt?'awaiting-first-check':normalized.accounts.some(a=>a.signals?.length)?'signals-present':'fresh-empty',
   ...(lastFailed&&{lastSignalFailureAt:signalAttempt.at,signalRetryAt:new Date(signalAttempt.value.retryAt).toISOString()})};
  return api(reviewerView({...normalized,syncStatus:status,syncHealth}));
 }catch{return api({error:'Organizer cache temporarily unavailable',status:'pending'},503);}
}
export function workerWith({upstreamFetch=(...args)=>globalThis.fetch(...args),now=Date.now}={}){
 return {async fetch(req,env,ctx){
  const url=new URL(req.url), path=url.pathname;
  if(req.method==='GET'&&path==='/api/account-snapshot')return getLive(req,env,ctx,upstreamFetch,now());
  if(path.startsWith('/api/admin/')){
   if(!secretMatches(req.headers.get('Authorization'),env.AQ_ADMIN_KEY))return api({error:'Operator authentication required'},401);
   if(!env.DB||!env.AQ_TOKEN)return api({error:'Organizer connection not configured'},503);
   try{
    if(req.method==='POST'&&path==='/api/admin/refresh'){
     let result=await refresh(env,await cache(env.DB),upstreamFetch,now());
     return api(result,result.state==='cooldown'?429:result.state==='failed'?502:200,result.state==='cooldown'?{'Retry-After':'61'}:{});
    }
    if(req.method==='POST'&&path==='/api/admin/write-note'){
     const bytes=await req.arrayBuffer();
     if(bytes.byteLength>8192)return api({error:'Note is too large'},413);
     const {account,title,text}=JSON.parse(new TextDecoder().decode(bytes));
     const snapshot=normalizeOrganizer(await cache(env.DB));
     if(!snapshot?.accounts.some(x=>x.id===account)||typeof title!=='string'||!title.trim()||typeof text!=='string'||!text.trim())return api({error:'Valid account, title and note are required'},400);
     const answer=await upstream(env,'write_note',{account,title,text},upstreamFetch,now());
     if(answer.state==='cooldown')return api({error:'Organizer cooldown'},429,{'Retry-After':'61'});
     return api({ok:true,reviewerIndexWritten:answer.reviewerIndexWritten!==false,...(answer.receiptId&&{receiptId:answer.receiptId})});
    }
   }catch{return api({error:'Organizer action not confirmed; do not automatically retry'},502);}
   return api({error:'Not found'},404);
  }
  if(req.method==='GET'&&path==='/config.js'){
   const settings=reviewerAllowed(req,env)?{normalizedEndpoint:'/api/account-snapshot'}:{};
   return new Response('globalThis.QUEST_CRM_CONFIG='+JSON.stringify(settings)+';',{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(req.method==='GET'&&Object.hasOwn(ASSETS,path)){
   const [content,type]=ASSETS[path];return new Response(content,{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; object-src 'none'; base-uri 'none'"}});
  }
  return api({error:'Not found'},404);
 }};
}
export default workerWith();
