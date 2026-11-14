// Explainable fallback for unmapped accounts. Organizer records remain separate from CRM recommendations.
const arr=x=>Array.isArray(x)?x:[];
const low=x=>String(x??'').trim().toLowerCase();
const present=x=>typeof x==='string'&&x.trim();
const authorityThemes=[
 ['Potential payer / finance contact', /\b(cfo|financ(?:e|ial)|budget|controller|treasurer)\b/i, 'Ask for budget owner and signer; title alone does not confer approval.'],
 ['Potential blocker / reviewer', /\b(dpo|privacy|security|compliance|legal|risk|data protection)\b/i, 'Ask for sign-off criteria and determine whether this person can block the decision.'],
 ['Potential user / operations contact', /\b(operators?|users?|ops|operations?|supervisor|plant manager)\b/i, 'Validate workflow and success criteria; usage does not imply buying authority.'],
 ['Potential decision-route contact', /\b(procurement|purchasing|sponsor|program(?:me)? (?:lead|director))\b/i, 'Ask who controls the process and who can sign; neither is inferred from the title.']
];
export function inferredRoles(deal,stakeholders,evidence){
 const refs=new Set(arr(deal.evidence)), exact=key=>evidence.filter(e=>refs.has(e.id)&&low(e.speaker)===low(key));
 return arr(stakeholders).filter(p=>present(p.name)).flatMap(p=>{
  const sourced=exact(p.name); // No account-level title or name matching alone.
  if(!sourced.length)return [];
  return authorityThemes.filter(([,match])=>match.test(p.role??'')).map(([role,,rationale])=>({
   name:p.name,role,trust:p.relationship??'Unknown',rationale,evidenceIds:[...new Set([p.sourceId,...sourced.map(x=>x.id)].filter(Boolean))]
  }));
 });
}
export function dealWindow(d){
 if(!d?.deadline)return {state:'unknown'};
 const {text,moves_left,passed,met,soon}=d.deadline;
 // Treat flags as primary rather than projecting a stale game countdown into wall-clock time.
 const displayed=present(text)?text:undefined;
 if(passed===true)return {state:met===true?'met':'passed',timing:displayed};
 if(met===true)return {state:'met',timing:displayed};
 if(Number.isInteger(moves_left)&&moves_left>=0)return {state:'open',movesLeft:moves_left,timing:(moves_left===0?'Due this game move':moves_left+' game move(s) left')+(displayed?' · '+displayed:'')};
 if(soon===true)return {state:'soon',timing:'Flagged soon; exact game deadline unknown'+(displayed?' · '+displayed:'')};
 return {state:'unknown',timing:displayed};
}
function signalAction(s){
 const title=s.title??s.id;
 return {owner:'CSM (proposed)',deal:'Impact not yet linked to a specific deal',dueDate:'Triage on receipt (CRM target; no verified deadline)',
  urgency:70,action:'Triage '+title+' with the account owner; verify timing, ownership, scope and any exposed deal.',
  success:'A named owner confirms impact, next checkpoint and whether an open deal is affected.',
  origin:'CRM recommendation from organizer signal',evidenceIds:['signal:'+s.id]};
}
export function buildFallback({opportunities=[],evidence=[],stakeholders=[],signals=[],contract,accountRef,accountMove}){
 const all=arr(opportunities).filter(x=>x&&present(x.id)&&present(x.title)).map(d=>{
  const window=dealWindow(d), isLocked=d.locked===true||d.attemptsRemaining===0||['lost','locked','declined','agreed','won','closed'].includes(low(d.stage));
  return {...d,window,isLocked,roles:inferredRoles(d,stakeholders,evidence)};
 });
 const index=new Set(evidence.map(e=>e.id)), ids=d=>[d.id,...arr(d.evidence)].filter((x,i,a)=>index.has(x)&&a.indexOf(x)===i);
 const timed=all.filter(d=>present(d.window.timing)).map(d=>({
  title:d.title, dueDate:d.window.timing,impact:d.window.state==='passed'?'Organizer marks the window passed; verify if another window exists.':d.blocker?.status==='open'?d.blocker.text:'Review timing and dependency status.',evidenceIds:ids(d)
 }));
 const candidates=all.filter(d=>!d.isLocked&&d.window.state!=='passed').map(d=>{
  const hasBlocker=d.blocker?.status==='open'&&present(d.blocker.text);
  const associated=d.roles[0];
  const refLabels=ids(d);
  return {deal:d.title,owner:associated?'CSM (proposed), confirm with '+associated.name:'CSM (proposed); verify customer owner',
   dueDate:d.window.timing??'Before next account review (CRM target; no verified deadline)',
   urgency:d.window.state==='soon'?95:d.window.state==='open'?90:hasBlocker?60:40,
   move:Number.isInteger(accountMove)&&Number.isInteger(d.window.movesLeft)?accountMove+d.window.movesLeft:undefined,
   action:hasBlocker?'Resolve or assign the documented blocker: '+d.blocker.text:'Confirm stage, decision criteria and stakeholder ownership before advancing.',
   success:hasBlocker?'Named owner, an agreed clearance test and a follow-up checkpoint.':'Document a buyer, measurable acceptance criteria and a next checkpoint, or defer.',
   origin:'CRM recommendation from organizer opportunity',evidenceIds:refLabels};
 });
 const sawRoles=all.some(d=>d.roles.some(r=>r.role.includes('decision')||r.role.includes('payer')));
 const missing=all.flatMap(d=>{
  if(d.isLocked||d.window.state==='passed')return [];
  const questions=[];
  if(!d.roles.some(x=>x.role.includes('decision')||x.role.includes('payer')))
   questions.push({question:'Who pays and who signs for '+d.title+'?',why:'A named deal approver is not supported by the linked records.',ask:'CSM to request a buying-group introduction',evidenceIds:ids(d)});
  else questions.push({question:'Can the candidate contacts confirm who pays and signs for '+d.title+'?',why:'A job title and evidence contribution do not prove commercial authority.',ask:d.roles[0].name,evidenceIds:ids(d)});
  if(d.window.state==='unknown'||d.window.state==='soon')
   questions.push({question:'What is the exact next decision deadline for '+d.title+'?',why:'Planning around a guessed deadline can miss the real opportunity window.',ask:'CSM and customer decision-route contact',evidenceIds:ids(d)});
  return questions;
 });
 if(!Number.isFinite(contract?.amount)||!contract?.currency)missing.unshift({question:'What is the contracted annual book value and its currency?',why:'Pipeline amounts, invoicing and booked annual value are not interchangeable.',ask:'CSM to ask Finance or the contract owner',evidenceIds:accountRef?[accountRef]:[]});
 const actions=[...candidates,...signals.map(signalAction)].sort((a,b)=>(a.move??Infinity)-(b.move??Infinity)||(b.urgency??0)-(a.urgency??0)||a.action.localeCompare(b.action));
 if(actions.length<3&&!sawRoles)actions.push({deal:'Account commercial governance',owner:'CSM (proposed)',dueDate:'Before the next commercial decision (CRM target)',urgency:25,action:'Map decision maker, payer, operator and blocker; verify which roles differ across deals.',success:'Each commercial decision has a verified signer or an explicit unresolved gap.',evidenceIds:accountRef?[accountRef]:[]});
 if(actions.length<3&&contract?.evidenceIds?.length)actions.push({deal:'Existing contract',owner:'CSM + Finance (proposed)',dueDate:contract.termEnd?'Before sourced term end '+contract.termEnd:'Before next renewal review (CRM target)',urgency:20,action:'Confirm the renewal mechanism and reconcile annual contracted value with actual usage and invoices.',success:'Signed provision and adoption baseline linked to the next renewal check.',evidenceIds:contract.evidenceIds});
 return {
  recommendation:{decision:candidates.length?'Clear sourced blockers and verify buying authority before advancing open deals.':'Protect the current account and confirm the next viable decision window; do not reopen closed or expired game proposals.',
   confidence:'Provisional CRM recommendation; no unsourced authority or deadlines inferred',
   reason:'Ranked by open decision windows and documented blockers. Event recommendations are distinct from organizer outcomes.',
   unknown:missing[0]?.question??'Which verifiable customer outcome justifies the next decision?',
   evidence:[...new Set([...actions.flatMap(x=>arr(x.evidenceIds)),...all.flatMap(ids)])].slice(0,6),actions},
  risks:timed,gaps:missing,signalActions:signals.map(signalAction),deals:all
 };
}
