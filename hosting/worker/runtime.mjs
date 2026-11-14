// Injected at build time: normalizeOrganizer and ASSETS; neither can read credentials.
const ORGANIZER_MCP='https://questathon.aihackerscollective.com/api/public/mcp';
const COOLDOWN=61000;
const BASE_READS=['get_my_accounts','get_signals'];
const ROSTER_INTERVAL=20*60000;
const ROSTER_HARD_AGE=ROSTER_INTERVAL+20*60000;
const PAPERWORK_PREFIX='get_all_paperwork:';
const WRITE_NOTE_ACCOUNTS=new Set(['A','B']);
const accountId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)&&!Object.hasOwn(Object.prototype,id);
const paperworkKey=id=>PAPERWORK_PREFIX+id;
const CACHE_SELECT='SELECT name,retrieved_at,value FROM quest_cache';
const BASE_READ_TYPES=new Set(BASE_READS);
// The exact current roster, not guessed identifiers, controls paperwork.
const rosterIds=wrapped=>(payload(wrapped?.value)?.accounts??[]).map(a=>a.id);
function readPlan(snapshot){
 const intervals=new Map([['get_my_accounts',ROSTER_INTERVAL],['get_signals',COOLDOWN]]);
 [...rosterIds(snapshot.get_my_accounts)].sort().forEach((id,i)=>intervals.set(paperworkKey(id),(22+2*(i%5))*60000));
 return intervals;
}
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
 if(key==='get_my_accounts')return value?.format==='account-quest-v2-export/1'&&Array.isArray(value.accounts)&&value.accounts.every(x=>x&&accountId(x.id)&&typeof x.name==='string')&&new Set(value.accounts.map(x=>x.id)).size===value.accounts.length;
 if(key==='get_signals')return Array.isArray(value?.signals)&&value.signals.every(x=>x&&typeof x.id==='string'&&typeof x.account==='string'&&typeof x.title==='string');
 if(key.startsWith(PAPERWORK_PREFIX))return value?.account===key.slice(PAPERWORK_PREFIX.length)&&Array.isArray(value.records);
 return false;
}
const OBSERVATION_KEY='_crmSignalObservations';
const MAX_ABSENT_OBSERVATIONS=100;
const ABSENT_RETENTION_MS=30*86400000;
const signalKey=s=>JSON.stringify([s.account,s.id]);
async function signalDigest(s){
 const records=(Array.isArray(s.records)?s.records:[]).map(r=>JSON.stringify([r?.kind??null,r?.path??null,r?.note??null,r?.text??null])).sort();
 const semantic=JSON.stringify([s.title,s.summary??null,s.dated??null,records]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(semantic));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function observedSignals(previous,value,at){
 const saved=previous?.value?.[OBSERVATION_KEY];
 const base=typeof saved?.baselineAt==='string'?saved.baselineAt:previous?.at??at;
 const states=new Map();
 if(Array.isArray(saved?.entries)){
  for(const row of saved.entries)if(typeof row?.id==='string'&&typeof row?.account==='string')states.set(signalKey(row),row);
 }else{
  // Existing verified cache is the earliest local baseline we can prove; don't call its contents new.
  for(const s of payload(previous?.value)?.signals??[])states.set(signalKey(s),{
   id:s.id,account:s.account,firstObservedAt:previous.at,lastObservedAt:previous.at,digest:await signalDigest(s),state:'baseline'
  });
 }
 const seen=new Set();
 for(const s of value.signals){
  const key=signalKey(s);
  if(seen.has(key))continue;
  seen.add(key);
  const prior=states.get(key), digest=await signalDigest(s), changed=Boolean(prior&&prior.digest!==digest);
  states.set(key,{id:s.id,account:s.account,firstObservedAt:prior?.firstObservedAt??at,lastObservedAt:at,digest,
   state:prior?.absentSince?'reappeared':changed?'content-changed':prior?'unchanged':previous?'first-observed-after-baseline':'baseline',
   materialChangeAt:changed?at:prior?.materialChangeAt,lastReappearedAt:prior?.absentSince?at:prior?.lastReappearedAt});
 }
 const absent=[], current=[];
 for(const [key,row] of states){
  if(seen.has(key))current.push(row);
  else{
   const absentSince=row.absentSince??at;
   if(Date.parse(at)-Date.parse(absentSince)<=ABSENT_RETENTION_MS)absent.push({...row,state:'not-in-latest-feed',absentSince});
  }
 }
 absent.sort((a,b)=>b.absentSince.localeCompare(a.absentSince)||signalKey(a).localeCompare(signalKey(b)));
 return {...value,[OBSERVATION_KEY]:{baselineAt:base,entries:[...current,...absent.slice(0,MAX_ABSENT_OBSERVATIONS)]}};
}
function withObservationTrail(normalized,cached){
 const trail=cached?.value?.[OBSERVATION_KEY];
 if(!Array.isArray(trail?.entries))return normalized;
 const safe=row=>({id:row.id,state:row.state,firstObservedAt:row.firstObservedAt,lastObservedAt:row.lastObservedAt,
  ...(row.materialChangeAt&&{materialChangeAt:row.materialChangeAt}),...(row.lastReappearedAt&&{lastReappearedAt:row.lastReappearedAt}),...(row.absentSince&&{absentSince:row.absentSince})});
 return {...normalized,accounts:normalized.accounts.map(a=>{
  const scoped=trail.entries.filter(row=>row.account===a.id), byId=new Map(scoped.map(row=>[row.id,row]));
  return {...a,signals:(a.signals??[]).map(s=>({...s,...(byId.has(s.id)&&{observation:safe(byId.get(s.id))})})),
   signalTrail:{baselineAt:trail.baselineAt,updatedAt:cached.at,basis:'CRM Worker observations, not organizer publication or resolution',
    absent:scoped.filter(row=>row.absentSince).map(safe)}};
 })};
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
 const accept=(row,key)=>{
  try{
   const value=JSON.parse(row.value);
   if(row.name.startsWith('retry:')||validPayload(key,payload(value)))valid[row.name]={at:row.retrieved_at,value};
  }catch{/* Ignore a legacy or corrupt row, not the entire account snapshot. */}
 };
 for(const row of rows.results){
  const key=row.name.replace(/^retry:/,'');
  if(BASE_READ_TYPES.has(key))accept(row,key);
 }
 const readKeys=readPlan(valid);
 for(const row of rows.results){
  const key=row.name.replace(/^retry:/,'');
  if(key.startsWith(PAPERWORK_PREFIX)&&readKeys.has(key))accept(row,key);
 }
 return valid;
}
function isoCalendarDate(value){
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))
  &&new Date(value).toISOString().slice(0,10)===value;
}
function suppliedCalendar(action){
 if(action.timing?.kind==='sourced-date'||isoCalendarDate(action.timing?.date))return true;
 const raw=[action.dueDate,action.timing?.text].filter(x=>typeof x==='string').join(' ');
 return (raw.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[]).some(isoCalendarDate)
  ||/\b(?:\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2})\b/i.test(raw);
}
function overlayActionEvidence(plans,raw){
 if(!raw)return plans;
 let addon;
 try{addon=JSON.parse(raw);}catch{return plans;}
 const record=x=>x&&typeof x==='object'&&!Array.isArray(x);
 if(!record(addon))return plans;
 for(const id of ['A','B']){
  const scoped=addon[id], plan=plans[id], actions=plan?.recommendation?.actions;
  if(!record(scoped)||typeof scoped.accountName!=='string'||!scoped.accountName
   ||scoped.accountName!==plan?.accountName||!record(scoped.actions)||!Array.isArray(actions))continue;
  plans[id]={...plan,recommendation:{...plan.recommendation,actions:actions.map(action=>{
   if(typeof action?.action!=='string'||!Object.hasOwn(scoped.actions,action.action))return action;
   const extra=scoped.actions[action.action], incoming=Array.isArray(extra)?extra:record(extra)?extra.evidenceIds:undefined;
   const idList=x=>Array.isArray(x)&&x.every(id=>typeof id==='string'&&id.trim()===id&&id.length>0);
   if(incoming!==undefined&&!idList(incoming))return action;
   let out=incoming?.length?{...action,evidenceIds:[...new Set([...(Array.isArray(action.evidenceIds)?action.evidenceIds:[]),...incoming])]}:action;
   const checkpoint=record(extra)?extra.proposedCheckpoint:undefined;
   const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=400;
   const constraint=record(extra)?extra.decisionConstraint:undefined;
   if(!action.decisionConstraint&&record(constraint)&&text(constraint.text)&&idList(constraint.evidenceIds)&&constraint.evidenceIds.length)
    out={...out,decisionConstraint:{text:constraint.text.trim(),evidenceIds:[...new Set(constraint.evidenceIds)]}};
   if(!record(checkpoint)||action.proposedCheckpoint||suppliedCalendar(action)||!isoCalendarDate(checkpoint.date)
    ||!text(checkpoint.purpose)||!text(checkpoint.basis)||(checkpoint.evidenceIds!==undefined&&!idList(checkpoint.evidenceIds)))return out;
   return {...out,proposedCheckpoint:{date:checkpoint.date,purpose:checkpoint.purpose.trim(),basis:checkpoint.basis.trim(),
    evidenceIds:checkpoint.evidenceIds??incoming??[]}};
  })}};
 }
 return plans;
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
 return overlayActionEvidence(overlayActionEvidence(parsed,env.AQ_ACTION_EVIDENCE),env.AQ_ACTION_CHECKPOINTS);
}
async function upstream(env,key,args={},upstreamFetch=(...args)=>globalThis.fetch(...args),now=Date.now(),previous,allowedReads=BASE_READ_TYPES){
 const write=key==='write_note';
 if(!env.DB||!env.AQ_TOKEN||(!write&&!allowedReads.has(key)))throw Error('Organizer not configured');
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
  await persist(env.DB,key,at,key==='get_signals'?await observedSignals(previous,value,at):value);
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
 const intervals=readPlan(snapshot);
 const proposals=[...intervals.keys()].filter(key=>!snapshot[key]||now-timing(key)>=intervals.get(key));
 const work=proposals.filter(available).sort((a,b)=>{
  // A repository roster >=20 minutes past its normal interval takes the next slot.
  // With sparse viewers, don't choose stale signals twice ahead of overdue paperwork.
  const nonSignalLast=Math.max(0,...[...intervals.keys()].filter(k=>k!=='get_signals').map(k=>Math.max(timing(k),lastAttempt(k))));
  const signalFirst=!snapshot.get_signals||now-timing('get_signals')>=SIGNAL_FRESH_MS&&nonSignalLast>=timing('get_signals');
  const priority=key=>key==='get_my_accounts'&&(!snapshot[key]||now-timing(key)>=ROSTER_HARD_AGE)?0
   :key==='get_signals'?signalFirst?1:3:2;
  return priority(a)-priority(b)||Number(Boolean(snapshot[a]))-Number(Boolean(snapshot[b]))
   ||Math.max(lastAttempt(a),timing(a))+intervals.get(a)-Math.max(lastAttempt(b),timing(b))-intervals.get(b);
 })[0];
 if(!work)return {state:proposals.length?'retry-pending':'fresh'};
 try{return await upstream(env,work,{},upstreamFetch,now,snapshot[work],intervals);}
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
   if(results.get_my_accounts&&(signalAge>SIGNAL_FRESH_MS||now-Date.parse(results.get_my_accounts.at)>=ROSTER_INTERVAL)){
    const update=await refresh(env,results,upstreamFetch,now);
    if(update.state==='updated'||update.state==='failed')results=await cache(env.DB);
   }else ctx.waitUntil(refresh(env,results,upstreamFetch,now).catch(()=>{}));
  }
  if(!results.get_my_accounts)return api({error:env.AQ_TOKEN?'Waiting for the first organizer data pull':'Organizer connection has not been configured',status:'pending'},503);
  results.confirmed_notes=await confirmedNotes(env.DB);
  const normalized=normalizeOrganizer(results,privatePlans(env));
  if(!normalized)return api({error:'Organizer data requires a compatible schema'},503);
  const scopedIds=rosterIds(results.get_my_accounts);
  const status=!normalized.signalCheckedAt?'awaiting-signals':!env.AQ_TOKEN||now-Date.parse(normalized.signalCheckedAt)>SIGNAL_FRESH_MS?'stale':scopedIds.some(id=>!results[paperworkKey(id)])?'awaiting-paperwork':'ready';
  const signalAttempt=results[retryKey('get_signals')];
  const lastFailed=Number.isFinite(signalAttempt?.value?.retryAt)&&(!normalized.signalCheckedAt||Date.parse(signalAttempt.at)>=Date.parse(normalized.signalCheckedAt));
  const syncHealth={accountsCheckedAt:results.get_my_accounts?.at??null,
   paperworkCheckedAt:Object.fromEntries(scopedIds.map(id=>[id,results[paperworkKey(id)]?.at??null])),signalState:!env.AQ_TOKEN?'not-connected':status==='stale'?'stale':!normalized.signalCheckedAt?'awaiting-first-check':normalized.accounts.some(a=>a.signals?.length)?'signals-present':'fresh-empty',
   ...(lastFailed&&{lastSignalFailureAt:signalAttempt.at,signalRetryAt:new Date(signalAttempt.value.retryAt).toISOString()})};
  return api(reviewerView({...withObservationTrail(normalized,results.get_signals),syncStatus:status,syncHealth,
   ...(typeof RELEASE_FINGERPRINT==='string'&&{releaseFingerprint:RELEASE_FINGERPRINT})}));
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
     if(!WRITE_NOTE_ACCOUNTS.has(account)||!snapshot?.accounts.some(x=>x.id===account)||typeof title!=='string'||!title.trim()||typeof text!=='string'||!text.trim())return api({error:'Valid account, title and note are required'},400);
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
