import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const contents=await readFile(new URL('../dist/server/index.js',import.meta.url));
const {workerWith,reviewerView}=await import('data:text/javascript;base64,'+contents.toString('base64'));
const request=(path,init)=>new Request('https://example.com'+path,init);
const fixture={format:'account-quest-v2-export/1',accounts:[{id:'A',name:'Synthetic'}]};
function fakeDb(){
 let next=0;const cache=new Map(),notes=[];
 return {cache,notes,prepare(sql){
  let args=[];return {bind(...vals){args=vals;return this;},async all(){
   if(sql.includes('FROM quest_cache'))return {results:[...cache.values()]};
   if(sql.includes('FROM quest_notes'))return {results:notes};
   throw Error(sql);
  },async run(){
   if(sql.includes('quest_rate_slot')){if(next>args[1])return {meta:{changes:0}};next=args[0];return {meta:{changes:1}};}
   if(sql.includes('INSERT INTO quest_cache')){
    const [name,retrieved_at,value]=args;cache.set(name,{name,retrieved_at,value});return {meta:{changes:1}};
   }
   if(sql.includes('INSERT INTO quest_notes')){
    const [id,account,created_at,title,body]=args;notes.unshift({id,account,created_at,title,body});return {meta:{changes:1}};
   }
   throw Error(sql);
  }};
 }};
}
const ctx=()=>{const pending=[];return {waitUntil(x){pending.push(x);},settle:()=>Promise.all(pending)}};
test('default reviewer is blocked from live data; browser can still use fixture',async()=>{
 const app=workerWith({upstreamFetch(){throw Error('should not call');}});
 assert.equal((await app.fetch(request('/api/account-snapshot'),{DB:fakeDb(),AQ_TOKEN:'not-a-token'},ctx())).status,403);
 assert.equal((await app.fetch(request('/api/admin/write-note',{method:'POST'}),{AQ_ADMIN_KEY:'demo'},ctx())).status,401);
 assert.match(await (await app.fetch(request('/'),{},ctx())).text(),/config.js/);
 assert.equal((await app.fetch(request('/crm/organizer-map.mjs'),{},ctx())).status,404);
});
test('concurrent viewers reserve one durable upstream slot then show normalized cache',async()=>{
 const db=fakeDb();let calls=0, time=Date.now();
 const app=workerWith({now:()=>time,upstreamFetch:async(url,init)=>{
  calls++; assert.equal(url,'https://questathon.aihackerscollective.com/api/public/mcp');
  assert.equal(init.headers.Authorization,'Bearer dummy-test-secret');
  assert.equal(JSON.parse(init.body).params.name,'get_my_accounts');
  return Response.json({id:JSON.parse(init.body).id,result:fixture});
 }});
 const env={DB:db,AQ_TOKEN:'dummy-test-secret',AQ_REVIEW_MODE:'normalized'};
 const ctxs=Array.from({length:12},ctx);
 const all=await Promise.all(ctxs.map(c=>app.fetch(request('/api/account-snapshot'),env,c)));
 assert(all.every(r=>r.status===503));await Promise.all(ctxs.map(c=>c.settle()));assert.equal(calls,1);
 const c=ctx(),response=await app.fetch(request('/api/account-snapshot'),env,c),out=await response.json();
 assert.equal(out.accounts[0].name,'Synthetic');assert.equal(out.syncStatus,'awaiting-signals'); await c.settle();assert.equal(calls,1);
 assert(!JSON.stringify(out).includes('dummy-test-secret'));
});
test('an authorized confirmed write becomes a bodyless reviewer note; never resubmit in cooldown',async()=>{
 const db=fakeDb(), time=Date.now();
 db.cache.set('get_my_accounts',{retrieved_at:new Date(time).toISOString(),name:'get_my_accounts',value:JSON.stringify(fixture)});
 let calls=0;
 const app=workerWith({now:()=>time,upstreamFetch:async(url,init)=>{
  calls++;assert.equal(JSON.parse(init.body).params.name,'write_note');return Response.json({id:JSON.parse(init.body).id,result:{structuredContent:{note_id:'organizer-note-42'}}});
 }});
 const env={DB:db,AQ_TOKEN:'dummy-test',AQ_ADMIN_KEY:'operator-test',AQ_REVIEW_MODE:'normalized'};
 const send=()=>app.fetch(request('/api/admin/write-note',{method:'POST',headers:{Authorization:'Bearer operator-test'},body:JSON.stringify({account:'A',title:'Confirmed test',text:'PRIVATE BODY'})}),env,ctx());
 const sent=await send();assert.equal(sent.status,200);assert.equal((await sent.json()).receiptId,'organizer-note-42');assert.equal((await send()).status,429);assert.equal(calls,1);
 const context=ctx(), response=await app.fetch(request('/api/account-snapshot'),env,context);const out=await response.json();await context.settle();
 assert.equal(out.accounts[0].notes[0].title,'Confirmed test');assert(!JSON.stringify(out).includes('PRIVATE BODY'));
});
test('redaction preserves source IDs and removes raw documents, email and token-shaped text',()=>{
 const result=reviewerView({accounts:[{evidence:[
  {id:'one',source:'Organizer paperwork / contract',claim:'PRIVATE CONTRACT'},
  {id:'two',source:'Organizer signal attachment / email',claim:'PRIVATE EMAIL'},
  {id:'three',source:'Organizer game journal',claim:'Cite user@example.com and bearer xxxxxxxxxxxx'}
 ],notes:[{id:'n',title:'Note',text:'PRIVATE NOTE'}]}]});
 assert.deepEqual(result.accounts[0].evidence.map(e=>e.id),['one','two','three']);
 const out=JSON.stringify(result);
 for(const s of ['PRIVATE','user@example.com','xxxxxxxxxxxx'])assert(!out.includes(s));
});

