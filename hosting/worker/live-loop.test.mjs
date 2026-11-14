// SYNTHETIC FIXTURE ONLY: no real organizer event, account, credentials, or note writes.
// Reproduce: node --test questathon_site/worker/live-loop.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

// Exercise the freshly assembled deployable Worker, not source-only adapter functions.
execFileSync(process.execPath,[new URL('../scripts/build.mjs',import.meta.url).pathname],{stdio:'pipe'});
const bundle=await readFile(new URL('../dist/server/index.js',import.meta.url));
const {workerWith}=await import('data:text/javascript;base64,'+bundle.toString('base64'));
function memoryD1(){
 const rows=new Map();let next=0;
 return {rows,prepare(sql){let args=[];return {
  bind(...values){args=values;return this;},
  async all(){
   if(sql.includes('FROM quest_cache'))return {results:[...rows.values()]};
   if(sql.includes('FROM quest_notes'))return {results:[]};
   throw Error('Unexpected synthetic SQL read: '+sql);
  },
  async run(){
   if(sql.includes('quest_rate_slot')){
    if(next>args[1])return {meta:{changes:0}};
    next=args[0];return {meta:{changes:1}};
   }
   if(sql.includes('INSERT INTO quest_cache')){
    const [name,retrieved_at,value]=args;rows.set(name,{name,retrieved_at,value});return {meta:{changes:1}};
   }
   throw Error('Synthetic test forbids writes other than cache/rate slot: '+sql);
  }
 };}};
}

