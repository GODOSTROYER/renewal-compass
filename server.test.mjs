import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const testDir=await mkdtemp(join(tmpdir(),'quest-crm-test-'));
process.env.AQ_STATE_DIR=testDir;
const {decodeRpc,makeServer,nextRead}=await import('./server.mjs');
test.after(()=>rm(testDir,{recursive:true,force:true}));
test('SSE negotiation parses a JSON-RPC response',()=>assert.deepEqual(decodeRpc('event: message\ndata: {"jsonrpc":"2.0","result":{"ok":true}}\n\n','text/event-stream').result,{ok:true}));
test('JSON negotiation parses result',()=>assert.equal(decodeRpc('{"result":3}','application/json').result,3));
test('public reviewer cannot write, introspect cache or fetch local notes',async()=>{
 const app=makeServer().listen(0,'127.0.0.1');await once(app,'listening');
 try{
  const base='http://127.0.0.1:'+app.address().port;
  assert.equal((await fetch(base+'/api/admin/write-note',{method:'POST',body:'{"text":"x"}'})).status,401);
  assert.equal((await fetch(base+'/api/admin/cache')).status,401);
  assert.equal((await fetch(base+'/discovery.local.mjs')).status,404);
  assert.equal((await fetch(base+'/api/account-snapshot')).status,503);
  assert.match(await (await fetch(base+'/')).text(),/config.js/);
 }finally{app.close()}
});
import {normalizeOrganizer} from './organizer-map.mjs';
test('uses confirmed game snapshot shape, retains evidence provenance and sums only agreed and won',()=>{
 const result=normalizeOrganizer({get_my_accounts:{value:{format:'account-quest-v2-export/1',accounts:[{id:'T',name:'Novel name',facts:[{id:'note1',text:'Claim',said_by:'Alice',status:'verified',verified_by:'file1'}],opportunities:[{id:'r1',title:'Closed',stage:'agreed',worth_up_to:10},{id:'r2',title:'Open',stage:'qualified',worth_up_to:100}],offers:[{id:'o1',status:'won',value:2},{id:'o2',status:'declined',value:4}]}]}}});
 assert.equal(result.accounts[0].gameValue.amount,12);
 assert.deepEqual(result.accounts[0].gameValue.evidenceIds,['r1','o1']);
 assert.equal(result.accounts[0].evidence[0].confidence,'Verified by file1');
});

test('contract currency and evidence remain distinct from game deal totals',()=>{
 const r=normalizeOrganizer({get_my_accounts:{exported_at:'2026-11-01',format:'account-quest-v2-export/1',accounts:[{id:'A',name:'Synthetic'}]},
 'get_all_paperwork:A':{account:'A',records:[{path:'profile.json',kind:'profile',data:{currency:'EUR',renewal:{term_ends:'2027-01-31',annual_value:12345}}},{path:'contract.txt',kind:'contract',text:'An example order'},{path:'invoices.json',kind:'invoices',data:{currency:'EUR',first_year_total:12345}}]}},{A:{currency:'USD'}});
 const a=r.accounts[0];assert.equal(a.bookValue.currency,'EUR');assert.equal(a.bookValue.amount,12345);assert.equal(a.gameValue.amount,0);
 assert.deepEqual(a.bookValue.evidenceIds,['paperwork:A/profile.json','paperwork:A/contract.txt','paperwork:A/invoices.json']);assert(a.bookValue.evidenceIds.every(id=>a.evidence.some(x=>x.id===id)));
});
test('new signal action appears only after source arrives, with stable isolated IDs',()=>{
 const results={get_my_accounts:{format:'account-quest-v2-export/1',accounts:[{id:'A',name:'Synthetic'},{id:'B',name:'Other'}]}};
 const policy={A:{recommendation:{actions:[{action:'baseline'}]},signalPolicy:{new_risk:{action:'investigate immediately',dueDate:'today',urgency:99}}}};
 const signal={id:'new_risk',account:'A',title:'New risk',summary:'A signal',dated:'2026-11-03',records:[{path:'example.csv',kind:'usage'}]};
 const before=normalizeOrganizer(results,policy);
 const after=normalizeOrganizer({...results,get_signals:{at:'2026-11-04',value:{signals:[signal,signal]}}},policy);
 assert.equal(before.accounts[0].recommendation.actions[0].action,'baseline');
 assert.equal(after.accounts[0].recommendation.actions[0].action,'investigate immediately');
 assert.deepEqual(after.accounts[0].recommendation.actions[0].evidenceIds,['signal:new_risk']);
 assert.equal(after.accounts[0].signals.length,1);assert.equal(after.accounts[0].signals[0].id,'new_risk');assert.equal(after.accounts[1].signals.length,0);
 assert.equal(after.accounts[0].risks[0].dueDate,'today');assert.equal(after.signalCheckedAt,'2026-11-04');
});

test('background refresh rereads the roster without starving verified live signals',()=>{
 const now=Date.parse('2026-11-14T12:00:00Z'), roster={at:'2026-11-14T11:53:00Z'};
 const A={};const B={};
 assert.equal(nextRead({},now),'get_my_accounts');
 assert.equal(nextRead({get_my_accounts:roster},now),'get_signals');
 const fresh={at:'2026-11-14T11:59:00Z'};
 assert.equal(nextRead({get_my_accounts:roster,get_signals:fresh},now),'get_all_paperwork:A');
 assert.equal(nextRead({get_my_accounts:roster,get_signals:fresh,'get_all_paperwork:A':A,'get_all_paperwork:B':B},now),'get_my_accounts');
 assert.equal(nextRead({get_my_accounts:roster,get_signals:roster,'get_all_paperwork:A':A,'get_all_paperwork:B':B},now),'get_signals');
});

test('reassigned internal account ID cannot inherit the old book value or buying plan',()=>{
 const results={get_my_accounts:{format:'account-quest-v2-export/1',accounts:[{id:'A',name:'New account'}]},
  'get_all_paperwork:A':{accountName:'Old account',value:{account:'A',records:[{kind:'profile',path:'p.json',data:{currency:'USD',renewal:{annual_value:999}}}]}}};
 const [a]=normalizeOrganizer(results,{A:{accountName:'Old account',recommendation:{decision:'Never display this'}}}).accounts;
 assert.equal(a.bookValue.amount,null);
 assert.notEqual(a.recommendation.decision,'Never display this');
});

test('duplicated official results are counted once; a missing value stays unknown',()=>{
 const closed={id:'o1',title:'Closed',stage:'agreed',worth_up_to:17};
 const input={get_my_accounts:{format:'account-quest-v2-export/1',accounts:[{id:'A',name:'Test',opportunities:[closed,closed]}]}};
 const [a]=normalizeOrganizer(input).accounts;
 assert.equal(a.gameValue.amount,17);assert.deepEqual(a.gameValue.evidenceIds,['o1']);
 delete closed.worth_up_to;
 assert.equal(normalizeOrganizer(input).accounts[0].gameValue.amount,null);
});
