import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestReportConclusion,conclusionDataKey,updateConclusionState} from '../lib/client-reports/conclusion.ts';
import {createReportDraft,getReportPreset} from '../lib/client-reports/presets.ts';
import {lab,v,source} from './fixtures/client-report-fixtures.mjs';
import {validateClientReport} from '../lib/client-reports/validation.ts';
function draft(){const d=createReportDraft('demo13','etdi','2026-09');d.data.sources=[source];d.data.lab=[lab({campaignId:'C-01'}),lab({id:'out',pointId:'tratado',value:v(125.4),campaignId:'C-01'}),lab({id:'old',sampleBase:'old',date:'2026-08-01',value:v(99999)})];d.selection.selectedLabIds=d.data.lab.map(r=>r.id);d.selection.efficiencyPairs=[{parameter:'DBO',inletId:'lab-1',outletId:'out',declaredId:null}];return d;}
test('sugere fatos atuais e eficiência de par confirmado sem alegação legal ou de operação contínua',()=>{
 const text=suggestReportConclusion(draft(),getReportPreset('demo13','etdi'));assert.match(text,/09\/2026/);assert.match(text,/90[,.]00%/);assert.doesNotMatch(text,/99999|atendeu|conforme|contínua|sem ocorrências/);assert.match(text,/referências/);
});
test('sem entrada, unidades incompatíveis, qualitativos e operadores não geram eficiência exata',()=>{
 for(const value of [v('< 5'),v('Ausente'),v(2,'kg')]){const d=draft();d.data.lab[1].value=value;const t=suggestReportConclusion(d,getReportPreset('demo13','etdi'));assert.doesNotMatch(t,/remoção calculada.*%/i);assert.match(t,/insuficientes|não calculada/);}
 const d=draft();d.selection.efficiencyPairs=[];assert.doesNotMatch(suggestReportConclusion(d,getReportPreset('demo13','etdi')),/90[,.]00%/);
});
test('dados mudam: revisão fica pendente sem sobrescrever conclusão editada; alteração de texto também invalida',()=>{
 const d=draft();d.narratives.conclusion='Minha conclusão';d.conclusionState={dataKey:conclusionDataKey(d),reviewed:true};
 const n=structuredClone(d);n.data.lab[0].value=v(999);const updated=updateConclusionState(d,n);assert.equal(updated.narratives.conclusion,'Minha conclusão');assert.equal(updated.conclusionState.reviewed,false);assert.equal(updated.conclusionState.stale,true);
 const edit=updateConclusionState(d,{...d,narratives:{...d.narratives,conclusion:'Novo texto'}});assert.equal(edit.conclusionState.reviewed,false);
});
test('nova emissão exige revisão da conclusão atual; modelos antigos não mudam de contrato',()=>{
 const d=draft();d.conclusionState={dataKey:conclusionDataKey(d),reviewed:false};
 assert.ok(validateClientReport(d,getReportPreset('demo13','etdi')).some(i=>i.code==='conclusion-review-required'));
 d.conclusionState.reviewed=true;assert.ok(!validateClientReport(d,getReportPreset('demo13','etdi')).some(i=>i.code==='conclusion-review-required'));
 delete d.conclusionState;assert.ok(!validateClientReport(d,getReportPreset('demo13','etdi')).some(i=>i.code==='conclusion-review-required'));
});
test('confirmação explícita da revisão persiste quando dados e texto não mudam',()=>{
 const d=draft();d.conclusionState={dataKey:conclusionDataKey(d),reviewed:false};const n=updateConclusionState(d,{...d,conclusionState:{...d.conclusionState,reviewed:true}});assert.equal(n.conclusionState.reviewed,true);
});
test('Demo24 usa as medições operacionais atuais sem inventar laudos',()=>{
 const d=createReportDraft('demo24','combined','2026-09');d.data.operations=[{id:'op',stationId:'combined',pointId:'polidora',date:'2026-09-01',time:null,shift:null,treatment:null,parameter:'pH',value:v(7,''),source:{sourceId:source.id}}];
 assert.match(suggestReportConclusion(d,getReportPreset('demo24','combined')),/pH.*7/);
});
test('conclusão destaca limitações e validação alerta alegação legal sem referência homologada',()=>{
 const d=draft();
 const preset=getReportPreset('demo13','etdi');
 const suggested=suggestReportConclusion(d,preset);
 assert.match(suggested,/Ressalta-se que nesta competência as determinações restringiram-se aos parâmetros analíticos indicados/);

 d.narratives.conclusion='Os efluentes tratados estão em conformidade com a legislação estadual e federal.';
 const issues=validateClientReport(d,preset);
 assert.ok(issues.some(i=>i.code==='conclusion-unsupported-legal-claim'),'Alerta alegação legal sem referência homologada');

 d.narratives.conclusion='Operação ocorreu no mês sem ocorrências técnicas.';
 const issuesOp=validateClientReport(d,preset);
 assert.ok(issuesOp.some(i=>i.code==='conclusion-unsupported-operation-claim'),'Alerta ausência de ocorrências sem comprovação operacional');
});
