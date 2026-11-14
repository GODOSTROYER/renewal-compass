import http from 'node:http';
import {mkdir,readFile,writeFile,rename,rmdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {normalizeOrganizer,unwrap} from './organizer-map.mjs';
const endpoint='https://questathon.aihackerscollective.com/api/public/mcp';
const privatePlans=await import('./plans.local.mjs').then(x=>x.default).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const root=fileURLToPath(new URL('.',import.meta.url));
const dir=resolve(process.env.AQ_STATE_DIR??join(root,'.private-state'));
const tools=['get_my_accounts','get_all_paperwork:A','get_all_paperwork:B','get_signals'];
export function nextRead(results,now){
 if(!results.get_my_accounts)return 'get_my_accounts';
 if(!results.get_signals)return 'get_signals';
 for(const k of tools.slice(1,3))if(!results[k])return k;
 // Signals take most slots, but poll the official export too, so newly assigned accounts can appear.
 if(now-Date.parse(results.get_my_accounts.at)>300000&&Date.parse(results.get_signals.at)>now-150000)return 'get_my_accounts';
 return 'get_signals';
}
let lastError=null;
export function decodeRpc(body,type=''){
 if(type.includes('text/event-stream')){
  for(const frame of body.split(/\r?\n\r?\n/)){
   const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
   if(!data)continue;
   try{const x=JSON.parse(data);if(x.result!==undefined||x.error)return x}catch{}
  }throw Error('No JSON-RPC response in SSE body');
 }
 return JSON.parse(body);
}
const statePath=join(dir,'state.json');
async function state(){
 try{return JSON.parse(await readFile(statePath,'utf8'))}catch(e){if(e.code==='ENOENT')return {last:0,results:{}};throw e}
}
async function save(value){const tmp=statePath+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,statePath)}
async function rpc(key,params={},write=false){
 if(!process.env.AQ_TOKEN)throw Error('Organizer token not configured');
 if(![...tools,'get_data_format','write_note'].includes(key))throw Error('Unsupported organizer tool');
 if((key==='write_note')!==write)throw Error('Invalid access mode');
 await mkdir(dir,{recursive:true,mode:0o700});
 const lock=join(dir,'rpc.lock');
 try{await mkdir(lock,{mode:0o700})}catch(e){
  if(e.code!=='EEXIST')throw e;
  throw Object.assign(Error('Organizer request serialized; try later'),{status:429,retryAfter:60})
 }
 try{
  const s=await state(), now=Date.now();
  if(now-s.last<61000)throw Object.assign(Error('Organizer rate limit: wait before the next call'),{status:429,retryAfter:Math.ceil((61000-now+s.last)/1000)});
  // Persist the reservation before any request, even if upstream fails or the process exits.
  s.last=now;await save(s);
  const [name,ac]=key.split(':');
  const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+process.env.AQ_TOKEN,Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:ac?{account:ac}:params}}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Organizer HTTP '+response.status);
  const envelope=decodeRpc(await response.text(),response.headers.get('content-type')??'');
  if(envelope.error||envelope.result?.isError)throw Error('Organizer reported a tool error');
  if(envelope.result===undefined)throw Error('Organizer returned no tool result');
  if(key==='get_my_accounts'){
   const old=unwrap(s.results[key]), next=unwrap(envelope.result);
   if(next?.format!=='account-quest-v2-export/1'||!Array.isArray(next.accounts))throw Error('Organizer export shape changed');
   for(const prior of old?.accounts??[]){
    if(next.accounts.some(a=>a.id===prior.id&&a.name===prior.name))continue;
    delete s.results['get_all_paperwork:'+prior.id];
    delete s.results.get_signals;
    s.results.confirmed_notes=(s.results.confirmed_notes??(s.results.write_note?[s.results.write_note]:[])).filter(n=>n.localNote?.account!==prior.id);
    if(s.results.write_note?.localNote?.account===prior.id)delete s.results.write_note;
   }
  }
  const accountName=ac?unwrap(s.results.get_my_accounts)?.accounts?.find(a=>a.id===ac)?.name:null;
  s.results[key]={at:new Date().toISOString(),value:envelope.result,...(accountName&&{accountName}),...(write&&{localNote:params})};
  if(write)s.results.confirmed_notes=[...(s.results.confirmed_notes??[]),s.results[key]].slice(-100);
  await save(s);
  return s.results[key];
 } finally {await rmdir(lock)}
}
async function refresh(){
 if(!process.env.AQ_TOKEN)return;
 try{const s=await state();if(Date.now()-s.last<61000)return;
  const key=nextRead(s.results,Date.now());await rpc(key);lastError=null
 }catch(e){if(e.status!==429)lastError=e.message}
}
function admin(req){
 const expected=process.env.AQ_ADMIN_KEY; const supplied=req.headers.authorization;
 if(!expected||!supplied)return false;
 const a=Buffer.from('Bearer '+expected),b=Buffer.from(supplied);return a.length===b.length&&timingSafeEqual(a,b);
}
function json(res,status,out,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(out))}
async function body(req){const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>8192)throw Object.assign(Error('Body too large'),{status:413});chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString())}
const assets={'/':['index.html','text/html'],'/styles.css':['styles.css','text/css'],'/app.mjs':['app.mjs','text/javascript'],'/data.mjs':['data.mjs','text/javascript'],'/config.js':['config.js','text/javascript']};
export function makeServer(){return http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&assets[path]){const [file,type]=assets[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});const data=await readFile(join(root,file),file==='index.html'?'utf8':null);res.end(file==='index.html'?data.replace('<script type="module"','<script src="/config.js"></script><script type="module"'):data);return}
  if(req.method==='GET'&&path==='/api/account-snapshot'){
   const s=await state(), data=normalizeOrganizer(s.results,privatePlans);
   if(!data){json(res,503,{error:process.env.AQ_TOKEN?'Live mapping not yet available':'Organizer token not configured',status:lastError?'sync-error':'initializing'});return}
   json(res,200,{...data,syncStatus:lastError?'stale':!data.signalCheckedAt?'awaiting-signals':Date.now()-Date.parse(data.signalCheckedAt)>180000?'stale':'ready'});return;
  }
  if(path.startsWith('/api/admin/')){
   if(!admin(req)){json(res,401,{error:'Operator authentication required'});return}
   if(req.method==='GET'&&path==='/api/admin/cache'){json(res,200,await state());return}
   if(req.method==='POST'&&path==='/api/admin/write-note'){
    const input=await body(req); const {text,account,kind,title}=input;
    if(typeof text!=='string'||!text.trim()||[account,kind,title].some(x=>x!=null&&typeof x!=='string')){json(res,400,{error:'Invalid note'});return}
    await rpc('write_note',{text,...(account!=null&&{account}),...(kind!=null&&{kind}),...(title!=null&&{title})},true);json(res,200,{ok:true});return;
   }
   if(req.method==='POST'&&path==='/api/admin/describe'){await rpc('get_data_format');json(res,200,{ok:true});return}
  }
  json(res,404,{error:'Not found'});
 }catch(e){json(res,e.status??502,{error:e.status?e.message:'Organizer or CRM request failed'},e.retryAfter?{'Retry-After':String(e.retryAfter)}:{})}
})}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 makeServer().listen(Number(process.env.PORT??8314),process.env.AQ_BIND??'127.0.0.1');
 const tick=setInterval(refresh,5000);tick.unref();refresh();
}