test('SYNTHETIC built Worker: empty → sourced ranked change → replay → failure → absence → reappearance',async()=>{
 const db=memoryD1();let clock=Date.parse('2026-01-01T00:00:00Z'),step=0;
 const accountName='SYNTHETIC ONLY Acme Sandbox';
 const signal={id:'synthetic-live-loop-001',account:'A',title:'SYNTHETIC ONLY pilot interruption',summary:'Invented fixture: pilot paused pending owner review.'};
 const baseline={action:'SYNTHETIC ONLY routine account review',owner:'Synthetic CSM',urgency:10,success:'Review fixture',evidenceIds:['account:A']};
 const linked={linkedReferences:1,missingReferences:0,claimBearingReferences:1,stakeholderReportedReferences:0,state:'linked'};
 const sourcedBaseline={...baseline,evidenceStatus:linked};
 const triggered={action:'SYNTHETIC ONLY assign pilot recovery owner before routine review',owner:'Synthetic CSM',urgency:99,success:'Record a fixture owner and recovery checkpoint.',dueDate:'Synthetic next checkpoint'};
 const seed=(name,value)=>db.rows.set(name,{name,value:JSON.stringify(value),retrieved_at:new Date(clock).toISOString()});
 seed('get_my_accounts',{format:'account-quest-v2-export/1',accounts:[{id:'A',name:accountName,official_story:'Invented fixture account.'}]});
 for(const account of ['A','B'])seed('get_all_paperwork:'+account,{account,records:[]});
 const calls=[];
 const app=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>{
  const rpc=JSON.parse(init.body);calls.push(rpc.params.name);
  assert.equal(url,'https://questathon.aihackerscollective.com/api/public/mcp');
  assert.equal(rpc.params.name,'get_signals','Only injected read-only signal transport may run');
  assert.equal(init.method,'POST');
  const response=[{signals:[]},{signals:[signal]},{signals:[signal,structuredClone(signal)]},null,{signals:[]},{signals:[signal]}][step];
  return response?Response.json({jsonrpc:'2.0',id:rpc.id,result:{structuredContent:response}}):new Response('SYNTHETIC unavailable',{status:503});
 }});
 const env={DB:db,AQ_TOKEN:'synthetic-test-placeholder-not-a-secret',AQ_REVIEW_MODE:'normalized',AQ_PLAN_A:JSON.stringify({accountName,signalPolicy:{[signal.id]:triggered},recommendation:{decision:'Synthetic provisional plan',actions:[baseline]}})};
 // Use the actual public client read-model/ranking code served by the same built Worker.
 const asset=await app.fetch(new Request('https://synthetic.invalid/data.mjs'),env,{});
 assert.equal(asset.status,200);
 const {endpointAdapter,prioritizedActions}=await import('data:text/javascript;base64,'+Buffer.from(await asset.text()).toString('base64'));
 const read=async()=>{
  const pending=[];
  const data=await endpointAdapter('https://synthetic.invalid/api/account-snapshot',{fetcher:req=>app.fetch(new Request(req),env,{waitUntil:p=>pending.push(p)})}).load();
  await Promise.all(pending);assert.equal(data.mode,'live');assert.equal(data.accounts.length,1);return data;
 };
 const empty=await read();
 assert.equal(empty.syncHealth.signalState,'fresh-empty');
 assert.deepEqual(empty.accounts[0].signals,[]);
 assert.deepEqual(prioritizedActions(empty.accounts[0]),[sourcedBaseline]);
 step=1;clock+=181000;
 const changed=await read(),a=changed.accounts[0],reference='signal:'+signal.id;
 assert.equal(changed.syncHealth.signalState,'signals-present');
 assert.deepEqual(a.signals.map(s=>s.id),[signal.id]);
 assert.deepEqual(prioritizedActions(a),[{...triggered,origin:'CRM recommendation triggered by official signal',evidenceIds:[reference],evidenceStatus:linked},sourcedBaseline]);
 assert.deepEqual(a.evidence.find(e=>e.id===reference),{id:reference,sourceId:reference,title:signal.title,source:'Organizer signal / '+signal.id,confidence:'Official event; implications are CRM recommendations',claim:signal.summary});
 assert.deepEqual(a.signals[0].evidenceIds,[reference]);
 assert.notDeepEqual(prioritizedActions(a),prioritizedActions(empty.accounts[0]));
 step=2;clock+=181000;
 const duplicate=await read();
 const replayed=duplicate.accounts[0];
 assert.deepEqual(replayed.signals.map(s=>s.id),[signal.id],'Duplicate transport rows must not add events');
 assert.deepEqual(replayed.evidence,a.evidence,'Duplicate transport rows must not add evidence');
 assert.deepEqual(prioritizedActions(replayed),prioritizedActions(a),'Duplicate transport rows must not alter ranked actions');
 assert.equal(replayed.signals[0].observation.state,'unchanged');
 assert.equal(replayed.signals[0].observation.firstObservedAt,a.signals[0].observation.firstObservedAt);
 const lastGoodAt=duplicate.signalCheckedAt;
 step=3;clock+=181000;
 const failed=await read();
 assert.equal(failed.syncStatus,'stale');
 assert.equal(failed.syncHealth.signalState,'stale');
 assert.equal(failed.signalCheckedAt,lastGoodAt,'Failure must not masquerade as a successful fresh check');
 assert.equal(failed.syncHealth.lastSignalFailureAt,new Date(clock).toISOString());
 assert.deepEqual(failed.accounts[0],replayed,'Failed response preserves exact sourced action and last good observation');
 // Simulate a new Worker process with the same durable store, no in-memory history.
 const resumed=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>{
  const rpc=JSON.parse(init.body);calls.push(rpc.params.name);
  assert.equal(rpc.params.name,'get_signals');
  return Response.json({id:rpc.id,result:{signals:step===4?[]:[signal]}});
 }});
 const readResumed=()=>resumed.fetch(new Request('https://synthetic.invalid/api/account-snapshot'),env,{waitUntil(){}}).then(r=>r.json());
 step=4;clock+=181000;
 const absent=await readResumed(), aa=absent.accounts[0];
 assert.equal(absent.syncHealth.signalState,'fresh-empty');
 assert.deepEqual(aa.signals,[]);
 assert.deepEqual(prioritizedActions(aa),[sourcedBaseline],'Signal action may leave the current brief, but the past observation remains auditable');
 assert.equal(aa.signalTrail.absent[0].id,signal.id);
 assert.equal(aa.signalTrail.absent[0].state,'not-in-latest-feed');
 assert.match(aa.signalTrail.basis,/not organizer publication or resolution/);
 step=5;clock+=181000;
 const restored=await readResumed(), ar=restored.accounts[0], obs=ar.signals[0].observation;
 assert.equal(obs.state,'reappeared');
 assert.equal(obs.firstObservedAt,a.signals[0].observation.firstObservedAt);
 assert.equal(obs.lastReappearedAt,restored.signalCheckedAt);
 assert.deepEqual(prioritizedActions(ar),prioritizedActions(a));
 assert.equal(ar.signalTrail.absent.length,0);
 assert.deepEqual(calls,Array(6).fill('get_signals'));
});
