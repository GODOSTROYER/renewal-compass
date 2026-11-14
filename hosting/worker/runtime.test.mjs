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
  return Response.json({result:fixture});
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
  calls++;assert.equal(JSON.parse(init.body).params.name,'write_note');return Response.json({result:{structuredContent:{id:'ok'}}});
 }});
 const env={DB:db,AQ_TOKEN:'dummy-test',AQ_ADMIN_KEY:'operator-test',AQ_REVIEW_MODE:'normalized'};
 const send=()=>app.fetch(request('/api/admin/write-note',{method:'POST',headers:{Authorization:'Bearer operator-test'},body:JSON.stringify({account:'A',title:'Confirmed test',text:'PRIVATE BODY'})}),env,ctx());
 assert.equal((await send()).status,200);assert.equal((await send()).status,429);assert.equal(calls,1);
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