test('a scoped hosted plan applies only to the matching account name',async()=>{
 const db=fakeDb(),time=Date.now(),name='get_my_accounts';
 db.cache.set(name,{name,retrieved_at:new Date(time).toISOString(),value:JSON.stringify(fixture)});
 const app=workerWith({now:()=>time});
 const plan={accountName:'Synthetic',recommendation:{decision:'Protect verified account',actions:[]},notes:[{text:'must be ignored'}]};
 const read=async config=>(await (await app.fetch(request('/api/account-snapshot'),config,ctx())).json()).accounts[0];
 const env={DB:db,AQ_REVIEW_MODE:'normalized'};
 const a=await read({...env,AQ_PLAN_A:JSON.stringify(plan)});
 assert.equal(a.recommendation.decision,'Protect verified account');
 assert(!JSON.stringify(a).includes('must be ignored'));
 const other=await read({...env,AQ_PLAN_A:JSON.stringify({...plan,accountName:'Another account'})});
 assert.notEqual(other.recommendation.decision,'Protect verified account');
});

const seed=(db,name,value,at)=>db.cache.set(name,{name,value:JSON.stringify(value),retrieved_at:new Date(at).toISOString()});
const read=async(app,env)=>{const c=ctx(),res=await app.fetch(request('/api/account-snapshot'),env,c);await c.settle();return {status:res.status,...await res.json()};};
const active=db=>({DB:db,AQ_TOKEN:'dummy-test',AQ_ADMIN_KEY:'operator-test',AQ_REVIEW_MODE:'normalized'});

