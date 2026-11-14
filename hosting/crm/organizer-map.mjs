import {validateSnapshot} from './data.mjs';
import {buildFallback,dealWindow} from './reasoning.mjs';
export function unwrap(wrapper){
 let value=wrapper?.value??wrapper;
 if(value?.structuredContent)return value.structuredContent;
 if(Array.isArray(value?.content)){
  const item=value.content.find(b=>b.type==='text');
  if(item)try{return JSON.parse(item.text)}catch{return null}
 }
 return value;
}
const list=x=>Array.isArray(x)?x:[];
const unique=(rows,key)=>{const seen=new Set();return list(rows).filter(x=>x&&typeof x[key]==='string'&&!seen.has(x[key])&&seen.add(x[key]));};
const sigKey=x=>'signal:'+x.id;
const recordKey=(account,path)=>'paperwork:'+account+'/'+path;
const rankSignals=(signals,policy)=>signals.flatMap(s=>{
 const rule=policy?.[s.id];if(!rule)return [];
 return [{...rule,origin:'CRM recommendation triggered by official signal',evidenceIds:[sigKey(s)]}];
});
function disruptionRisk(s,policy){
 const x=policy?.[s.id];
 return {title:s.title,impact:s.summary,dueDate:x?.dueDate,evidenceIds:[sigKey(s)]};
}
export function normalizeOrganizer(results,plans={}){
 const raw=unwrap(results.get_my_accounts);
 if(raw?.format!=='account-quest-v2-export/1'||!Array.isArray(raw.accounts))return null;
 const seenSignals=new Set(), signalWrapper=unwrap(results.get_signals);
 const signals=list(signalWrapper?.signals).filter(x=>typeof x.id==='string'&&!seenSignals.has(x.account+'|'+x.id)&&seenSignals.add(x.account+'|'+x.id));
 return validateSnapshot({mode:'live',sourceAt:raw.exported_at,signalCheckedAt:results.get_signals?.at??null,accounts:raw.accounts.map(a=>{
  const accountRef='account:'+a.id;
  const candidate=plans[a.id];
  const privatePlan=candidate?.accountName&&candidate.accountName!==a.name?{}:candidate??{};
  const facts=unique(a.facts,'id'), won=unique(a.offers,'id').filter(x=>x.status==='won'), agreed=unique(a.opportunities,'id').filter(x=>x.stage==='agreed');
  const evidence=facts.map(x=>({id:x.id,sourceId:x.id,title:x.id,source:'Organizer game journal / '+x.said_by,speaker:x.said_by,confidence:x.status==='verified'?'Verified by '+(x.verified_by??'game journal'):x.status,claim:x.text,move:x.learned_at_minute}));
  evidence.push({id:accountRef,title:a.name,source:'Organizer account handover',confidence:'Official handover; claims not verified',claim:a.official_story});
  const people=list(a.stakeholders).map(p=>({...p,sourceId:'stakeholder:'+p.id}));
  for(const p of people)evidence.push({id:p.sourceId,title:p.name,source:'Organizer stakeholder export',confidence:'Listed title and relationship, not commercial authority',claim:[p.role,p.relationship].filter(Boolean).join(' · ')});
  for(const x of [...agreed,...won])evidence.push({id:x.id,sourceId:x.id,title:x.title,source:'Organizer export / '+(x.stage?'opportunities':'offers'),confidence:'Official game result',claim:(x.stage??x.status)+' · '+(x.worth_up_to??x.value)});
  for(const x of list(a.opportunities).filter(d=>d.stage!=='agreed')){
   evidence.push({id:x.id,title:x.title,source:'Organizer opportunity export',confidence:'Organizer stage and blocker record',claim:[x.stage,x.blocker?.text].filter(Boolean).join(' · ')});
  }
  const paperwork=unwrap(results['get_all_paperwork:'+a.id]);
  const paperworkEntry=results['get_all_paperwork:'+a.id];
  const records=paperwork?.account===a.id&&(!paperworkEntry?.accountName||paperworkEntry.accountName===a.name)?unique(paperwork.records,'path'):[];
  const profile=records.find(x=>x.kind==='profile')?.data, invoices=records.find(x=>x.kind==='invoices')?.data;
  const annual=Number.isFinite(profile?.renewal?.annual_value)?profile.renewal.annual_value:null;
  const validCurrency=x=>typeof x==='string'&&/^[A-Z]{3}$/.test(x);
  const bookCurrency=validCurrency(profile?.currency)?profile.currency:undefined;
  const invoiceConflict=Number.isFinite(annual)&&Number.isFinite(invoices?.first_year_total)&&
   (annual!==invoices.first_year_total||bookCurrency!==invoices.currency);
  const bookValue={amount:annual,currency:bookCurrency,termEnd:profile?.renewal?.term_ends,evidenceIds:records.filter(x=>['profile','contract','invoices'].includes(x.kind)).map(x=>recordKey(a.id,x.path))};
  const reconciliation=invoiceConflict?{question:'Why do annual contract and first-year invoice records differ?',why:'Different bases, credits or currencies may explain the difference. Do not treat invoice amount as contracted annual value.',ask:'Finance and the contract owner',evidenceIds:bookValue.evidenceIds}:null;
  for(const x of records){if(typeof x.path!=='string')continue;
   const claim=x.kind==='profile'&&annual!==null?'Contracted annual value: '+annual+' '+bookCurrency+' · term ends '+profile.renewal.term_ends
    :x.kind==='invoices'&&Number.isFinite(invoices?.first_year_total)?'First-year invoice total: '+invoices.first_year_total+' '+invoices.currency
    :x.kind==='contract'?String(x.text??'').slice(0,1000):undefined;
   evidence.push({id:recordKey(a.id,x.path),sourceId:recordKey(a.id,x.path),title:x.path,source:'Organizer paperwork / '+x.kind,confidence:'Organizer record',claim});
  }
  for(const x of list(raw.files).filter(x=>x.account===a.id)){if(evidence.some(y=>y.id===x.id))continue;evidence.push({id:x.id,sourceId:x.id,title:x.title,source:'Organizer game file index / '+x.path,confidence:'Indexed file; contents not retrieved'});}
  const relevant=signals.filter(x=>x.account===a.id);
  for(const sig of relevant){
   evidence.push({id:sigKey(sig),sourceId:sigKey(sig),title:sig.title,source:'Organizer signal / '+sig.id,confidence:'Official event; implications are CRM recommendations',claim:sig.summary});
   for(const rec of list(sig.records)){if(typeof rec.path!=='string')continue;const id=sigKey(sig)+':'+rec.path;
    evidence.push({id,sourceId:id,title:rec.path,source:'Organizer signal attachment / '+rec.kind,confidence:'Official event attachment',claim:rec.kind==='email'?String(rec.text??'').slice(0,1000):rec.note??'Associated organizer record'});
   }
  }
  const submittedNotes=list(results.confirmed_notes??(results.write_note?[results.write_note]:[]));
  const notes=[...list(privatePlan.notes),...submittedNotes.filter(x=>x.localNote?.account===a.id&&unwrap(x)).map(x=>({
   id:'note:'+x.at,title:x.localNote.title??'Organizer note',text:x.localNote.text,at:x.at,kind:'Confirmed write to organizer'
  }))];
  const accountMove=Number.isInteger(a.minute)?a.minute:undefined;
  const planOpps=list(a.opportunities).map(d=>({...d,...(privatePlan.deals?.[d.id]??{})}));
  const fallback=buildFallback({opportunities:planOpps,evidence,stakeholders:people,signals:relevant.filter(x=>!privatePlan.signalPolicy?.[x.id]),contract:bookValue,accountRef,accountMove});
  const localEvidenceIds=new Set(evidence.map(x=>x.id));
  const sourcedAction=x=>({...x,evidenceIds:[...new Set(list(x.evidenceIds).filter(id=>typeof id==='string'&&localEvidenceIds.has(id)))]});
  const recommendation=privatePlan.recommendation?{
   ...privatePlan.recommendation,actions:[...rankSignals(relevant,privatePlan.signalPolicy),...fallback.signalActions,...list(privatePlan.recommendation.actions)].filter(x=>x&&typeof x==='object').map(sourcedAction)
  }:fallback.recommendation;
  const autoDealMap=new Map(fallback.deals.map(d=>[d.id,d]));
  const context=[a.official_story&&'Official handover, not asserted truth: '+a.official_story,privatePlan.context].filter(Boolean).join(' ');
  const components=unique([...agreed,...won],'id');
  const componentIds=components.map(x=>x.id);
  const scoredValues=components.map(x=>x.worth_up_to??x.value);
  const currency=privatePlan.currency;
  const byId=new Map(list(a.stakeholders).map(x=>[x.id,x]));
  const deals=[...list(a.opportunities).map(d=>({
   id:d.id,name:d.title,stage:d.stage,value:d.worth_up_to,currency,
   blocker:d.blocker?.status==='cleared'?undefined:d.blocker?.text,deadlineText:dealWindow(d).timing,deadlineMove:accountMove!=null&&Number.isInteger(d.deadline?.moves_left)&&d.deadline?.passed!==true&&d.deadline?.met!==true?accountMove+d.deadline.moves_left:undefined,evidence:list(d.evidence),
   ...(privatePlan.deals?.[d.id]??{}),
   roles:privatePlan.deals?.[d.id]?.roles?list(privatePlan.deals[d.id].roles).map(x=>({...x,name:byId.get(x.personId)?.name??x.name,trust:byId.get(x.personId)?.relationship??x.trust,evidenceIds:list(x.evidenceIds).filter(id=>evidence.some(ev=>ev.id===id))})):autoDealMap.get(d.id)?.roles})),
   ...list(a.offers).map(d=>({id:d.id,name:d.title,stage:d.status==='won'?'Agreed':d.status,value:d.value,currency,approver:d.pitch_to,evidence:d.status==='won'?[d.id]:[]}))];
  return {id:a.id,name:a.name,context,move:accountMove,stakeholders:list(a.stakeholders).map(x=>({name:x.name,role:x.role,trust:x.relationship,authority:privatePlan.authority?.[x.id]})),deals,evidence,
   bookValue,
   gameValue:{amount:scoredValues.every(Number.isFinite)?scoredValues.reduce((sum,x)=>sum+x,0):null,currency,evidenceIds:componentIds},
   recommendation,notes,signals:relevant.map(x=>({id:x.id,title:x.title,text:x.summary,at:x.dated,arrivedAt:x.set_off_at,evidenceIds:[sigKey(x),...list(x.records).filter(r=>typeof r.path==='string').map(r=>sigKey(x)+':'+r.path)]})),
   risks:[...relevant.map(x=>disruptionRisk(x,privatePlan.signalPolicy)),...fallback.risks,...list(a.deadlines).map(x=>({title:x.text,impact:x.passed?'Window passed':'Window not marked passed'}))],
   timeline:facts.map(x=>({move:x.learned_at_minute,text:x.text,evidence:[x.id]})),
   gaps:[...(reconciliation?[reconciliation]:[]),...(privatePlan.gaps??fallback.gaps)]};
 })});
}
