import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditSnapshot} from './check-public.mjs';
// A self-contained synthetic fixture: public clones must not need private captures.
const saved={mode:'live',syncHealth:{},accounts:['A','B'].map(id=>{
 const evidenceId='account:'+id;
 return {id,evidence:[{id:evidenceId}],bookValue:{amount:1,currency:'USD',evidenceIds:[evidenceId]},
  recommendation:{actions:[1,2,3].map(n=>({owner:'Synthetic CSM',deal:'Synthetic deal',success:'Fixture '+n,evidenceIds:[evidenceId]}))},notes:[]};
})};
const sparse={id:'C',name:'SYNTHETIC roster growth test',evidence:[{id:'account:C'}],bookValue:{amount:null},recommendation:{actions:[]},notes:[]};
test('dynamic roster reports sparse account without falsely passing it as complete',()=>{
 const data=structuredClone(saved);data.accounts.push(sparse);
 const out=auditSnapshot(data,{minAccounts:3});
 assert.equal(out.length,3);assert.equal(out[2].fullyVerified,false);assert.equal(out[2].verification,'provisional-sparse');
 assert.throws(()=>auditSnapshot(data,{minAccounts:4}),/minimum/);
 assert.throws(()=>auditSnapshot(data,{requireActionSources:true}),/exact in-account source/);
});
test('sparse accounts still fail closed on dangling source, duplicate identity and note body',()=>{
 for(const mutate of [a=>a.notes.push({body:'test'}),a=>a.recommendation.actions.push({owner:'Test',success:'Test',evidenceIds:['foreign']}),a=>{a.id='A';}]){
  const data=structuredClone(saved),a=structuredClone(sparse);mutate(a);data.accounts.push(a);assert.throws(()=>auditSnapshot(data));
 }
});