test('stale cache recovers from an SSE result on a nonclosing stream; unrelated RPC IDs are ignored',async()=>{
 const db=fakeDb(),clock=Date.now(), age=clock-240000;let cancelled=false;
 seed(db,'get_my_accounts',fixture,age);seed(db,'get_signals',{signals:[]},age);
 for(const account of ['A','B'])seed(db,'get_all_paperwork:'+account,{account,records:[]},age);
 const app=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>{
  const {id}=JSON.parse(init.body), enc=new TextEncoder();
  return new Response(new ReadableStream({start(s){
   s.enqueue(enc.encode('data: '+JSON.stringify({id:id-1,result:{signals:[]}})+'\n\n'));
   const data='data: '+JSON.stringify({id,result:{structuredContent:{signals:[{id:'new',account:'A',title:'New evidence',summary:'Change'}]}}})+'\r\n\r\n';
   s.enqueue(enc.encode(data.slice(0,7)));s.enqueue(enc.encode(data.slice(7)));
  },cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
 }});
 const output=await read(app,active(db));assert.equal(cancelled,true);assert.equal(output.accounts[0].signals[0].id,'new');assert.equal(output.syncHealth.signalState,'signals-present');
 assert.equal(output.signalCheckedAt,new Date(clock).toISOString());
});
test('malformed successful HTTP preserves last good data; fresh empty is real; failed paperwork does not starve signals',async()=>{
 const db=fakeDb(), start=Date.now(), age=start-240000;let clock=start;
 seed(db,'get_my_accounts',fixture,age);
 seed(db,'get_signals',{signals:[{id:'previous',account:'A',title:'Previously verified'}]},age);
 const calls=[];
 const app=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>{
  const {id,params}=JSON.parse(init.body);calls.push(params.name);
  if(params.name==='get_all_paperwork')return Response.json({id,result:{account:'wrong',records:[]}});
  return Response.json({id,result:calls.filter(x=>x==='get_signals').length===1?{unexpected:true}:{signals:[]}});
 }});
 const env=active(db);
 const p=await read(app,env);
 assert.equal(p.syncStatus,'stale');assert.equal(p.accounts[0].signals[0].id,'previous');assert.equal(p.signalCheckedAt,new Date(age).toISOString());
 assert.equal(p.syncHealth.lastSignalFailureAt,new Date(start).toISOString());
 clock+=61000;await read(app,env);clock+=61000;
 const next=await read(app,env);
 assert.deepEqual(calls,['get_signals','get_all_paperwork','get_signals']);
 assert.equal(next.syncHealth.signalState,'fresh-empty');assert.equal(next.accounts[0].signals.length,0);
 assert(!next.syncHealth.lastSignalFailureAt);
});
test('organizer confirmation survives local note index write failure',async()=>{
 const db=fakeDb(), now=Date.now(), old=db.prepare.bind(db);seed(db,'get_my_accounts',fixture,now);
 db.prepare=sql=>sql.includes('INSERT INTO quest_notes')?{bind(){return this;},async run(){throw Error('D1 unavailable');}}:old(sql);
 const app=workerWith({now:()=>now,upstreamFetch:async(url,init)=>Response.json({id:JSON.parse(init.body).id,result:{structuredContent:{ok:true}}})});
 const req=()=>request('/api/admin/write-note',{method:'POST',headers:{Authorization:'Bearer operator-test'},body:JSON.stringify({account:'A',title:'Test unit',text:'Text'})});
 const result=await app.fetch(req(),active(db),ctx());assert.deepEqual(await result.json(),{ok:true,reviewerIndexWritten:false});
 assert.equal((await app.fetch(req(),active(db),ctx())).status,429);
});

test('stale signals go first, then periodic roster and both paperwork refreshes get through under continuous viewing',async()=>{
 const db=fakeDb(), start=Date.now(), age=start-30*60000;let clock=start;
 seed(db,'get_my_accounts',{...fixture,accounts:[...fixture.accounts,{id:'B',name:'Synthetic B'}]},age);seed(db,'get_signals',{signals:[]},age);
 for(const account of ['A','B'])seed(db,'get_all_paperwork:'+account,{account,records:[]},age);
 const calls=[];
 const app=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>{
  const {id,params}=JSON.parse(init.body), ac=params.arguments.account;
  calls.push([params.name,ac??null,clock]);
  const result=params.name==='get_my_accounts'?{...fixture,accounts:[{id:'A',name:'Roster refreshed'},{id:'B',name:'Synthetic B'}]}:
   params.name==='get_signals'?{signals:[{id:'live',account:'A',title:'Fresh signal'}]}:{account:ac,records:[]};
  return Response.json({id,result});
 }});
 const env=active(db), first=await read(app,env);
 assert.equal(calls[0][0],'get_signals');assert.equal(first.syncHealth.signalState,'signals-present');
 for(let i=1;i<=20;i++){clock=start+30000*i;await read(app,env);}
 assert(calls.some(([name])=>name==='get_my_accounts'));
 for(const id of ['A','B'])assert(calls.some(([name,ac])=>name==='get_all_paperwork'&&ac===id));
 assert(calls.every(([, ,ts],i)=>i===0||ts-calls[i-1][2]>=61000));
 const final=await read(app,env);
 assert.equal(final.accounts[0].name,'Roster refreshed');
 assert(Date.parse(final.syncHealth.accountsCheckedAt)>age);
 assert(Object.values(final.syncHealth.paperworkCheckedAt).every(when=>Date.parse(when)>age));
});

