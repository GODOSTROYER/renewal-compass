import {fixtureAdapter,discoveryAdapter,endpointAdapter,remaining,reviewAccount,proposalReadiness,prioritizedActions} from './data.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n};
const add=(parent,...children)=>{for(const child of children)parent.append(child);return parent};
const card=(name,full=false)=>add(el('article',null,'card'+(full?' full':'')),el('h3',name));
const empty=(n,msg)=>add(n,el('p',msg,'metadata'));
function list(parent,items,render,emptyText){if(!items?.length)return empty(parent,emptyText);const ul=el(parent.id===blockId('actions')?'ol':'ul');items.forEach((item,index)=>ul.append(render(item,index)));return add(parent,ul)}
function links(ids){const n=el('span',null,'source-links');for(const id of ids??[]){const a=el('a',id,'ref');a.href='#evidence-'+encodeURIComponent(id);a.setAttribute('aria-label','View evidence '+id);n.append(a)}return n}
function metadata(label,text){return add(el('p',null,'metadata'),el('span',label,'meta-label'),el('span',text??'Unknown','meta-value'))}
function money(v,c){if(!Number.isFinite(v))return 'Value unknown';try{return new Intl.NumberFormat('en',{style:'currency',currency:c,maximumFractionDigits:0}).format(v)}catch{return String(v)}}
const cfg=globalThis.QUEST_CRM_CONFIG??{};
const adapter=cfg.normalizedEndpoint?endpointAdapter(cfg.normalizedEndpoint):new URLSearchParams(location.search).get('mode')==='discovery'?discoveryAdapter:fixtureAdapter;
let current,snapshot,started=false;
const blockId=s=>'review-'+s;
function jump(label,id){
 const a=el('a',label,'jump');a.setAttribute('aria-label',label);a.href='#'+blockId(id);const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 16 16');icon.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M3 13 13 3M4 3h9v9');icon.append(path);a.append(icon);return a;
}
function sourceTime(v){
 if(!v)return 'not recorded';
 const parsed=new Date(v);
 return Number.isNaN(parsed.valueOf())?String(v):parsed.toISOString().replace('T',' ').slice(0,16)+' UTC';
}
function render(){
 $('accounts').replaceChildren();
 for(const a of snapshot.accounts){let b=add(el('button'),el('span',a.name),el('span',String(a.deals?.length??0)+((a.deals?.length??0)===1?' deal':' deals'),'account-count'));b.dataset.accountId=a.id;b.setAttribute('aria-pressed',a.id===current);b.addEventListener('click',()=>{current=a.id;render();[...$('accounts').children].find(n=>n.dataset.accountId===a.id)?.focus()});$('accounts').append(b)}
 const a=snapshot.accounts.find(x=>x.id===current),out=$('workspace');out.replaceChildren();
 if(!a){connectionState('No accounts in this snapshot.','The connection returned no account records. No recommendation has been generated.');return}
 out.append(add(el('div',null,'account-heading'),add(el('div',null,'title'),el('h2',a.name),el('span',Number.isInteger(a.move)?'Account move '+a.move:'Move unknown','badge')),el('p',a.context??'','account-context')));
 const overview=card('Account brief',true);overview.classList.add('account-brief');
 const metrics=el('dl',null,'brief');
 const row=(label,value)=>metrics.append(add(el('div',null,'brief-field'+(label==='Decision'?' decision':'')),el('dt',label),typeof value==='string'?el('dd',value):add(el('dd'),value)));
 const book=a.bookValue;
 row('Contract book',book?.amount!=null?add(el('span',money(book.amount,book.currency),'metric'),links(book.evidenceIds)): 'Unknown or not yet sourced');
 if(book?.termEnd)row('Contract term ends',book.termEnd);
 if(a.gameValue)row('Game agreed value',add(el('span',money(a.gameValue.amount,a.gameValue.currency),'metric'),el('span',' · agreed deals + won offers','metadata'),links(a.gameValue.evidenceIds)));
 if(a.recommendation?.decision)row('Decision',el('strong',a.recommendation.decision));
 const routes=el('div',null,'brief-nav');
 routes.setAttribute('aria-label','Jump to a judging answer');
 routes.append(jump('Buying group','deals'),jump('Top 3 actions','actions'),jump('Timed risks','risks'),jump('Missing facts','gaps'),jump('Exact sources','evidence'));
 overview.append(metrics);out.append(overview,routes);
 const r=a.recommendation, grid=el('div',null,'grid'), plan=card('Top actions',true);plan.id=blockId('actions');
 if(r){plan.append(add(el('div',null,'decision-context'),metadata('Confidence',r.confidence),el('p',r.reason??'','decision-reason')),metadata('Biggest unknown',r.unknown),links(r.evidence));list(plan,prioritizedActions(a).slice(0,3),(x,i)=>add(el('li',null,'action-item'),el('span',String(i+1).padStart(2,'0'),'action-number'),add(el('div',null,'action-body'),el('strong',x.action??'Action pending'),add(el('div',null,'action-meta'),metadata('Owner',x.owner),metadata('Due',x.dueDate??remaining(a.move,x.move))),x.deal?metadata('Deal',x.deal):'',metadata('Done when',x.success),x.origin?metadata('Basis',x.origin):'',links(x.evidenceIds))), 'No actions recorded.')}
 else empty(plan,'Make no recommendation until there is evidence.');
 const quality=card('Decision quality checks',true);
 list(quality,reviewAccount(a),x=>el('li',x.message), 'No gaps flagged by the local checks. This is not an organizer score.');
 const deals=card('Deals & buying groups',true),stake=card('Account contacts'),evidence=card('Evidence ledger',true),timeline=card('Account activity');
 deals.id=blockId('deals');evidence.id=blockId('evidence');
 list(deals,a.deals,x=>{
  const n=add(el('li',null,'deal-item'),add(el('div',null,'deal-summary'),el('strong',x.name??'Deal','deal-name'),metadata('Stage',x.stage),metadata('Value',money(x.value,x.currency)),metadata('Tries left',x.attemptsRemaining)),add(el('div',null,'deal-facts'),metadata('Deadline',x.deadlineText??remaining(a.move,x.deadlineMove)),metadata('Blocker',x.blocker),metadata('Authority',x.approver)),links(x.evidence));
  if(x.roles?.length){
   const group=el('details');group.open=true;group.append(el('summary','Deal stakeholders and trust'));
   list(group,x.roles,y=>add(el('li'),el('strong',y.role??'Role unknown'),metadata('Person',y.name),metadata('Trust',y.trust),y.rationale?el('p',y.rationale,'metadata'):'',links(y.evidenceIds)),'Deal roles are not verified.');n.append(group);
  }
  const state=proposalReadiness(x,a.evidence??[],[]);
  if(state.state==='locked')n.append(el('p','Locked: no more proposal attempts.','warn'));
  if(state.state==='discovery')n.append(el('p','Do not send: recipient, format, or verified evidence requirements are incomplete.','warn'));
  if(x.proposal){
   const review=el('details'), readout=el('p',null,'metadata'), set=el('fieldset'), boxes=[];
   readout.setAttribute('aria-live','polite');
   review.append(el('summary',state.state==='agreed'?'Review accepted proposal evidence':'Rehearse proposal evidence'));
   review.append(metadata('Format',x.proposal.kind),metadata('Recipient',x.proposal.recipient));
   if(state.state==='agreed'){review.append(el('p','Accepted source record'),links(x.evidence));}
   else if(state.state!=='locked'){
    set.append(el('legend','Select exact sources for this draft'));
    const update=()=>{
     const next=proposalReadiness(x,a.evidence??[],boxes.filter(z=>z.checked).map(z=>z.value));
     readout.textContent=next.state==='ready'?'Checklist satisfied. Nothing was sent.':'Not ready. Missing: '+(next.missing.join(', ')||'none')+'; extra: '+(next.irrelevant.join(', ')||'none')+'.';
    };
    for(const e of a.evidence??[]){if(!e.sourceId)continue;const label=el('label',null,'source-choice'),input=el('input');input.type='checkbox';input.value=e.sourceId;input.addEventListener('change',update);boxes.push(input);label.append(input,' '+e.title+' ['+e.sourceId+']');set.append(label)}
    review.append(set,readout);update();
   }n.append(review);
  }return n;
 }, 'No deals identified.');
 list(stake,a.stakeholders,x=>add(el('li'),el('strong',x.name),metadata('Role',x.role),metadata('Authority',x.authority),metadata('Trust',x.trust)), 'No stakeholders recorded.');
 list(evidence,a.evidence,x=>{const n=add(el('li'),el('strong',x.id+' · '+x.title),el('p',x.claim??''),metadata('Source',x.source),x.sourceId&&x.sourceId!==x.id?metadata('Exact source ID',x.sourceId):'',metadata('Confidence',x.confidence),metadata('Move',x.move));n.id='evidence-'+x.id;return n},'No evidence collected.');
 list(timeline,[...(a.timeline??[])].sort((a,b)=>(b.move??0)-(a.move??0)),x=>add(el('li'),el('strong',Number.isInteger(x.move)?'Move '+x.move:'Move not recorded'),el('p',x.text??''),links(x.evidence)),'No activity recorded.');
 const risks=card('Timed risks'),gaps=card('Missing facts'),notes=card('Signals and notes',true);notes.id=blockId('signals');stake.classList.add('contacts');timeline.classList.add('timeline');quality.classList.add('quality');
 risks.id=blockId('risks');gaps.id=blockId('gaps');
 list(risks,a.risks,x=>add(el('li'),el('strong',x.title),metadata('Timing',x.dueDate??remaining(a.move,x.dueMove)),metadata('Impact',x.impact),links(x.evidenceIds)),'No sourced timed risks recorded.');
 list(gaps,a.gaps,x=>add(el('li'),el('strong',x.question),metadata('Why it matters',x.why),metadata('Ask',x.ask),links(x.evidenceIds)),'No explicit discovery gaps recorded.');
 list(notes,[...(a.signals??[]),...(a.notes??[])],x=>add(el('li'),el('strong',x.title??x.kind??'Signal'),el('p',x.text),metadata('Reported',x.at),x.arrivedAt?metadata('Received',x.arrivedAt):'',links(x.evidenceIds)),'No verified live signals or notes loaded.');
 out.append(add(grid,plan,deals,risks,gaps,notes,evidence,stake,timeline,quality));
}
if(cfg.normalizedEndpoint&&new URLSearchParams(location.search).get('operator')==='1'){
 const station=add(el('details',null,'card'),el('summary','Operator only: write organizer note')),form=el('form'),result=el('p',null,'metadata');
 const input=(label,tag,type)=>{const field=el(tag),wrapper=el('label',label);if(type)field.type=type;field.required=true;field.autocomplete='off';wrapper.append(field);form.append(wrapper);return field};
 const key=input('Operator key','input','password'),title=input('Note title','input','text'),note=input('Note text','textarea');
 const send=el('button','Write note to organizer');result.setAttribute('role','status');
 form.append(send,result);
 form.onsubmit=async e=>{
  e.preventDefault();const account=snapshot?.accounts.find(x=>x.id===current);
  if(!account){result.textContent='No verified account selected.';return;}
  if(!confirm('Write this note to the organizer for '+account.name+'?'))return;
  send.disabled=true;
  try{
   const response=await fetch('/api/admin/write-note',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key.value},body:JSON.stringify({account:account.id,title:title.value,text:note.value})});
   if(!response.ok)throw Error(response.status===429?'Organizer cooldown; wait '+(response.headers.get('Retry-After')??'60')+' seconds.':'Write not confirmed (HTTP '+response.status+').');
   note.value='';title.value='';result.textContent='Organizer confirmed the note.';await load();
  }catch(err){result.textContent=err.message;}finally{send.disabled=false;}
 };
 station.append(form);$('workspace').after(station);
}
function connectionState(title,description){
 const state=el('div',null,'connection-state');
 state.append(el('span',null,'connection-orbit'),el('p','ACCOUNT INTELLIGENCE','section-label'),el('h2',title),el('p',description));
 const path=el('div',null,'connection-path');
 for(const [name,detail] of [['Connect','Organizer account snapshot'],['Verify','Exact evidence and buying groups'],['Prioritize','Three accountable next moves']])path.append(add(el('div'),el('strong',name),el('span',detail)));
 state.append(path);$('workspace').replaceChildren(state);
}
const refresh=el('button','Refresh data','refresh-button');
refresh.type='button';
add($('status'),add(el('div',null,'status-copy'),el('span','Connecting','status-mode'),el('p','Waiting for the account snapshot','status-detail')),refresh);
async function load(){
 refresh.disabled=true;refresh.textContent='Refreshing…';
 const mode=$('status').querySelector('.status-mode'),detail=$('status').querySelector('.status-detail');
 try{
  const next=await adapter.load(),changed=JSON.stringify(snapshot?.accounts)!==JSON.stringify(next.accounts);
  snapshot=next;current=snapshot.accounts.some(x=>x.id===current)?current:snapshot.accounts[0]?.id;
  let heading,description,tone='caution';
  if(snapshot.mode==='fixture'){heading='Sample data';description='Illustrative accounts · no organizer connection';}
  else if(snapshot.mode==='discovery'){heading='Discovery snapshot';description='Private manual notes · not live MCP';}
  else if(snapshot.syncStatus==='stale'){heading='Stale organizer cache';description='Showing the last available snapshot';}
  else if(snapshot.syncStatus==='awaiting-paperwork'){heading='Contract evidence syncing';description='Organizer snapshot · verification in progress';}
  else if(snapshot.syncStatus==='awaiting-signals'){heading='Awaiting signal check';description='Organizer snapshot · first check pending';}
  else{heading='Live organizer snapshot';description='Signals checked '+sourceTime(snapshot.signalCheckedAt);tone='connected';}
  mode.textContent=heading;detail.textContent=description;$('status').dataset.state=tone;
  if(changed||!started)render();started=true;
 }catch(e){
  mode.textContent=started?'Snapshot refresh paused':'Awaiting organizer data';
  detail.textContent=started?'Showing the last available snapshot · '+e.message:'No verified account snapshot is available · '+e.message;
  $('status').dataset.state='caution';
  if(!started)connectionState('The next move starts with evidence.','The workspace is ready. Organizer data is not available yet, so no account values, recommendations, or live signals are shown. Refresh to check again.');
 }finally{refresh.disabled=false;refresh.textContent='Refresh data';$('workspace').setAttribute('aria-busy','false');}
}
refresh.onclick=load;load();
if(cfg.normalizedEndpoint)setInterval(()=>{if(document.visibilityState==='visible'&&!refresh.disabled)load()},30000);
