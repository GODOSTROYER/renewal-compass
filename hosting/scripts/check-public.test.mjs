import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditSnapshot,auditFreshness} from './check-public.mjs';
// A self-contained synthetic fixture: public clones must not need private captures.
const saved={mode:'live',syncHealth:{},accounts:['A','B'].map(id=>{
 const evidenceId='account:'+id;
 return {id,evidence:[{id:evidenceId,source:'Organizer game file index / synthetic.txt'}],bookValue:{amount:1,currency:'USD',evidenceIds:[evidenceId]},
  recommendation:{actions:[1,2,3].map(n=>({action:'Synthetic action '+n,owner:'Synthetic CSM',deal:'Synthetic deal',success:'Fixture '+n,evidenceIds:[evidenceId]}))},notes:[]};
})};
const sparse={id:'C',name:'SYNTHETIC roster growth test',evidence:[{id:'account:C'}],bookValue:{amount:null},recommendation:{actions:[]},notes:[]};
test('dynamic roster reports sparse account without falsely passing it as complete',()=>{
 const data=structuredClone(saved);data.accounts.push(sparse);
 const out=auditSnapshot(data,{minAccounts:3});
 assert.equal(out.length,3);assert.equal(out[2].structurallyComplete,false);assert.equal(out[2].structure,'provisional-sparse');
 assert.throws(()=>auditSnapshot(data,{minAccounts:4}),/minimum/);
 assert.throws(()=>auditSnapshot(data,{requireActionSources:true}),/exact in-account source/);
});
test('index-only references and pending feed never become factual verification',()=>{
 const data=structuredClone(saved);data.syncHealth.signalState='pending';
 const out=auditSnapshot(data,{requireActionSources:true});
 for(const a of out){
  assert.equal(a.structurallyComplete,true);assert.equal(a.structure,'referenced-three-action-brief');
  assert.equal(Object.hasOwn(a,'fullyVerified'),false);assert.equal(Object.hasOwn(a,'verification'),false);
  assert.equal(a.evidenceSupport.referencedRecords,1);assert.equal(a.evidenceSupport.indexOnlyRecords,1);
  assert.equal(a.evidenceSupport.claimBearingRecords,0);assert.equal(a.freshness.reportedSignalState,'pending');
  assert.equal(a.freshness.successfulCheckRecorded,false);
 }
});
test('claim-bearing, reported and indexed support remain separate from check clocks',()=>{
 const data=structuredClone(saved);data.signalCheckedAt='2026-11-14T10:00:00Z';
 data.syncHealth={signalState:'stale',lastSignalFailureAt:'2026-11-14T10:01:00Z',paperworkCheckedAt:{A:'2026-11-14T09:00:00Z'}};
 data.accounts[0].evidence[0].claim='Synthetic stakeholder claim, not verified';data.accounts[0].evidence[0].confidence='told';data.accounts[0].evidence[0].source='Synthetic stakeholder';
 const [a,b]=auditSnapshot(data);
 assert.equal(a.evidenceSupport.claimBearingRecords,1);assert.equal(a.evidenceSupport.stakeholderReportedRecords,1);
 assert.equal(a.evidenceSupport.indexOnlyRecords,0);assert.equal(b.evidenceSupport.indexOnlyRecords,1);
 assert.equal(a.freshness.latestAttemptFailed,true);assert.equal(a.freshness.reportedSignalState,'stale');
 assert.equal(a.freshness.paperworkCheckedAt,'2026-11-14T09:00:00Z');assert.equal(b.freshness.paperworkCheckedAt,null);
 assert.equal(auditFreshness({signalCheckedAt:'not-a-date',syncHealth:{lastSignalFailureAt:'2026-11-14T10:01:00Z'}}).latestAttemptFailed,true);
});
test('sparse accounts still fail closed on dangling source, duplicate identity and note body',()=>{
 for(const mutate of [a=>a.notes.push({body:'test'}),a=>a.recommendation.actions.push({owner:'Test',success:'Test',evidenceIds:['foreign']}),a=>{a.id='A';}]){
  const data=structuredClone(saved),a=structuredClone(sparse);mutate(a);data.accounts.push(a);assert.throws(()=>auditSnapshot(data));
 }
});
test('public reviewer contract example is self-contained and cannot pass as live evidence',async()=>{
 const read=name=>readFile(new URL('../docs/'+name,import.meta.url),'utf8').then(JSON.parse);
 const schema=await read('reviewer-snapshot.schema.json'),example=await read('reviewer-snapshot.example.json');
 assert.equal(schema.$id,'urn:renewal-compass:reviewer-snapshot:1');
 assert.equal(example.mode,'fixture');assert.match(example._examplePurpose,/Entirely synthetic/);
 assert.throws(()=>auditSnapshot(example),/must not use sample/);
 for(const a of example.accounts){
  const scope=new Set(a.evidence.map(e=>e.id));assert.equal(a.recommendation.actions.length,3);
  for(const item of [a.bookValue,...a.recommendation.actions])for(const id of item.evidenceIds)assert.ok(scope.has(id));
  assert.ok(a.evidence.some(e=>e.claim));assert.ok(a.evidence.some(e=>!e.claim));
  assert.ok(a.notes.every(n=>!Object.hasOwn(n,'body')&&!Object.hasOwn(n,'text')));
 }
});
test('structural audit uses UI-ranked moves and rejects duplicate evidence IDs',()=>{
 const data=structuredClone(saved),a=data.accounts[0];
 a.recommendation.actions.push({action:'Synthetic highest rank',move:0,owner:'Synthetic owner',success:'Synthetic closure',deal:'Synthetic deal',evidenceIds:['foreign']});
 assert.throws(()=>auditSnapshot(data),/Unresolved account-local source/);
 const duplicate=structuredClone(saved);duplicate.accounts[0].evidence.push({...duplicate.accounts[0].evidence[0]});
 assert.throws(()=>auditSnapshot(duplicate),/Duplicate account-local evidence ID/);
});

test('redacted document evidence is not treated as an index-only record',()=>{
 const d=structuredClone(saved);d.accounts[0].evidence[0].source='Organizer paperwork / contract';
 const [a]=auditSnapshot(d);
 assert.equal(a.evidenceSupport.recordsWithoutVisibleClaim,1);
 assert.equal(a.evidenceSupport.indexOnlyRecords,0);
});
