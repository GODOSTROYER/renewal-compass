// Normalized UI contract. Source adapters must supply load() returning this shape.
export const fixture={mode:'fixture',accounts:[
{id:'north',name:'Northstar Facilities',context:'Illustrative account, not Questathon data.',move:4,
stakeholders:[{name:'Morgan Chen',role:'Operations lead',authority:'Operational champion; approver unknown',trust:'Warm'},{name:'Taylor Fox',role:'Finance partner',authority:'Budget owner (unconfirmed)',trust:'Neutral'}],
evidence:[{id:'E-01',sourceId:'sample-coverage-export',title:'Coverage export',source:'Sample data room / telemetry',confidence:'High',claim:'Night-shift completion is below target.',move:2},{id:'E-02',sourceId:'sample-ops-interview',title:'Operations interview',source:'Sample journal / Morgan Chen',confidence:'Medium',claim:'Day-shift rollout is healthy; night shift still falls back to manual coverage.',move:3}],
deals:[{name:'Core renewal',value:120000,currency:'USD',stage:'Qualified',deadlineMove:8,blocker:'No accepted night-shift coverage plan',approver:'Morgan Chen for operating plan; signer unconfirmed',attemptsRemaining:2,proposal:{recipient:'Morgan Chen',kind:'Operating plan',requiredSourceIds:['sample-coverage-export','sample-ops-interview']},evidence:['E-01','E-02']}],
recommendation:{decision:'Protect the core renewal; defer expansion.',confidence:'Medium',reason:'Operational evidence shows a defined adoption gap, but signer and budget remain unconfirmed.',evidence:['E-01','E-02'],unknown:'Who signs and what evidence will finance accept?',actions:[{owner:'CSM',move:5,action:'Ask Morgan for the signer and confirm acceptance criteria.',success:'Named signer and a measurable night-shift coverage target.'},{owner:'Operations',move:7,action:'Review a pilot recovery plan with Morgan.',success:'Morgan approves scope and measurement before the renewal gate.'}]},
timeline:[{move:2,text:'Coverage export collected.',evidence:['E-01']},{move:3,text:'Night-shift fallback corroborated by Operations.',evidence:['E-02']}]},
{id:'harbor',name:'Harbor Manufacturing',context:'Illustrative account, not Questathon data.',move:1,stakeholders:[{name:'Jamie Soto',role:'Plant manager',authority:'Operational stakeholder; buying authority unknown',trust:'Neutral'}],evidence:[],deals:[],recommendation:{decision:'Continue discovery before making an offer.',confidence:'Low',reason:'No documentary evidence or confirmed buyer.',unknown:'What operational outcome would justify renewal?',actions:[{owner:'CSM',move:2,action:'Ask the plant manager what is still being done manually and who signs off.',success:'Named workflow pain and a decision-maker introduction.'}]},timeline:[]}
]};
export const fixtureAdapter={async load(){return structuredClone(fixture)}};
export function endpointAdapter(url,{fetcher=fetch}={}){
 return {async load(){const response=await fetcher(url,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Connector returned HTTP '+response.status);const data=await response.json();return validateSnapshot(data)}};
}
export function validateSnapshot(data){
 if(!data||!['fixture','discovery','live'].includes(data.mode)||!Array.isArray(data.accounts))throw Error('Expected normalized accounts and explicit source mode');
 const ids=new Set();
 for(const a of data.accounts){
  if(!a||typeof a.name!=='string'||typeof a.id!=='string'||ids.has(a.id))throw Error('Invalid or duplicate account');
  ids.add(a.id);
  for(const key of ['stakeholders','evidence','deals','timeline'])if(a[key]!=null&&!Array.isArray(a[key]))throw Error('Invalid '+key);
 }
 return data;
}
export function remaining(current,due){
 if(!Number.isInteger(current)||!Number.isInteger(due))return 'Deadline unknown';
 const n=due-current;return n<0?'Overdue by '+(-n)+' move(s)':n===0?'Due this move':n+' move(s) left';
}

// Decision-quality checks, explicitly not a prediction of organizer scoring.
export function reviewAccount(account){
 const findings=[], warn=(type,message)=>findings.push({type,message});
 const evidence=new Set((account.evidence??[]).map(x=>x.id));
 const rec=account.recommendation;
 if(!rec||!rec.decision)warn('decision','No recommendation recorded.');
 else if(!rec.evidence?.some(id=>evidence.has(id)))warn('evidence','Recommendation has no linked evidence in this account.');
 const owners=[rec,...(rec?.actions??[]),...(account.deals??[]),...(account.timeline??[])].filter(Boolean);
 for(const x of owners)for(const id of x.evidence??[])if(!evidence.has(id))warn('reference','Missing evidence reference: '+id);
 for(const a of rec?.actions??[]){
  if(!a.owner||!a.success)warn('action','A next action needs both an owner and an acceptance criterion.');
  if(Number.isInteger(a.move)&&Number.isInteger(account.move)&&a.move<account.move)warn('timing','A planned action is overdue.');
 }
 for(const d of account.deals??[]){
  if(Number.isInteger(d.deadlineMove)&&Number.isInteger(account.move)&&d.deadlineMove<account.move&&!['agreed','closed'].includes(String(d.stage).toLowerCase()))warn('timing','Deal deadline passed: '+d.name);
 }
 if((account.evidence??[]).some(x=>x.conflictsWith?.some(id=>evidence.has(id))))warn('conflict','Sources conflict. Resolve or explicitly carry the disagreement into the plan.');
 return findings;
}

export const discoveryAdapter={async load(){const {discovery}=await import('./discovery.local.mjs');return structuredClone(validateSnapshot(discovery))}};

export function proposalReadiness(deal,evidence,selected=[]){
 const stage=String(deal.stage??'').toLowerCase();
 if(['agreed','closed'].includes(stage))return {state:'agreed',missing:[],irrelevant:[]};
 if(deal.attemptsRemaining===0||stage==='locked')return {state:'locked',missing:[],irrelevant:[]};
 if(!deal.proposal?.recipient||!deal.proposal?.kind||!deal.proposal?.requiredSourceIds?.length)
  return {state:'discovery',missing:[],irrelevant:[]};
 const available=new Set(evidence.map(x=>x.sourceId).filter(Boolean)),required=new Set(deal.proposal.requiredSourceIds),chosen=new Set(selected);
 const missing=[...required].filter(id=>!available.has(id)||!chosen.has(id));
 const irrelevant=[...chosen].filter(id=>!required.has(id)||!available.has(id));
 return {state:missing.length||irrelevant.length||chosen.size>3?'review':'ready',missing,irrelevant};
}
export function prioritizedActions(account){
 return [...(account.recommendation?.actions??[])].sort((a,b)=>(a.move??Infinity)-(b.move??Infinity)||(b.urgency??0)-(a.urgency??0));
}
export function normalizedAdapter(readRaw,mapRaw){
 return {async load(){const data=await mapRaw(await readRaw());if(data?.mode!=='live')throw Error('Official adapter must return a verified live snapshot');return validateSnapshot(data)}};
}
