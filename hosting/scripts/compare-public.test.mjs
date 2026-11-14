import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSnapshots} from './compare-public.mjs';
const time=n=>new Date(Date.UTC(2026,0,1,0,n)).toISOString();
const signal=(id,text='SYNTHETIC fixture')=>({id,title:id,text,evidenceIds:['signal:'+id]});
const account=(id,signals=[])=>({id,evidence:signals.map(s=>({id:'signal:'+s.id})),signals,signalTrail:{baselineAt:time(0),absent:[]},recommendation:{actions:signals.map(s=>({action:'SYNTHETIC inspect '+s.id,evidenceIds:s.evidenceIds}))},notes:[]});
const snapshot=(n,accounts)=>({mode:'live',releaseFingerprint:'a'.repeat(64),signalCheckedAt:time(n),syncStatus:'ready',syncHealth:{signalState:accounts.some(a=>a.signals.length)?'signals-present':'fresh-empty',paperworkCheckedAt:Object.fromEntries(accounts.map(a=>[a.id,time(n)]))},accounts});
test('distinguishes same IDs, edits, reappearance and first observed after shared baseline; sorted output',()=>{
 const old=account('A',[signal('unchanged'),signal('edited'),signal('gone')]);old.signalTrail.absent=[{id:'returned'}];
 const a=account('A',[signal('returned'),signal('new'),signal('edited','SYNTHETIC changed'),signal('unchanged')]);
 a.signals.find(s=>s.id==='new').observation={state:'first-observed-after-baseline',firstObservedAt:time(2)};
 const out=compareSnapshots(snapshot(1,[old]),snapshot(2,[account('C'),a]));
 assert.equal(out.ok,true);assert.deepEqual(out.rosterAdded,['C']);assert.deepEqual(out.accounts.map(a=>a.id),['A','C']);
 assert.deepEqual(out.accounts[0].events.map(s=>[s.id,s.classification]),[['edited','same-id-content-changed'],['new','first-observed-id-after-baseline'],['returned','reappeared-known-id'],['unchanged','same-id-unchanged']]);
 assert.equal(out.accounts[0].events[1].linkedActions.length,1);assert.equal(out.organizerPublicationProven,false);assert.equal(out.accounts[0].notInLatestFeed[0].id,'gone');
});
test('no trail or changed baseline cannot prove a first observation; added account is separate discovery',()=>{
 const old=snapshot(1,[account('A')]),next=snapshot(2,[account('A',[signal('unproven')]),account('C',[signal('on-new-account')])]);
 const out=compareSnapshots(old,next);assert(out.ok);for(const a of out.accounts)assert.equal(a.events[0].classification,'present-only-in-after-unproven-first-observation');
 assert.equal(out.accounts[1].paperwork.state,'became-available');assert.equal(out.accounts[1].paperwork.contentsVerified,false);
});
test('fails closed on release mismatch, stale/pending, failed/reversed check, bad source, duplicate and leaked note',()=>{
 for(const mutate of [d=>d.releaseFingerprint='b'.repeat(64),d=>delete d.releaseFingerprint,d=>d.syncStatus='stale',d=>d.syncHealth.signalState='awaiting-first-check',d=>d.syncHealth.lastSignalFailureAt=time(2),d=>d.signalCheckedAt=time(0),d=>d.accounts[0].recommendation.actions[0].evidenceIds=['foreign'],d=>d.accounts.push(d.accounts[0]),d=>d.accounts[0].notes.push({text:'SYNTHETIC leaked body'})]){
  const a=snapshot(1,[account('A',[signal('same')])]),b=snapshot(2,[account('A',[signal('same')])]);mutate(b);const out=compareSnapshots(a,b);assert.equal(out.ok,false);assert.equal(out.accounts.length,0);assert(out.errors.length);
 }
});
test('serialization stable despite roster, evidence and object key insertion ordering',()=>{
 const a=snapshot(1,[account('B'),account('A')]),b=snapshot(2,[account('B'),account('A')]);
 assert.equal(JSON.stringify(compareSnapshots(a,b)),JSON.stringify(compareSnapshots({...a,accounts:[...a.accounts].reverse()},{...b,accounts:[...b.accounts].reverse()})));
});
test('intermediate disappearance is identified as reappearance even if ID is present in both saved files',()=>{
 const a=snapshot(1,[account('A',[signal('same')])]),b=snapshot(3,[account('A',[signal('same','SYNTHETIC edited')])]);
 b.accounts[0].signals[0].observation={firstObservedAt:time(0),lastReappearedAt:time(2),state:'unchanged'};
 const event=compareSnapshots(a,b).accounts[0].events[0];assert.equal(event.classification,'reappeared-known-id');assert.equal(event.contentChangedFromBefore,true);
});
test('arrival-clock replay and source-link ordering are not material content changes',()=>{
 const a=snapshot(1,[account('A',[signal('same')])]),b=structuredClone(a);b.signalCheckedAt=time(2);
 for(const d of [a,b]){d.accounts[0].evidence.push({id:'attachment'});d.accounts[0].signals[0].evidenceIds.push('attachment');}
 b.accounts[0].signals[0].evidenceIds.reverse();b.accounts[0].signals[0].arrivedAt=time(2);
 const result=compareSnapshots(a,b),event=result.accounts[0].events[0];
 assert.equal(event.classification,'same-id-unchanged');assert.equal(event.contentChangedFromBefore,false);
 assert.equal(event.organizerArrivalField,time(2));assert.equal(event.linkedActions[0].rank,1);assert.match(event.linkedActions[0].actionSha256,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(event.linkedActions[0],'action'),false);
});

test('reports decision ranks in the same order as the dashboard, not payload order',()=>{
 const old=account('A',[signal('late'),signal('early')]),next=structuredClone(old);
 for(const a of [old,next]){a.recommendation.actions[0].move=9;a.recommendation.actions[1].move=2;}
 next.recommendation.actions.reverse();
 const out=compareSnapshots(snapshot(1,[old]),snapshot(2,[next])).accounts[0];
 assert.equal(out.rankedActionsChanged,false);
 assert.equal(out.events.find(s=>s.id==='early').linkedActions[0].rank,1);
 assert.equal(out.events.find(s=>s.id==='late').linkedActions[0].rank,2);
});