test('ambiguous or contradictory note acknowledgements never confirm or create a reviewer row',async()=>{
 const db=fakeDb();let clock=Date.now();seed(db,'get_my_accounts',fixture,clock);
 for(const result of [{},{structuredContent:{}},{content:[{type:'text',text:'{}'}]},{structuredContent:{note_id:'test-note-1',success:false}}]){
  const app=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>Response.json({id:JSON.parse(init.body).id,result})});
  const req=request('/api/admin/write-note',{method:'POST',headers:{Authorization:'Bearer operator-test'},body:JSON.stringify({account:'A',title:'Test unit',text:'Text'})});
  const response=await app.fetch(req,active(db),ctx());
  assert.equal(response.status,502);assert.match((await response.json()).error,/not confirmed/);assert.equal(db.notes.length,0);
  clock+=61000;
 }
});

test('optional exact action evidence overlay preserves existing plan and ignores malformed or unmatched additions',async()=>{
 const db=fakeDb(),time=Date.now();
 seed(db,'get_my_accounts',{...fixture,accounts:[
  {id:'A',name:'Synthetic',facts:[{id:'old-a',text:'Source 1'},{id:'new-a',text:'Source 2'}]},
  {id:'B',name:'Other',facts:[{id:'blocked-b',text:'Unrelated source'}]}
 ]},time);
 const app=workerWith({now:()=>time});
 const plan={accountName:'Synthetic',recommendation:{decision:'Approved decision',actions:[
  {action:'Exact task',owner:'CSM',evidenceIds:['old-a']},{action:'Second task'}
 ]}};
 const env={DB:db,AQ_REVIEW_MODE:'normalized',AQ_PLAN_A:JSON.stringify(plan)};
 const parse=async raw=>{const snapshot=await read(app,{...env,AQ_ACTION_EVIDENCE:raw});assert.equal(snapshot.status,200);return snapshot.accounts[0].recommendation;};
 const enabled=await parse(JSON.stringify({A:{accountName:'Synthetic',actions:{'Exact task':['new-a','old-a','blocked-b'],'second task':['new-a'],'not a task':['new-a']}}}));
 assert.equal(enabled.decision,'Approved decision');assert.equal(enabled.actions[0].owner,'CSM');assert.equal(enabled.actions.length,2);
 assert.deepEqual(enabled.actions.map(x=>x.evidenceIds),[['old-a','new-a'],[]]);
 for(const malformed of ['', '{', 'null', '[]',
  JSON.stringify({A:{accountName:'Other',actions:{'Exact task':['new-a']}}}),
  JSON.stringify({A:{accountName:'Synthetic',actions:{'Exact task':['new-a',null]}}})]){
  assert.deepEqual((await parse(malformed)).actions.map(x=>x.evidenceIds),[['old-a'],[]]);
 }
});

test('proposed checkpoints validate calendar dates and sources without overwriting existing schedules',async()=>{
 const db=fakeDb(), now=Date.now();
 seed(db,'get_my_accounts',{...fixture,accounts:[
  {id:'A',name:'Synthetic',facts:[{id:'exact-a',text:'Local source'}]}, {id:'B',name:'Other',facts:[{id:'foreign-b',text:'Other source'}]}
 ]},now);
 const existing={date:'2026-11-18',purpose:'Already planned',basis:'Existing plan'};
 const plan={accountName:'Synthetic',recommendation:{actions:[
  {action:'Verify timing',dueDate:'Next customer review',owner:'CSM'},
  {action:'Dated timing',timing:{kind:'sourced-date',date:'2026-11-22',evidenceIds:['exact-a']}},
  {action:'Plain calendar timing',dueDate:'Before 5 December'},
  {action:'Already planned',proposedCheckpoint:existing},
  {action:'Invalid date'},
  {action:'Invalid calendar roll'},
 ]}};
 const proposedCheckpoint={date:'2026-11-16',purpose:'Confirm the exact date',basis:'Proposed CSM planning target',evidenceIds:['exact-a','foreign-b']};
 const actions=Object.fromEntries(plan.recommendation.actions.map(x=>[x.action,{evidenceIds:['exact-a','foreign-b'],proposedCheckpoint}]));
 actions['Invalid date'].proposedCheckpoint={...proposedCheckpoint,date:'2026-11-16T04:00:00Z'};
 actions['Invalid calendar roll'].proposedCheckpoint={...proposedCheckpoint,date:'2026-02-30'};
 const env={DB:db,AQ_REVIEW_MODE:'normalized',AQ_PLAN_A:JSON.stringify(plan),AQ_ACTION_EVIDENCE:JSON.stringify({A:{accountName:'Synthetic',actions}})};
 const a=(await read(workerWith({now:()=>now}),env)).accounts[0].recommendation.actions;
 assert.deepEqual(a[0].proposedCheckpoint,{...proposedCheckpoint,evidenceIds:['exact-a']});
 assert.equal(a[0].dueDate,'Next customer review');
 assert.equal(a[0].owner,'CSM');
 assert.equal(a[1].proposedCheckpoint,undefined);
 assert.deepEqual(a[1].timing,plan.recommendation.actions[1].timing);
 assert.equal(a[2].proposedCheckpoint,undefined);
 assert.deepEqual(a[3].proposedCheckpoint,{...existing,evidenceIds:[]});
 assert.equal(a[4].proposedCheckpoint,undefined);assert.equal(a[5].proposedCheckpoint,undefined);
 assert(a.every(x=>x.evidenceIds.join(',')==='exact-a'));
});

