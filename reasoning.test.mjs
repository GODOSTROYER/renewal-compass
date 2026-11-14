import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFallback,dealWindow,inferredRoles} from './reasoning.mjs';
import {normalizeOrganizer} from './organizer-map.mjs';
import {prioritizedActions} from './data.mjs';

const evidence=[
 {id:'account:novel',claim:'Handover only'},
 {id:'f-cfo',speaker:'Dana Wu'},
 {id:'f-ops',speaker:'Omar Tesfaye'},
 {id:'f-other',speaker:'Dan Wu'}
];
const people=[
 {name:'Dana Wu',role:'CFO',relationship:'Neutral',sourceId:'stake:cfo'},
 {name:'Omar Tesfaye',role:'Operations supervisor',relationship:'Ally',sourceId:'stake:ops'},
 {name:'Dan Wu',role:'Procurement lead',relationship:'Unknown'}
];
const deal=(id,rest={})=>({id,title:'Deal '+id,stage:'qualified',...rest});

test('authority is a sourced candidate, not title-based guessing',()=>{
 const roles=inferredRoles(deal('a',{evidence:['f-cfo','f-ops']}),people,evidence);
 assert.deepEqual(roles.map(x=>x.name),['Dana Wu','Omar Tesfaye']);
 assert(roles.every(x=>x.role.startsWith('Potential')));
 assert(roles.every(x=>x.evidenceIds.length===2));
 assert.equal(roles[0].trust,'Neutral');
 assert.deepEqual(inferredRoles(deal('b',{evidence:['f-other']}),people,evidence).map(x=>x.name),['Dan Wu']);
 assert.equal(inferredRoles(deal('b'),people,evidence).length,0);
});
test('passed and met flags override misleading counters; zero is due, not unknown',()=>{
 assert.equal(dealWindow({deadline:{passed:true,met:false,moves_left:0}}).state,'passed');
 assert.equal(dealWindow({deadline:{passed:true,met:true,moves_left:0}}).state,'met');
 assert.equal(dealWindow({deadline:{moves_left:0}}).timing,'Due this game move');
 assert.equal(dealWindow({deadline:{soon:true}}).state,'soon');
 assert.equal(dealWindow({deadline:{moves_left:-1}}).state,'unknown');
});
test('sourced clocks, blockers and retry exclusions survive reordered account inputs',()=>{
 const d=[deal('unknown',{blocker:{text:'Open adoption gap',status:'open'}}),
  deal('now',{deadline:{moves_left:0},evidence:['f-cfo']}),
  deal('later',{deadline:{moves_left:3}}),
  deal('ended',{deadline:{passed:true,text:'Expired checkpoint'}}),
  deal('locked',{attemptsRemaining:0}),
  deal('agreed',{stage:'agreed'})];
 const run=opportunities=>buildFallback({accountRef:'account:novel',accountMove:17,opportunities,evidence,stakeholders:people});
 const a=run(d),b=run([...d].reverse());
 assert.deepEqual(prioritizedActions(a).map(x=>x.deal),['Deal now','Deal later','Deal unknown']);
 assert.deepEqual(prioritizedActions(b).map(x=>x.deal),prioritizedActions(a).map(x=>x.deal));
 assert.equal(prioritizedActions(a)[0].move,17);
 assert.equal(a.risks.find(x=>x.title==='Deal ended').impact.includes('passed'),true);
 assert(!a.gaps.some(x=>x.question.includes('Deal locked')));
});
test('unknown event is surfaced without unsupported date, owner or related deal',()=>{
 const r=buildFallback({signals:[{id:'new_device',title:'Unfamiliar telemetry signal'}],accountRef:'account:novel'});
 const x=r.signalActions[0];
 assert.match(x.dueDate,/no verified deadline/);
 assert.match(x.deal,/not yet linked/);
 assert.deepEqual(x.evidenceIds,['signal:new_device']);
});
test('unseen account integration joins evidence and flags annual vs invoice mismatch without overwriting value',()=>{
 const results={get_my_accounts:{format:'account-quest-v2-export/1',minute:15,accounts:[{id:'never-seen',name:'Unseen Industries',minute:15,stakeholders:[{id:'far',name:'Fara Dev',role:'Controller',relationship:'Neutral'}],facts:[{id:'requires-budget',said_by:'Fara Dev',status:'told',text:'Need signoff'}],opportunities:[deal('e4',{evidence:['requires-budget'],deadline:{moves_left:1},blocker:{status:'open',text:'Approval pending'}})]}]},
  'get_all_paperwork:never-seen':{account:'never-seen',records:[{kind:'profile',path:'profile.json',data:{currency:'CAD',renewal:{annual_value:100,term_ends:'2027-01-05'}}},{kind:'invoices',path:'invoices.json',data:{currency:'CAD',first_year_total:130}}]},
  get_signals:{signals:[{id:'new',account:'never-seen',title:'Usage shifted',summary:'Change noted'}]}};
 const [a]=normalizeOrganizer(results).accounts;
 assert.equal(a.bookValue.amount,100);assert.equal(a.bookValue.currency,'CAD');assert.match(a.gaps[0].question,/invoice records differ/);
 assert.equal(a.deals[0].deadlineMove,16);assert.equal(a.deals[0].roles[0].name,'Fara Dev');
 assert.deepEqual(prioritizedActions(a).map(x=>x.deal),['Deal e4','Impact not yet linked to a specific deal','Existing contract']);
 const refIds=new Set(a.evidence.map(x=>x.id));
 assert([...a.bookValue.evidenceIds,...a.recommendation.evidence,...a.risks.flatMap(x=>x.evidenceIds??[])].every(id=>refIds.has(id)));
 // A misrouted paperwork result must not be attached to the requested account.
 results['get_all_paperwork:never-seen'].account='different';
 assert.equal(normalizeOrganizer(results).accounts[0].bookValue.amount,null);
});
