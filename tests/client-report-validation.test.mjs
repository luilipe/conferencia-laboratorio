import assert from 'node:assert/strict';import test from 'node:test';
import {validateClientReport,canFinalizeReport} from '../lib/client-reports/validation.ts';import {getReportPreset} from '../lib/client-reports/presets.ts';import {makeDraft,lab,v,source} from './fixtures/client-report-fixtures.mjs';
const preset=()=>({...getReportPreset('demo13','etdi','1'),enabled:true});
const draft=()=>{const d=makeDraft();d.data.sources=[source];d.data.lab=[lab({id:'in'}),lab({id:'out',sampleBase:'treated-sample',pointId:'tratado',value:v(909)}),lab({id:'dqo',parameter:'DQO'}),lab({id:'declared',sampleBase:'treated-sample',parameter:'Eficiência DBO',pointId:'tratado',value:v(60,'%')})];d.selection.efficiencyPairs=[{parameter:'DBO',inletId:'in',outletId:'out',declaredId:'declared'}];return d;};
test('avisos justificáveis são distintos de impedimentos e modelo sem aprovação',()=>{
 const d=draft(),issues=validateClientReport(d,preset());assert.ok(issues.some(x=>x.code==='efficiency-divergence'&&x.severity==='warning'));assert.equal(canFinalizeReport(issues),false);
 for(const i of issues.filter(x=>x.severity==='warning'))d.acknowledgements[i.id]={actorUid:'reviewer-1',reason:'Diferença documentada pelo revisor.'};assert.equal(canFinalizeReport(validateClientReport(d,preset())),true);
 assert.ok(validateClientReport(d,getReportPreset('demo13','etdi','1')).some(x=>x.code==='preset-disabled'));
 d.data.lab[0].pointId=null;assert.ok(validateClientReport(d,preset()).some(x=>x.code==='point-unmapped'));
});
test('datas de campanhas distintas, unidade e referência sem aprovação bloqueiam',()=>{
 const d=draft();d.data.lab[1].date='2026-09-02';assert.ok(validateClientReport(d,preset()).some(x=>x.code==='efficiency-pair-invalid'));
 d.data.lab[0].value=v(1254,'');assert.ok(validateClientReport(d,preset()).some(x=>x.code==='unit-missing'));
 d.references=[{id:'ref',parameter:'DBO',pointId:'tratado',unit:'mg/L',min:null,max:60,source:'Documento fornecido',version:'1',application:'A confirmar',approvedByUid:null}];assert.ok(validateClientReport(d,preset()).some(x=>x.code==='reference-unapproved'));
});
test('parada Demo01 pede conciliação humana da conclusão',()=>{
 const d=makeDraft({clientId:'demo01',stationId:'ete',period:'2026-08'});d.data.journal=[{id:'stop',date:'2026-08-03',shift:'noturno',order:1,text:'Parada',plantState:'off',source:{sourceId:source.id}}];d.narratives.conclusion='Operação contínua durante o mês';assert.ok(validateClientReport(d,getReportPreset('demo01','ete','1')).some(x=>x.code==='operation-narrative-review'));
});
test('eventos fora da competência e volume sem intervalo exigem conferência explícita',()=>{
 const d=draft();d.data.supplies=[{id:'supply',stationId:'etdi',date:'2026-08-01',kind:'delivery',product:'PAC',quantity:v(10,'L'),source:{sourceId:source.id}}];d.data.journal=[{id:'note',date:'2026-08-01',shift:'diurno',order:1,text:'Ocorrência',plantState:'unknown',source:{sourceId:source.id}}];d.data.meters=[{id:'meter',meterId:'tratado',date:'2026-08-01',time:null,cumulative:v(100,'m³'),declaredIntervalVolume:v(50,'L'),source:{sourceId:source.id}}];
 const issues=validateClientReport(d,preset());for(const id of ['supply','note','meter'])assert.ok(issues.some(i=>i.code==='outside-period'&&i.recordIds.includes(id)));assert.ok(issues.some(i=>i.code==='meter-interval-invalid'&&i.severity==='blocker'));
});