test('valid feed observation trail distinguishes legacy replay, edits, disappearance and reappearance',async()=>{
 const db=fakeDb(), start=Date.now(), before=start-240000;let clock=start;
 const event={id:'known',account:'A',title:'Existing event',summary:'Original',dated:'2026-11-16',set_off_at:'old-transport'};
 const sameIdOther={...event,account:'B',title:'Other account event'};
 seed(db,'get_my_accounts',{...fixture,accounts:[fixture.accounts[0],{id:'B',name:'Other'}]},start);
 for(const account of ['A','B'])seed(db,'get_all_paperwork:'+account,{account,records:[]},start);
 // Old format can be a previously verified JSON-RPC MCP wrapper.
 seed(db,'get_signals',{structuredContent:{signals:[event,sameIdOther]}},before);
 let responseValue={signals:[{...event,set_off_at:'replayed-transport'},sameIdOther]};
 const app=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>Response.json({id:JSON.parse(init.body).id,result:responseValue})});
 const env=active(db), at=()=>new Date(clock).toISOString();
 const run=async value=>{clock+=185000;responseValue=value;return read(app,env);};
 let snapshot=await read(app,env), [a,b]=snapshot.accounts;
 assert.equal(a.signals[0].observation.state,'unchanged');
 assert.equal(a.signals[0].observation.firstObservedAt,new Date(before).toISOString());
 assert.equal(a.signals[0].observation.lastObservedAt,at());
 assert(!JSON.stringify(snapshot).includes('_crmSignalObservations'));assert(!JSON.stringify(snapshot).includes('digest'));
 assert.equal(b.signals[0].observation.state,'unchanged');
 snapshot=await run({signals:[{...event,summary:'Material edit'},sameIdOther,{...event,id:'unseen-locally'}]});[a,b]=snapshot.accounts;
 assert.equal(a.signals[0].observation.state,'content-changed');assert.equal(a.signals[0].observation.materialChangeAt,at());
 assert.equal(a.signals[1].observation.state,'first-observed-after-baseline');
 assert.equal(b.signals[0].observation.state,'unchanged');
 snapshot=await run({unexpected:true});[a]=snapshot.accounts;
 assert.equal(a.signals[0].observation.state,'content-changed');
 assert(Date.parse(a.signalTrail.updatedAt)<clock);
 snapshot=await run({signals:[sameIdOther]});[a,b]=snapshot.accounts;
 assert.equal(a.signals.length,0);assert.equal(b.signals.length,1);assert.equal(b.signalTrail.absent.length,0);
 const absent=a.signalTrail.absent.find(x=>x.id==='known');
 assert.equal(absent.state,'not-in-latest-feed');assert.equal(absent.absentSince,at());
 assert.match(a.signalTrail.basis,/not organizer publication or resolution/);
 snapshot=await run({signals:[{...event,summary:'Material edit'},sameIdOther]});[a]=snapshot.accounts;
 assert.equal(a.signals[0].observation.state,'reappeared');assert.equal(a.signals[0].observation.firstObservedAt,new Date(before).toISOString());
 assert.equal(a.signals[0].observation.lastReappearedAt,at());
 assert(!a.signalTrail.absent.some(x=>x.id==='known'));
 const reappearedAt=at();
 snapshot=await run({signals:[{...event,summary:'Material edit'},sameIdOther]});[a]=snapshot.accounts;
 assert.equal(a.signals[0].observation.state,'unchanged');assert.equal(a.signals[0].observation.lastReappearedAt,reappearedAt);
});

