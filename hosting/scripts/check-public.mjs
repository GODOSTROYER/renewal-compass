/**
 * Single read-only smoke check of the submitted publication. No credentials,
 * note writes, raw organizer calls, or assumptions about event arrivals.
 */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export function auditSnapshot(data,{minAccounts=2,requireActionSources=false}={}){
 assert.equal(data.mode,'live','Public submission must not use sample data');
 assert.ok(Array.isArray(data.accounts)&&data.accounts.length>=minAccounts,'Roster below requested minimum');
 assert.ok(data.syncHealth,'Expected reviewer sync metadata');
 const seen=new Set();
 return data.accounts.map(a=>{
  assert.ok(typeof a.id==='string'&&a.id&&!seen.has(a.id),'Missing or duplicate account ID');seen.add(a.id);
  const scope=new Set((a.evidence??[]).map(x=>x.id)),book=a.bookValue??{};
  const known=['A','B'].includes(a.id),actions=(a.recommendation?.actions??[]).slice(0,3);
  const typedBook=Number.isFinite(book.amount)&&/^[A-Z]{3}$/.test(book.currency??'');
  const sourcedBook=Boolean(book.evidenceIds?.length&&book.evidenceIds.every(id=>scope.has(id)));
  const sourcedActions=actions.filter(x=>x.evidenceIds?.length&&x.evidenceIds.every(id=>scope.has(id))).length;
  // Any claimed reference must resolve even on a newly discovered sparse account.
  for(const item of [book,...actions,...actions.map(x=>x.proposedCheckpoint).filter(Boolean)])
   for(const id of item.evidenceIds??[])assert.ok(scope.has(id),'Unresolved account-local source: '+id);
  assert.ok(actions.every(x=>x.owner&&x.success),'Each proposed move needs an owner and closure test');
  if(known){
   assert.ok(typedBook&&sourcedBook,'Curated account needs typed sourced contract value');
   assert.equal(actions.length,3,'Curated account needs three ranked moves');
   assert.ok(actions.every(x=>x.deal),'Curated move needs deal context');
  }
  if(requireActionSources)assert.ok(actions.length>0&&sourcedActions===actions.length,'Every reported move needs an exact in-account source');
  assert.ok((a.notes??[]).every(n=>!Object.hasOwn(n,'body')&&!Object.hasOwn(n,'text')),'Reviewer must not receive note bodies');
  const complete=Boolean(typedBook&&sourcedBook&&actions.length===3&&sourcedActions===3&&actions.every(x=>x.deal));
  return {account:a.id,verification:complete?'sourced-three-action-brief':'provisional-sparse',fullyVerified:complete,currency:book.currency??null,book:book.amount??null,actions:actions.length,sourcedActions,signals:a.signals?.length??0};
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
 console.log(JSON.stringify({syncStatus:data.syncStatus,signalState:data.syncHealth.signalState,signalCheckedAt:data.signalCheckedAt,accounts,allAccountsFullyVerified:accounts.every(a=>a.fullyVerified),newEventDemonstrated:false},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
