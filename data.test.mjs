import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureAdapter,endpointAdapter,validateSnapshot,remaining} from './data.mjs';
test('move countdown has safe unknown and overdue states',()=>{assert.equal(remaining(1,null),'Deadline unknown');assert.equal(remaining(9,8),'Overdue by 1 move(s)');assert.equal(remaining(4,8),'4 move(s) left')});
test('fixture is isolated',async()=>{const x=await fixtureAdapter.load();x.accounts[0].move=20;assert.equal((await fixtureAdapter.load()).accounts[0].move,4)});
test('duplicate account records fail closed',()=>assert.throws(()=>validateSnapshot({mode:'live',accounts:[{id:'a',name:'A'},{id:'a',name:'B'}]})));
test('adapter validates state without a real network call',async()=>{const a=endpointAdapter('/api/account-snapshot',{fetcher:async()=>({ok:true,json:async()=>({mode:'live',accounts:[]})})});assert.equal((await a.load()).mode,'live')});
test('failed source does not silently switch to samples',async()=>{const a=endpointAdapter('/api/account-snapshot',{fetcher:async()=>({ok:false,status:403})});await assert.rejects(()=>a.load(),/403/)});
import {reviewAccount} from './data.mjs';
test('unseen account using reused evidence key is isolated',()=>{
 const a={id:'unseen',evidence:[],recommendation:{decision:'Explore',evidence:['E-01']}};
 assert.deepEqual(reviewAccount(a).map(x=>x.type),['evidence','reference']);
});
test('renamed and reordered accounts have identical quality results',async()=>{
 const f=await fixtureAdapter.load();const baseline=Object.fromEntries(f.accounts.map(x=>[x.id,reviewAccount(x)]));
 for(const x of f.accounts.reverse())assert.deepEqual(reviewAccount({...x,name:'New title '+x.id}),baseline[x.id]);
});
test('sparse unseen account preserves unknowns and never creates a score',()=>assert.deepEqual(reviewAccount({id:'cold'}),[{type:'decision',message:'No recommendation recorded.'}]));
test('conflicting claims and overdue unresolved deals surface',()=>{
 const a={move:4,evidence:[{id:'A'},{id:'B',conflictsWith:['A']}],deals:[{name:'New deal',stage:'Qualified',deadlineMove:3}],recommendation:{decision:'Gather evidence',evidence:['A','B'],actions:[{action:'Ask',move:2}]}};
 assert.deepEqual(reviewAccount(a).map(x=>x.type),['action','timing','timing','conflict']);
});
test('zero is a valid move and an agreed deal is not flagged overdue',()=>assert.deepEqual(reviewAccount({move:1,evidence:[{id:'A'}],deals:[{name:'Done',stage:'Agreed',deadlineMove:0}],recommendation:{decision:'Renew',evidence:['A'],actions:[{owner:'CSM',success:'Confirmed',move:1}]}}),[]));
import {proposalReadiness,prioritizedActions,normalizedAdapter} from './data.mjs';
const candidate={stage:'Qualified',attemptsRemaining:1,proposal:{recipient:'Owner',kind:'Report',requiredSourceIds:['a','b']}};
test('semantically similar source cannot substitute an exact id',()=>assert.deepEqual(proposalReadiness(candidate,[{sourceId:'a'},{sourceId:'c',title:'same notes'}],['a','c']),{state:'review',missing:['b'],irrelevant:['c']}));
test('exact source pair can pass, extras cannot',()=>{const files=[{sourceId:'a'},{sourceId:'b'},{sourceId:'c'}];assert.equal(proposalReadiness(candidate,files,['a','b']).state,'ready');assert.equal(proposalReadiness(candidate,files,['a','b','c']).state,'review')});
test('exhausted tries cannot be unlocked by a complete checklist',()=>assert.equal(proposalReadiness({...candidate,attemptsRemaining:0},[{sourceId:'a'},{sourceId:'b'}],['a','b']).state,'locked'));
test('deadline comes before urgency, unknown deadlines stay explicit',()=>assert.deepEqual(prioritizedActions({recommendation:{actions:[{action:'C',urgency:99},{action:'B',move:4},{action:'A',move:1}]}}).map(a=>a.action),['A','B','C']));
test('MCP bridge stays fail-closed and needs a caller-supplied mapping',async()=>{const x=normalizedAdapter(async()=>({items:[1]}),raw=>({mode:'live',accounts:[{id:String(raw.items[0]),name:'New account'}]}));assert.equal((await x.load()).accounts[0].id,'1');await assert.rejects(()=>normalizedAdapter(async()=>({}),()=>({mode:'fixture',accounts:[]})).load())});
