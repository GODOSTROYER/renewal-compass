import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureAdapter,prioritizedActions,validateSnapshot} from '../crm/data.mjs';
test('credential-free sample provides one sourced three-action brief and one sparse account',async()=>{
 const demo=validateSnapshot(await fixtureAdapter.load());
 assert.equal(demo.mode,'fixture');
 const [complete,sparse]=demo.accounts;
 const ledger=new Set(complete.evidence.map(x=>x.id));
 const actions=prioritizedActions(complete);
 assert.equal(actions.length,3);
 assert.deepEqual(actions.map(a=>a.move),[5,6,7]);
 assert(actions.every(a=>a.owner&&a.success&&a.deal&&a.evidenceIds.length&&a.evidenceIds.every(id=>ledger.has(id))));
 assert(complete.bookValue.evidenceIds.every(id=>ledger.has(id)));
 assert.equal(sparse.bookValue.amount,null);
 assert.deepEqual(prioritizedActions(sparse),[]);
 demo.accounts[0].evidence.length=0;
 assert((await fixtureAdapter.load()).accounts[0].evidence.length>0,'Preview interactions must not change the baseline fixture');
});