test('exact action constraint requires account-scoped evidence and preserves an existing constraint',async()=>{
 const db=fakeDb(),now=Date.now();
 seed(db,'get_my_accounts',{...fixture,accounts:[
  {id:'A',name:'Synthetic',facts:[{id:'own-id',text:'Local gate'}]}, {id:'B',name:'Other',facts:[{id:'foreign-id',text:'Other gate'}]}
 ]},now);
 const plan={accountName:'Synthetic',recommendation:{actions:[
  {action:'Eligible',owner:'CSM'},
  {action:'Foreign only'},
  {action:'Existing',decisionConstraint:{text:'Keep this real constraint',evidenceIds:['own-id']}},
  {action:'No evidence'},
 ]}};
 const actions={
  Eligible:{decisionConstraint:{text:'Keep scoped documents until verified',evidenceIds:['own-id','foreign-id','own-id']}},
  'Foreign only':{decisionConstraint:{text:'Should not be shown',evidenceIds:['foreign-id']}},
  Existing:{decisionConstraint:{text:'Cannot replace curated value',evidenceIds:['own-id']}},
  'No evidence':{decisionConstraint:{text:'No records',evidenceIds:[]}}
 };
 const env={DB:db,AQ_REVIEW_MODE:'normalized',AQ_PLAN_A:JSON.stringify(plan),AQ_ACTION_CHECKPOINTS:JSON.stringify({A:{accountName:'Synthetic',actions}})};
 const a=(await read(workerWith({now:()=>now}),env)).accounts[0].recommendation.actions;
 assert.deepEqual(a[0].decisionConstraint,{text:'Keep scoped documents until verified',evidenceIds:['own-id']});
 assert.equal(a[0].owner,'CSM');assert.equal(a[1].decisionConstraint,undefined);
 assert.deepEqual(a[2].decisionConstraint,plan.recommendation.actions[2].decisionConstraint);
 assert.equal(a[3].decisionConstraint,undefined);
});

test('sparse viewer traffic foregrounds overdue roster and discovers only its new paperwork ID without extending notes',async()=>{
 const db=fakeDb(), start=Date.now(), old=start-46*60000;let clock=start;
 const two={...fixture,accounts:[...fixture.accounts,{id:'B',name:'Known B'}]};
 const novel='surprise-42', added={id:novel,name:'Newly rostered client'};
 seed(db,'get_my_accounts',two,old);seed(db,'get_signals',{signals:[]},start-60000);
 for(const id of ['A','B','unlisted'])seed(db,'get_all_paperwork:'+id,{account:id,records:[]},old);
 const calls=[];
 const app=workerWith({now:()=>clock,upstreamFetch:async(url,init)=>{
  const {id,params}=JSON.parse(init.body), ac=params.arguments.account;
  calls.push({name:params.name,account:ac,at:clock});
  const result=params.name==='get_my_accounts'?{...two,accounts:[...two.accounts,added]}:
   params.name==='get_signals'?{signals:[]}:{account:ac,records:[{kind:'profile',path:'profile.json',data:{currency:'CAD',renewal:{annual_value:42}}}]};
  return Response.json({id,result});
 }});
 const env=active(db);
 let current=await read(app,env);
 assert.equal(calls[0].name,'get_my_accounts');assert.equal(current.accounts.length,3);
 assert.equal(current.syncHealth.paperworkCheckedAt[novel],null);
 assert.equal(current.syncHealth.paperworkCheckedAt.unlisted,undefined);
 assert.equal(current.syncStatus,'awaiting-paperwork');
 const denied=await app.fetch(request('/api/admin/write-note',{method:'POST',headers:{Authorization:'Bearer operator-test'},body:JSON.stringify({account:novel,title:'Not allowed',text:'Not allowed'})}),env,ctx());
 assert.equal(denied.status,400);assert.equal(calls.length,1);
 for(let i=1;i<=8;i++){clock=start+i*10*60000;current=await read(app,env);}
 assert(calls.some(x=>x.name==='get_all_paperwork'&&x.account===novel));
 assert(calls.some(x=>x.name==='get_signals'));
 assert(!calls.some(x=>x.account==='unlisted'||x.account==='C'||x.name==='write_note'));
 assert(calls.every((x,i)=>i===0||x.at-calls[i-1].at>=61000));
 const a=current.accounts.find(x=>x.id===novel);
 assert.equal(a.bookValue.amount,42);assert(a.bookValue.evidenceIds.some(id=>id.includes(novel)));
 assert(current.syncHealth.paperworkCheckedAt[novel]);
});

