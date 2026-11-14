import {fixtureAdapter,discoveryAdapter,endpointAdapter,remaining,reviewAccount,proposalReadiness,prioritizedActions} from './data.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n};
const add=(parent,...children)=>{for(const child of children)parent.append(child);return parent};
const iconPaths={compass:'m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z',brief:'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h6M9 12h6M9 16h4',actions:'m13 2-9 12h7l-1 8 10-13h-7l1-7Z',people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',risk:'m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01',gap:'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0Z',evidence:'M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l1.7-1.7',signal:'M2 12h4l3-8 6 16 3-8h4',check:'m5 12 4 4L19 6',clock:'M12 8v5l3 2M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0Z',building:'M4 21V5h12v16M8 9h.01M12 9h.01M8 13h.01M12 13h.01M8 17h.01M12 17h.01M16 10h4v11M2 21h20'};
function icon(name,cls='ui-icon'){const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.setAttribute('viewBox','0 0 24 24');n.setAttribute('aria-hidden','true');n.setAttribute('class',cls);const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',iconPaths[name]??iconPaths.compass);n.append(p);return n;}
const sectionIcons={'Account brief':'brief','Top actions':'actions','Deals & buying groups':'people','Timed risks':'risk','Missing facts':'gap','Signals and notes':'signal','Evidence ledger':'evidence','Account contacts':'people','Account activity':'clock','Decision quality checks':'check'};
const card=(name,full=false)=>add(el('article',null,'card'+(full?' full':'')),add(el('h3'),add(el('span',null,'section-icon'),icon(sectionIcons[name])),el('span',name)));
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
 const a=add(el('a',null,'jump'),icon(({deals:'people',actions:'actions',risks:'risk',gaps:'gap',evidence:'evidence'})[id],'route-icon'),el('span',label));a.dataset.section=id;a.setAttribute('aria-label',label);a.href='#'+blockId(id);const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 16 16');arrow.setAttribute('class','jump-arrow');arrow.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M3 13 13 3M4 3h9v9');arrow.append(path);a.append(arrow);return a;
}
function sourceTime(v){
 if(!v)return 'not recorded';
 const parsed=new Date(v);
 return Number.isNaN(parsed.valueOf())?String(v):parsed.toISOString().replace('T',' ').slice(0,16)+' UTC';
}
function validSources(account,ids){const available=new Set((account.evidence??[]).map(x=>x.id));return [...new Set(ids??[])].filter(id=>available.has(id));}
function calendarDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function actionTiming(account,action){
 const timing=action.timing??{},raw=timing.text??action.dueDate??(Number.isInteger(account.move)&&Number.isInteger(action.move)?remaining(account.move,action.move):'No deadline recorded');
 const verified=timing.kind==='sourced-date'&&calendarDate(timing.date)&&validSources(account,timing.evidenceIds).length;
 return {text:verified?timing.date:raw,label:verified?'Sourced deadline':timing.kind==='proposed'?'Proposed target':'Timing recorded',verified:Boolean(verified),verifyWith:timing.verifyWith??action.owner??'Unassigned; manager to name an owner'};
}
function actionCard(account,action,index){
 const timing=actionTiming(account,action),sources=validSources(account,action.evidenceIds),sourceSet=new Set(sources);
 const risk=(account.risks??[]).find(x=>(x.evidenceIds??[]).some(id=>sourceSet.has(id)));
 const trigger=typeof action.riskTrigger==='string'?action.riskTrigger:action.riskTrigger?.text??risk?.title;
 const body=add(el('div',null,'action-body'),el('strong',action.action??'Action pending'),add(el('div',null,'action-meta'),metadata('Owner',action.owner),metadata(timing.label,timing.text)),metadata('Deal',action.deal??'Not assigned to a specific deal'),metadata('Done when',action.success));
 body.append(metadata('Risk trigger',trigger??'Not linked; validate with the action owner'));
 if(!timing.verified){const verify=add(el('div',null,'timing-check'),el('span','Calendar deadline not verified','timing-label'),el('p','Confirm the exact date with '+timing.verifyWith+'. Relative timing is not a calendar commitment.'));body.append(verify);}
 const checkpoint=action.proposedCheckpoint;
 if(calendarDate(checkpoint?.date)&&checkpoint?.purpose&&checkpoint?.basis)body.append(add(el('div',null,'proposed-checkpoint'),el('span','Proposed CRM checkpoint · '+checkpoint.date,'timing-label'),el('p',checkpoint.purpose),metadata('Basis',checkpoint.basis),el('p','Planning proposal, not a customer-agreed deadline.','metadata'),links(validSources(account,checkpoint.evidenceIds))));
 if(action.origin)body.append(metadata('Basis',action.origin));
 body.append(sources.length?add(el('div',null,'action-provenance'),el('span','Action sources','meta-label'),links(sources)):el('p','No exact source is attached to this action. Validate it before committing.','source-missing'));
 return add(el('li',null,'action-item'),el('span',String(index+1).padStart(2,'0'),'action-number'),body);
}
function discoveryProof(account){
 const action=prioritizedActions(account)[0];
 if(!action?.action)return null;
 const scoped=new Set(validSources(account,action.evidenceIds));
 const evidence=(action.evidenceIds??[]).map(id=>(account.evidence??[]).find(x=>x.id===id)).filter((x,i,all)=>x&&scoped.has(x.id)&&typeof x.claim==='string'&&x.claim.trim()&&all.findIndex(y=>y?.id===x.id)===i).slice(0,2);
 if(!evidence.length)return null;
 const proof=el('section',null,'discovery-proof');proof.setAttribute('aria-labelledby','discovery-proof-title');
 const heading=el('h3','What changed the plan');heading.id='discovery-proof-title';
 proof.append(add(el('div',null,'proof-heading'),heading,el('p','Current evidence → first action · not a change history')));
 const sources=el('div',null,'proof-sources');
 for(const source of evidence){
  const sourceMarkedVerified=/^verified\b/i.test(String(source.confidence??''));
  const item=add(el('div',null,'proof-source'),el('span',sourceMarkedVerified?'Source marked verified':'Source reports','proof-label'),el('p',source.claim,'proof-claim'),add(el('div',null,'proof-citation'),links([source.id]),el('span',source.confidence?'Source label: '+source.confidence:'Verification not recorded','proof-source-state')));
  item.dataset.verification=sourceMarkedVerified?'source-marked-verified':'reported';sources.append(item);
 }
 const next=add(el('div',null,'proof-next'),el('span','Next action','proof-label'),el('p',action.action,'proof-action'),metadata('Owner',action.decisionOwner??action.owner??'Not assigned'),action.deal?metadata('Deal',action.deal):'');
 const result=action.verificationResult,verificationSources=validSources(account,result?.evidenceIds).filter(id=>scoped.has(id));
 next.append(metadata('Verification result',result?.text&&verificationSources.length?result.text:'Not recorded; the action is not marked complete.'));
 if(result?.text&&verificationSources.length)next.append(links(verificationSources));
 else if(action.success)next.append(metadata('Confirm by',action.success));
 proof.append(add(el('div',null,'proof-grid'),sources,next));return proof;
}
function freshnessPanel(account){
 const stale=snapshot.syncStatus==='stale',signals=account.signals?.length??0,notes=account.notes?.length??0,hasEventCoverage=Array.isArray(account.signals)&&Array.isArray(account.notes);
 const n=el('aside',null,'snapshot-context'+(stale?' is-stale':''));n.setAttribute('aria-label','Snapshot provenance');
 const title=stale?'Saved account brief · refresh not confirmed':snapshot.mode==='live'?'Account snapshot provenance':snapshot.mode==='fixture'?'Illustrative snapshot':'Manual snapshot';
 n.append(add(el('div',null,'snapshot-heading'),icon(stale?'clock':'check'),el('strong',title)),el('p','Account source: '+sourceTime(snapshot.sourceAt)+' · Signal check: '+sourceTime(snapshot.signalCheckedAt)),el('p',hasEventCoverage?signals+' signal'+(signals===1?'':'s')+' · '+notes+' note'+(notes===1?'':'s')+' returned for this account.'+(signals===0&&notes===0?' This is an empty response, not evidence that there are no account risks.':''):'Event coverage is not included in this snapshot. No zero-event conclusion is implied.'));
 const health=snapshot.syncHealth??{},paperwork=health.paperworkCheckedAt?.[account.id];
 if(health.accountsCheckedAt||paperwork)n.append(el('p','Accounts checked: '+sourceTime(health.accountsCheckedAt)+' · Paperwork checked: '+sourceTime(paperwork),'snapshot-health'));
 if(health.lastSignalFailureAt)n.append(el('p','Signal refresh last failed: '+sourceTime(health.lastSignalFailureAt)+(health.signalRetryAt?' · Retry available after '+sourceTime(health.signalRetryAt):''),'snapshot-health'));
 if(stale)n.append(el('p','Use the sourced account facts below; verify changing deadlines and event status before acting. Refresh data to retry.','snapshot-warning'));
 return n;
}
function render(){
 $('accounts').replaceChildren();
 for(const a of snapshot.accounts){let b=add(el('button'),icon('building','account-icon'),el('span',a.name),el('span',String(a.deals?.length??0)+((a.deals?.length??0)===1?' deal':' deals'),'account-count'));b.dataset.accountId=a.id;b.setAttribute('aria-pressed',a.id===current);b.addEventListener('click',()=>{current=a.id;render();[...$('accounts').children].find(n=>n.dataset.accountId===a.id)?.focus()});$('accounts').append(b)}
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
 overview.append(metrics);out.append(overview);const proof=discoveryProof(a);if(proof)out.append(proof);out.append(freshnessPanel(a),routes);
 const r=a.recommendation, grid=el('div',null,'grid'), plan=card('Top actions',true);plan.id=blockId('actions');
 if(r){plan.append(add(el('div',null,'decision-context'),metadata('Confidence',r.confidence),el('p',r.reason??'','decision-reason')),metadata('Biggest unknown',r.unknown),links(r.evidence));list(plan,prioritizedActions(a).slice(0,3),(x,i)=>actionCard(a,x,i), 'No actions recorded.')}
 else empty(plan,'Make no recommendation until there is evidence.');
 const pendingTiming=prioritizedActions(a).slice(0,3).filter(x=>!actionTiming(a,x).verified);
 if(pendingTiming.length)plan.insertBefore(el('p',pendingTiming.length+' of '+prioritizedActions(a).slice(0,3).length+' ranked actions need an exact calendar deadline. The named action owner must verify it before a customer commitment.','timing-summary'),plan.querySelector('ol'));
 const quality=card('Decision quality checks',true);
 list(quality,reviewAccount(a),x=>el('li',x.message), 'No gaps flagged by the local checks. This is not an organizer score.');
 const deals=card('Deals & buying groups',true),stake=card('Account contacts'),evidence=card('Evidence ledger',true),timeline=card('Account activity');
 deals.id=blockId('deals');evidence.id=blockId('evidence');
 list(deals,a.deals,x=>{
  const n=add(el('li',null,'deal-item'),add(el('div',null,'deal-summary'),el('strong',x.name??'Deal','deal-name'),metadata('Stage',x.stage),metadata('Value',money(x.value,x.currency)),metadata('Tries left',x.attemptsRemaining)),add(el('div',null,'deal-facts'),metadata('Deadline',x.deadlineText??remaining(a.move,x.deadlineMove)),metadata('Blocker',x.blocker),metadata('Authority',x.approver)),links(x.evidence));
  n.dataset.stage=String(x.stage??'unknown').toLowerCase();
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
     readout.dataset.readiness=next.state;readout.textContent=next.state==='ready'?'Checklist satisfied. Nothing was sent.':'Not ready. Missing: '+(next.missing.join(', ')||'none')+'; extra: '+(next.irrelevant.join(', ')||'none')+'.';
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
 const timingGaps=pendingTiming.filter((x,i,all)=>all.findIndex(y=>(y.deal??y.action)===(x.deal??x.action))===i).map(x=>({question:'What is the exact calendar deadline for '+(x.deal??x.action)+'?',why:'Recorded timing: '+actionTiming(a,x).text+'. A relative window cannot be treated as a verified date.',ask:actionTiming(a,x).verifyWith,success:'Owner records an exact date, confirms it with the decision-route contact and attaches the source. Until then, keep the deadline unverified.',evidenceIds:validSources(a,x.evidenceIds)}));
 list(gaps,[...timingGaps,...(a.gaps??[])],x=>add(el('li'),el('strong',x.question),metadata('Why it matters',x.why),metadata('Confirm with',x.ask??'Unassigned; manager to name an owner'),metadata('Closure test',x.success??'Record the answer and its exact source before treating this gap as resolved'),links(x.evidenceIds)),'No explicit discovery gaps recorded.');
 list(notes,[...(a.signals??[]),...(a.notes??[])],x=>add(el('li'),el('strong',x.title??x.kind??'Signal'),el('p',x.text),metadata('Reported',x.at),x.arrivedAt?metadata('Received',x.arrivedAt):'',links(x.evidenceIds)),(snapshot.syncStatus==='stale'?'The last saved response contains no signals or notes. Refresh is not confirmed; event coverage may be incomplete.':'The current response contains no signals or notes for this account. This does not clear the sourced risks or missing facts above.'));
 out.append(add(grid,plan,deals,risks,gaps,notes,evidence,stake,timeline,quality));
 out.querySelectorAll('.grid>.card').forEach((n,i)=>n.style.setProperty('--reveal-delay',Math.min(i,5)*45+'ms'));
 document.title=a.name+' · Renewal Compass';
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
  const next=await adapter.load(),changed=JSON.stringify(snapshot)!==JSON.stringify(next);
  snapshot=next;current=snapshot.accounts.some(x=>x.id===current)?current:snapshot.accounts[0]?.id;
  let heading,description,tone='caution';
  if(snapshot.mode==='fixture'){heading='Sample data';description='Illustrative accounts · no organizer connection';}
  else if(snapshot.mode==='discovery'){heading='Discovery snapshot';description='Private manual notes · not live MCP';}
  else if(snapshot.syncStatus==='stale'){heading='Saved snapshot · refresh needed';description='Account facts remain available · signals last checked '+sourceTime(snapshot.signalCheckedAt);}
  else if(snapshot.syncStatus==='awaiting-paperwork'){heading='Contract evidence syncing';description='Organizer snapshot · verification in progress';}
  else if(snapshot.syncStatus==='awaiting-signals'){heading='Awaiting signal check';description='Organizer snapshot · first check pending';}
  else{heading='Organizer snapshot available';description='Signals checked '+sourceTime(snapshot.signalCheckedAt);tone='connected';}
  mode.textContent=heading;detail.textContent=description;$('status').dataset.state=tone;
  if(changed||!started)render();started=true;
 }catch(e){
  mode.textContent=started?'Snapshot refresh paused':'Awaiting organizer data';
  detail.textContent=started?'Showing the last available snapshot · '+e.message:'No verified account snapshot is available · '+e.message;
  $('status').dataset.state='caution';
  if(started){snapshot={...snapshot,syncStatus:'stale'};render();}
  if(!started)connectionState('The next move starts with evidence.','The workspace is ready. Organizer data is not available yet, so no account values, recommendations, or live signals are shown. Refresh to check again.');
 }finally{refresh.disabled=false;refresh.textContent='Refresh data';$('workspace').setAttribute('aria-busy','false');}
}
refresh.onclick=load;load();
if(cfg.normalizedEndpoint)setInterval(()=>{if(document.visibilityState==='visible'&&!refresh.disabled)load()},30000);
