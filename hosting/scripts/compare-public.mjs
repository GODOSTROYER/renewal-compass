/** Offline only. Usage: node scripts/compare-public.mjs before.json after.json
 * Exit 1 means evidence cannot support a fresh, same-release comparison.
 */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prioritizedActions} from '../crm/data.mjs';
const ordered=xs=>[...xs].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,JSON.parse(canonical(x[k]))])):x??null);
const when=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
export function compareSnapshots(before,after){
 const errors=[],require=(condition,message)=>{if(!condition)errors.push(message);};
 const report={format:'renewal-compass-offline-comparison/1',networkRequests:0,organizerWrites:0,organizerPublicationProven:false,basis:'Two saved public CRM observations, not organizer publication, resolution or action completion',errors,accounts:[]};
 for(const [label,s] of [['before',before],['after',after]]){
  require(s?.mode==='live',label+': expected live public read model');
  require(Array.isArray(s?.accounts),label+': accounts missing');
  require(/^[a-f0-9]{64}$/.test(s?.releaseFingerprint??''),label+': release identity missing');
  require(Number.isFinite(when(s?.signalCheckedAt)),label+': successful signal check missing');
  require(['fresh-empty','signals-present'].includes(s?.syncHealth?.signalState)&&['ready','awaiting-paperwork'].includes(s?.syncStatus),label+': stale, disconnected or pending signal evidence');
  require(!s?.syncHealth?.lastSignalFailureAt||when(s.syncHealth.lastSignalFailureAt)<when(s.signalCheckedAt),label+': latest signal attempt failed');
  require(s?.syncHealth?.signalState!=='fresh-empty'||!(s?.accounts??[]).some(a=>(a.signals??[]).length),label+': empty feed state contradicts signals');
  for(const [id,at] of Object.entries(s?.syncHealth?.paperworkCheckedAt??{}))require(at===null||Number.isFinite(when(at)),label+'/'+id+': invalid paperwork clock');
  const ids=new Set();
  for(const a of s?.accounts??[]){
   require(typeof a.id==='string'&&a.id&&!ids.has(a.id),label+': duplicate or invalid account');ids.add(a.id);
   const scope=new Set((a.evidence??[]).map(e=>e.id));require(scope.size===(a.evidence??[]).length,label+'/'+a.id+': duplicate evidence');
   for(const item of [a.bookValue,...(a.signals??[]),...(a.recommendation?.actions??[]),...(a.recommendation?.actions??[]).flatMap(x=>[x.proposedCheckpoint,x.decisionConstraint])].filter(Boolean)){
    require(item.evidenceIds===undefined||Array.isArray(item.evidenceIds),label+'/'+a.id+': invalid evidenceIds');
    for(const id of Array.isArray(item.evidenceIds)?item.evidenceIds:[])require(scope.has(id),label+'/'+a.id+': unresolved source '+id);
   }
   const signalIds=new Set();for(const sig of a.signals??[]){require(typeof sig.id==='string'&&!signalIds.has(sig.id),label+'/'+a.id+': duplicate or invalid signal');signalIds.add(sig.id);require(scope.has('signal:'+sig.id),label+'/'+a.id+': signal source missing '+sig.id);}
   for(const n of a.notes??[])require(!Object.hasOwn(n,'body')&&!Object.hasOwn(n,'text'),label+'/'+a.id+': note body exposed');
  }
 }
 require(before?.releaseFingerprint===after?.releaseFingerprint,'release mismatch: compare matching releases');
 require(when(after?.signalCheckedAt)>when(before?.signalCheckedAt),'after must contain a later successful signal check');
 if(errors.length){report.ok=false;return report;}
 report.releaseFingerprint=after.releaseFingerprint;report.beforeCheckedAt=before.signalCheckedAt;report.afterCheckedAt=after.signalCheckedAt;
 const prior=new Map(before.accounts.map(a=>[a.id,a])),latest=new Map(after.accounts.map(a=>[a.id,a]));
 report.rosterAdded=ordered(after.accounts.filter(a=>!prior.has(a.id))).map(a=>a.id);
 report.rosterRemoved=ordered(before.accounts.filter(a=>!latest.has(a.id))).map(a=>a.id);
 for(const a of ordered(after.accounts)){
  const ranked=prioritizedActions(a);
  const old=prior.get(a.id),oldSignals=new Map((old?.signals??[]).map(s=>[s.id,s])),absent=new Set((old?.signalTrail?.absent??[]).map(s=>s.id));
  const currentIds=new Set((a.signals??[]).map(s=>s.id));
  const events=ordered(a.signals??[]).map(s=>{
   const previous=oldSignals.get(s.id),ob=s.observation;
   const contents=x=>({title:x.title,text:x.text,at:x.at,evidenceIds:[...(x.evidenceIds??[])].sort()});
   let classification=previous?(canonical(contents(previous))===canonical(contents(s))?'same-id-unchanged':'same-id-content-changed'):'present-only-in-after-unproven-first-observation';
   if(absent.has(s.id)||ob?.lastReappearedAt&&when(ob.lastReappearedAt)>when(before.signalCheckedAt)&&when(ob.lastReappearedAt)<=when(after.signalCheckedAt)&&when(ob.firstObservedAt)<=when(before.signalCheckedAt))classification='reappeared-known-id';
   else if(!previous&&old&&ob?.state==='first-observed-after-baseline'&&a.signalTrail?.baselineAt===old.signalTrail?.baselineAt&&Number.isFinite(when(a.signalTrail?.baselineAt))&&when(a.signalTrail.baselineAt)<=when(before.signalCheckedAt)&&when(ob.firstObservedAt)>when(before.signalCheckedAt)&&when(ob.firstObservedAt)<=when(after.signalCheckedAt))classification='first-observed-id-after-baseline';
   return {id:s.id,classification,contentChangedFromBefore:previous?canonical(contents(previous))!==canonical(contents(s)):null,crmFirstObservedAt:ob?.firstObservedAt??null,organizerScenarioDate:s.at??null,organizerArrivalField:s.arrivedAt??null,evidenceIds:s.evidenceIds??[],linkedActions:ranked.map((x,i)=>({...x,rank:i+1})).filter(x=>x.evidenceIds?.includes('signal:'+s.id)).map(x=>({rank:x.rank,actionSha256:createHash('sha256').update(String(x.action??'')).digest('hex'),evidenceIds:[...x.evidenceIds].sort()}))};
  });
  const paper=s=>s?.syncHealth?.paperworkCheckedAt?.[a.id]??null,earlier=paper(before),later=paper(after);
  report.accounts.push({id:a.id,roster:old?'retained':'added',paperwork:{beforeCheckedAt:earlier,afterCheckedAt:later,state:later?(earlier?'previously-available':'became-available'):'pending',contentsVerified:false},events,notInLatestFeed:ordered(old?.signals??[]).filter(s=>!currentIds.has(s.id)).map(s=>({id:s.id,meaning:'not present in later saved feed; not proof of resolution'})),rankedActionsChanged:canonical(old?prioritizedActions(old):[])!==canonical(ranked)});
 }
 report.ok=true;return report;
}
async function main(){
 try{
  if(process.argv.length!==4)throw Error('Usage: node scripts/compare-public.mjs before.json after.json');
  const buffers=await Promise.all(process.argv.slice(2).map(p=>readFile(p))),snapshots=buffers.map(b=>JSON.parse(b));
  const out=compareSnapshots(...snapshots);out.inputSha256=buffers.map(b=>createHash('sha256').update(b).digest('hex'));
  console.log(JSON.stringify(out,null,2));if(!out.ok)process.exitCode=1;
 }catch(e){console.log(JSON.stringify({ok:false,networkRequests:0,errors:[e.message]}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
