// Normalized UI contract. Source adapters must supply load() returning this shape.
export const fixture={mode:'fixture',accounts:[
 {id:'north',name:'Northstar Facilities',context:'Synthetic example only. Night-shift adoption is incomplete even though the day rollout appears healthy.',move:4,
  stakeholders:[
   {name:'Morgan Chen',role:'Operations lead',authority:'Owns pilot acceptance; contract authority not recorded',trust:'Warm'},
   {name:'Taylor Fox',role:'Finance partner',authority:'Reviews renewal evidence; final signer unknown',trust:'Neutral'}
  ],
  evidence:[
   {id:'sample:coverage',sourceId:'sample:coverage',title:'Coverage export',source:'Synthetic telemetry',confidence:'Sample record',claim:'Night-shift coverage is 58%, below the pilot target of 80%.'},
   {id:'sample:handovers',sourceId:'sample:handovers',title:'Shift handover',source:'Synthetic interview',confidence:'Reported in sample',claim:'Morgan reports operators fall back to a manual route when a pilot exception is raised.'},
   {id:'sample:finance',sourceId:'sample:finance',title:'Finance acceptance',source:'Synthetic interview',confidence:'Reported in sample',claim:'Taylor requires a comparable two-week operating window before crediting savings.'},
   {id:'sample:profile',sourceId:'sample:profile',title:'Sample profile',source:'Synthetic annual contract record',confidence:'Sample record',claim:'Annual contract value: USD 120,000. The term-end date is not supplied.'}
  ],
  bookValue:{amount:120000,currency:'USD',evidenceIds:['sample:profile'],provenance:{directEvidenceIds:['sample:profile']}},
  deals:[{name:'Core renewal',value:120000,currency:'USD',stage:'Qualified',deadlineMove:9,blocker:'No accepted night-shift coverage plan',approver:'Morgan for operating plan; contract signer unknown',attemptsRemaining:2,evidence:['sample:coverage','sample:handovers','sample:finance']}],
  recommendation:{decision:'Protect the core renewal; defer expansion.',confidence:'Sample only',reason:'Manual fallback, not daytime performance, is the operating blocker.',evidence:['sample:coverage','sample:handovers'],unknown:'Who signs the renewal, and what evidence will Finance accept?',
   actions:[
    {owner:'CSM + Morgan',deal:'Core renewal',move:5,action:'Confirm the night-shift exception path and name an owner.',success:'Morgan accepts a written exception owner and an 80% pilot target.',evidenceIds:['sample:coverage','sample:handovers'],decisionConstraint:{text:'Do not expand coverage until the exception route is owned.',evidenceIds:['sample:handovers']}},
    {owner:'Operations',deal:'Core renewal',move:6,action:'Run the corrected night-shift pilot.',success:'An operator completes one shift without falling back to the manual route and records exceptions.',evidenceIds:['sample:handovers','sample:coverage']},
    {owner:'CSM + Taylor',deal:'Core renewal',move:7,action:'Agree Finance’s renewal evidence and confirm signing authority.',success:'Taylor confirms the comparison window and records who can sign.',evidenceIds:['sample:finance']}
   ]
  },
  risks:[{title:'Night-shift adoption below target',impact:'Savings may not survive normal operations.',dueDate:'Before expansion; exact calendar date unverified',evidenceIds:['sample:coverage','sample:handovers']}],
  gaps:[{question:'Who can sign the renewal?',why:'An operating approver is not a contract signer.',ask:'Taylor Fox',success:'Named signing authority with an exact source.',evidenceIds:['sample:finance']}],
  timeline:[{move:2,text:'Sample telemetry recorded.',evidence:['sample:coverage']}],signals:[],notes:[]},
 {id:'harbor',name:'Harbor Manufacturing',context:'Synthetic sparse account. An operations contact is recorded but there is not enough evidence to recommend a commercial action.',move:1,
  stakeholders:[{name:'Jamie Soto',role:'Plant manager',authority:'Operational stakeholder; buying authority unknown',trust:'Neutral'}],
  evidence:[],deals:[],bookValue:{amount:null,evidenceIds:[]},recommendation:null,
  gaps:[{question:'What part of the operation is still manual?',why:'Do not infer savings or scope without a measured baseline.',ask:'Jamie Soto',success:'A measured operating baseline and its source are recorded.',evidenceIds:[]}],
  timeline:[],signals:[],notes:[]}
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
