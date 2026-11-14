/**
 * Single read-only smoke check of the submitted publication. No credentials,
 * note writes, raw organizer calls, or assumptions about event arrivals.
 */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {prioritizedActions} from '../crm/data.mjs';
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
export function auditFreshness(data){
 const health=data.syncHealth??{},checkedAt=timestamp(data.signalCheckedAt),failedAt=timestamp(health.lastSignalFailureAt);
 const latestAttemptFailed=Boolean(failedAt&&(!checkedAt||Date.parse(failedAt)>=Date.parse(checkedAt)));
 return {reportedSignalState:health.signalState??'unknown',signalCheckedAt:checkedAt,
  successfulCheckRecorded:Boolean(checkedAt),latestAttemptFailed,
  interpretation:'Reported state at the saved observation; not independent proof of freshness now or complete event delivery'};
}
export function auditSnapshot(data,{minAccounts=2,requireActionSources=false}={}){
 assert.equal(data.mode,'live','Public submission must not use sample data');
 assert.ok(Array.isArray(data.accounts)&&data.accounts.length>=minAccounts,'Roster below requested minimum');
 assert.ok(data.syncHealth,'Expected reviewer sync metadata');
 const seen=new Set();
 return data.accounts.map(a=>{
  assert.ok(typeof a.id==='string'&&a.id&&!seen.has(a.id),'Missing or duplicate account ID');seen.add(a.id);
  const scope=new Set((a.evidence??[]).map(x=>x.id)),book=a.bookValue??{};
  assert.equal(scope.size,(a.evidence??[]).length,'Duplicate account-local evidence ID');
  assert.ok([...scope].every(id=>typeof id==='string'&&id),'Missing evidence ID');
  const known=['A','B'].includes(a.id),actions=prioritizedActions(a).slice(0,3);
  const typedBook=Number.isFinite(book.amount)&&book.amount>=0&&/^[A-Z]{3}$/.test(book.currency??'');
  const sourcedBook=Boolean(book.evidenceIds?.length&&book.evidenceIds.every(id=>scope.has(id)));
  const sourcedActions=actions.filter(x=>x.evidenceIds?.length&&x.evidenceIds.every(id=>scope.has(id))).length;
  // Any claimed reference must resolve even on a newly discovered sparse account.
  for(const item of [book,...actions,...actions.flatMap(x=>[x.proposedCheckpoint,x.decisionConstraint]).filter(Boolean)])
   for(const id of item.evidenceIds??[])assert.ok(scope.has(id),'Unresolved account-local source: '+id);
  assert.ok(actions.every(x=>[x.action,x.owner,x.success].every(v=>typeof v==='string'&&v.trim())),'Each proposed move needs action text, an owner and closure test');
  if(known){
   assert.ok(typedBook&&sourcedBook,'Curated account needs typed sourced contract value');
   assert.equal(actions.length,3,'Curated account needs three ranked moves');
   assert.ok(actions.every(x=>x.deal),'Curated move needs deal context');
  }
  if(requireActionSources)assert.ok(actions.length>0&&sourcedActions===actions.length,'Every reported move needs an exact in-account source');
  assert.ok((a.notes??[]).every(n=>!Object.hasOwn(n,'body')&&!Object.hasOwn(n,'text')),'Reviewer must not receive note bodies');
  const complete=Boolean(typedBook&&sourcedBook&&actions.length===3&&sourcedActions===3&&actions.every(x=>x.deal));
  const referencedIds=new Set([book,...actions].flatMap(x=>x.evidenceIds??[]));
  const referenced=(a.evidence??[]).filter(e=>referencedIds.has(e.id));
  const claims=referenced.filter(e=>typeof e.claim==='string'&&e.claim.trim());
  const indexOnly=referenced.filter(e=>typeof e.source==='string'&&/^Organizer game file index(?:\s*\/|$)/.test(e.source));
  return {account:a.id,structure:complete?'referenced-three-action-brief':'provisional-sparse',structurallyComplete:complete,
   currency:book.currency??null,book:book.amount??null,actions:actions.length,referencedActions:sourcedActions,signals:a.signals?.length??0,
   evidenceSupport:{referencedRecords:referenced.length,claimBearingRecords:claims.length,indexOnlyRecords:indexOnly.length,recordsWithoutVisibleClaim:referenced.length-claims.length,
    stakeholderReportedRecords:claims.filter(e=>e.confidence==='told').length,
    interpretation:'Reference and claim presence only; neither factual verification nor confirmed buying authority'},
   freshness:{...auditFreshness(data),paperworkCheckedAt:timestamp(data.syncHealth?.paperworkCheckedAt?.[a.id])}};
 });
}
async function main(){
 const origin='https://renewal-compass-crm.tarun-aditya.chatgpt.site';
 const raw=process.argv.find(x=>x.startsWith('--min-accounts='));
 const minAccounts=raw?Number(raw.split('=')[1]):2;
 assert.ok(Number.isSafeInteger(minAccounts)&&minAccounts>0,'--min-accounts must be a positive integer');
 const opts={method:'GET',redirect:'error',signal:AbortSignal.timeout(15_000)};
 const [page,response]=await Promise.all([fetch(origin,opts),fetch(new URL('/api/account-snapshot',origin),{...opts,headers:{Accept:'application/json'}})]);
 assert.equal(page.status,200,'Public dashboard does not open');
 assert.match(await page.text(),/<title>Renewal Compass(?: [^<]*)?<\/title>/i);
 assert.equal(response.status,200,'Public snapshot does not load');
 const data=await response.json();
 const accounts=auditSnapshot(data,{minAccounts,requireActionSources:process.argv.includes('--require-action-sources')});
 console.log(JSON.stringify({format:'renewal-compass-structural-audit/1',scope:'Structural reference checks, not factual verification',
  syncStatus:data.syncStatus,freshness:auditFreshness(data),accounts,
  allBriefsStructurallyComplete:accounts.every(a=>a.structurallyComplete),newEventDemonstrated:false,factualVerificationProven:false},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