test('reviewer numbers track direct annual profile provenance without substituting invoice money',async()=>{
 const db=fakeDb(),now=Date.now(), accounts=[
  {id:'A',name:'Different currencies'}, {id:'B',name:'No profile currency'}, {id:'T',name:'Zero annual'}
 ];
 seed(db,'get_my_accounts',{...fixture,accounts},now);
 for(const [account,currency,amount] of [['A','GBP',200],['B',undefined,200],['T','EUR',0]]){
  seed(db,'get_all_paperwork:'+account,{account,records:[
   {kind:'contract',path:'contract.txt',text:'Private contributor email test@example.com'},
   {kind:'profile',path:'profile.json',data:{currency,renewal:{annual_value:amount}}},
   {kind:'invoices',path:'invoices.json',data:{currency:'EUR',first_year_total:account==='T'?0:200}}
  ]},now);
 }
 const result=await read(workerWith({now:()=>now}),{DB:db,AQ_REVIEW_MODE:'normalized'});
 const [a,b,t]=result.accounts;
 assert.equal(a.bookValue.amount,200);assert.equal(a.bookValue.currency,'GBP');
 assert.deepEqual(a.bookValue.provenance.directEvidenceIds,['paperwork:A/profile.json']);
 assert.deepEqual(a.bookValue.provenance.invoiceComparison,{status:'different-currency',amount:200,currency:'EUR',evidenceIds:['paperwork:A/invoices.json']});
 assert(a.gaps.some(gap=>gap.question.includes('invoice records differ')));
 assert.equal(b.bookValue.amount,null);assert.equal(b.bookValue.provenance.status,'currency-missing');
 assert.equal(b.bookValue.provenance.invoiceComparison.status,'not-comparable');
 assert.equal(t.bookValue.amount,0);assert.equal(t.bookValue.provenance.invoiceComparison.status,'same-amount-and-currency');
 assert(!JSON.stringify(result).includes('Private contributor'));
});

test('reviewer diagnostics distinguish missing, ledger-only and stakeholder-reported evidence without leaking bad IDs',async()=>{
 const db=fakeDb(),now=Date.now();
 seed(db,'get_my_accounts',{...fixture,accounts:[{id:'A',name:'Synthetic',facts:[{id:'stakeholder-claim',said_by:'Demo',text:'Reported adoption',status:'told'}]}],
  files:[{account:'A',id:'file-index-only',title:'An indexed file',path:'index.csv'}]
 },now);
 const plan={accountName:'Synthetic',recommendation:{decision:'Review adoption',evidence:['bad-private-id'],
  actions:[{action:'Review report',evidenceIds:['stakeholder-claim','bad-private-id','stakeholder-claim']},{action:'Read export',evidenceIds:['file-index-only']},{action:'Find record'}]}};
 const result=await read(workerWith({now:()=>now}),{DB:db,AQ_REVIEW_MODE:'normalized',AQ_PLAN_A:JSON.stringify(plan)});
 const a=result.accounts[0].recommendation;
 assert.equal(a.evidenceStatus.state,'not-found');assert.deepEqual(a.evidence,[]);
 assert.deepEqual(a.actions[0].evidenceStatus,{linkedReferences:1,missingReferences:1,claimBearingReferences:1,stakeholderReportedReferences:1,state:'partial'});
 assert.deepEqual(a.actions[0].evidenceIds,['stakeholder-claim']);
 assert.equal(a.actions[1].evidenceStatus.state,'index-only');assert.equal(a.actions[2].evidenceStatus.state,'not-linked');
 assert(!JSON.stringify(result).includes('bad-private-id'));
});
