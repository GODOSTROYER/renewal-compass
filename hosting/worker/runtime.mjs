// Injected at build time: normalizeOrganizer and ASSETS; neither can read credentials.
const ORGANIZER_MCP='https://questathon.aihackerscollective.com/api/public/mcp';
const COOLDOWN=61000;
const READS=['get_my_accounts','get_signals','get_all_paperwork:A','get_all_paperwork:B'];
const CACHE_SELECT='SELECT name,retrieved_at,value FROM quest_cache';
const READ_TYPES=new Set(READS);
const api=(out,status=200,headers={})=>new Response(JSON.stringify(out),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const anonAllowed=env=>env.AQ_REVIEW_MODE==='normalized';
const reviewerAllowed=(req,env)=>anonAllowed(env)||(env.AQ_REVIEW_MODE==='site-authenticated'&&Boolean(req.headers.get('oai-authenticated-user-id')));
function secretMatches(header,secret){
 const expected='Bearer '+(secret??''), got=header??'';
 if(!secret||got.length!==expected.length)return false;
 let diff=0;for(let i=0;i<got.length;i++)diff|=got.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
function decode(body,type){
 if(type.includes('text/event-stream')){
  for(const frame of body.split(/\r?\n\r?\n/)){
   const data=frame.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
   if(data)try{const event=JSON.parse(data);if(event.result!==undefined||event.error)return event;}catch{}
  }
  throw Error('Organizer response unavailable');
 }
 return JSON.parse(body);
}
async function reserve(db,now){
 // One linearizable D1/SQLite update: only a worker that won the slot may call MCP.
 const result=await db.prepare('INSERT INTO quest_rate_slot(singleton,next_ms) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET next_ms=excluded.next_ms WHERE quest_rate_slot.next_ms<=?').bind(now+COOLDOWN,now).run();
 if(result.meta?.changes===1)return true;
 return false;
}
async function cache(db){
 const rows=await db.prepare(CACHE_SELECT).all();
 return Object.fromEntries(rows.results.filter(x=>READ_TYPES.has(x.name)).map(x=>[x.name,{at:x.retrieved_at,value:JSON.parse(x.value)}]));
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
 const [name,account]=key.split(':');
 const response=await upstreamFetch(ORGANIZER_MCP,{method:'POST',redirect:'manual',headers:{
  'Authorization':'Bearer '+env.AQ_TOKEN,'Accept':'application/json, text/event-stream','Content-Type':'application/json'
 },body:JSON.stringify({jsonrpc:'2.0',id:now,method:'tools/call',params:{name,arguments:account?{account}:args}}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Organizer HTTP '+response.status);
 const envelope=decode(await response.text(),response.headers.get('Content-Type')??'');
 if(envelope.error||envelope.result?.isError||envelope.result===undefined)throw Error('Organizer rejected request');
 const at=new Date().toISOString();
 if(write){
  await env.DB.prepare('INSERT INTO quest_notes(id,account,created_at,title,body) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),args.account,at,args.title,args.text).run();
 }else{
  await env.DB.prepare('INSERT INTO quest_cache(name,retrieved_at,value) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET retrieved_at=excluded.retrieved_at,value=excluded.value').bind(key,at,JSON.stringify(envelope.result)).run();
 }
 return {state:'updated'};
}
async function refresh(env,snapshot,upstreamFetch,now){
 if(!env.AQ_TOKEN)return {state:'disabled'};
 const work=READS.find(k=>!snapshot[k])??'get_signals';
 if(work==='get_signals'&&snapshot.get_signals&&now-Date.parse(snapshot.get_signals.at)<COOLDOWN)return {state:'fresh'};
 return upstream(env,work,{},upstreamFetch,now);
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
  const results=await cache(env.DB);
  if(env.AQ_TOKEN)ctx.waitUntil(refresh(env,results,upstreamFetch,now).catch(err=>{const safe=String(err?.message??''); console.warn('Organizer refresh failed',/^Organizer HTTP [0-9]{3}$/.test(safe)?safe:err?.name==='TimeoutError'?'timeout':safe.startsWith('D1')?'storage error':safe==='Organizer rejected request'?'tool rejected':/illegal invocation/i.test(safe)?'host fetch binding':/network connection lost/i.test(safe)?'upstream network connection lost':/unexpected token|json/i.test(safe)?'unexpected upstream response format':/stream|response unavailable/i.test(safe)?'upstream response stream failed':'connection or response error');}));
  if(!results.get_my_accounts)return api({error:env.AQ_TOKEN?'Waiting for the first organizer data pull':'Organizer connection has not been configured',status:'pending'},503);
  results.confirmed_notes=await confirmedNotes(env.DB);
  const normalized=normalizeOrganizer(results,privatePlans(env));
  if(!normalized)return api({error:'Organizer data requires a compatible schema'},503);
  const status=!normalized.signalCheckedAt?'awaiting-signals':!results['get_all_paperwork:A']||!results['get_all_paperwork:B']?'awaiting-paperwork':!env.AQ_TOKEN||now-Date.parse(normalized.signalCheckedAt)>180000?'stale':'ready';
  return api(reviewerView({...normalized,syncStatus:status}));
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
     return api(result,result.state==='cooldown'?429:200,result.state==='cooldown'?{'Retry-After':'61'}:{});
    }
    if(req.method==='POST'&&path==='/api/admin/write-note'){
     const bytes=await req.arrayBuffer();
     if(bytes.byteLength>8192)return api({error:'Note is too large'},413);
     const {account,title,text}=JSON.parse(new TextDecoder().decode(bytes));
     const snapshot=normalizeOrganizer(await cache(env.DB));
     if(!snapshot?.accounts.some(x=>x.id===account)||typeof title!=='string'||!title.trim()||typeof text!=='string'||!text.trim())return api({error:'Valid account, title and note are required'},400);
     const answer=await upstream(env,'write_note',{account,title,text},upstreamFetch,now());
     if(answer.state==='cooldown')return api({error:'Organizer cooldown'},429,{'Retry-After':'61'});
     return api({ok:true});
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
