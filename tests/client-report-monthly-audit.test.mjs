import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportDraft,getReportPreset,resolveReportPreset} from '../lib/client-reports/presets.ts';
import {prepareMonthlyReport} from '../lib/client-reports/monthly-preparation.ts';
import {mergeReportImport,correctReportMetadata} from '../lib/client-reports/editor.ts';
import {effectiveReportData} from '../lib/client-reports/calculations.ts';
import {validateClientReport} from '../lib/client-reports/validation.ts';
import {buildReportDocument} from '../lib/client-reports/document.ts';
import {suggestReportConclusion,conclusionDataKey,updateConclusionState} from '../lib/client-reports/conclusion.ts';
import {emptyReportBatch} from '../lib/client-reports/values.ts';
import {lab,source,v} from './fixtures/client-report-fixtures.mjs';

const draft=()=>({...createReportDraft('demo13','etdi','2026-09'),documentRendererVersion:'3'});
const batch=rows=>({...emptyReportBatch(),sources:[source],lab:rows});
const issues=d=>validateClientReport(d,getReportPreset(d.clientId,d.stationId));

test('uma fonte parcialmente reaproveitada aceita os registros restantes sem duplicar os anteriores',()=>{
 const first=mergeReportImport(draft(),batch([lab()]));
 const complete=batch([lab(),lab({id:'dqo',parameter:'DQO'})]);
 const next=mergeReportImport(first,complete);
 assert.deepEqual(next.data.lab.map(r=>r.id),['lab-1','dqo']);
 assert.equal(next.data.sources.length,1);
 assert.deepEqual(mergeReportImport(next,complete),next);
});

test('ampliar histórico importa registros antes filtrados do mesmo arquivo',()=>{
 const d=draft();d.selection.labComparison.previousMonths=0;
 const b=batch([lab(),lab({id:'previous',sampleBase:'previous',date:'2026-08-01'})]);
 const first=prepareMonthlyReport(d,null,b);first.selection.labComparison.previousMonths=1;
 const next=prepareMonthlyReport(first,null,b);
 assert.deepEqual(effectiveReportData(next).lab.map(r=>r.id),['lab-1','previous']);
});

test('fonte sem registros pertinentes não fica marcada como já importada',()=>{
 const next=prepareMonthlyReport(draft(),null,batch([lab({stationId:'biologico'})]));
 assert.equal(next.data.sources.length,0);
});

test('data ausente continua visível e bloqueia emissão, inclusive diário e operação',()=>{
 const b=batch([lab({date:''})]);
 b.operations=[{id:'op',stationId:'etdi',pointId:'bruto',date:'',time:null,shift:null,treatment:null,parameter:'pH',value:v(7,''),source:{sourceId:source.id}}];
 b.journal=[{id:'journal',date:'',shift:'',order:1,text:'Ocorrência sem data',plantState:'unknown',source:{sourceId:source.id}}];
 const next=prepareMonthlyReport(draft(),null,b);
 assert.equal(next.data.operations.length,1);assert.equal(next.data.journal.length,1);
 for(const id of ['lab-1','op','journal'])assert.ok(issues(next).some(i=>i.code==='date-invalid'&&i.recordIds.includes(id)),id);
});

test('Demo24 não exige laboratório quando o modelo pede apenas operação e insumos',()=>{
 const d=createReportDraft('demo24','combined','2026-09');d.documentRendererVersion='3';
 assert.ok(!issues(d).some(i=>i.code==='current-lab-missing'));
 d.fixedText={source:{fileName:'modelo',sha256:'a'.repeat(64)},sections:[],monthlySections:['laboratory']};
 assert.ok(issues(d).some(i=>i.code==='current-lab-missing'));
});

test('fluxo novo exige revisão da conclusão mesmo quando o estado de revisão está ausente',()=>{
 assert.ok(issues(draft()).some(i=>i.code==='conclusion-review-required'));
 const legacy=draft();delete legacy.documentRendererVersion;
 assert.ok(!issues(legacy).some(i=>i.code==='conclusion-review-required'));
});

test('nova revisão do conteúdo fixo invalida o aceite e preserva a conclusão editada',()=>{
 const d=draft();d.narratives.conclusion='Conclusão revisada';
 d.conclusionState={dataKey:conclusionDataKey(d),reviewed:true};
 const next=updateConclusionState(d,{...d,fixedText:{source:{fileName:'Outro modelo',sha256:'b'.repeat(64)},sections:[]}});
 assert.equal(next.conclusionState.reviewed,false);assert.equal(next.narratives.conclusion,'Conclusão revisada');
});

test('atualização das fontes não sobrescreve cadastro ajustado num rascunho sem modelo fixo',()=>{
 const d=draft();d.identity.facilityName='Unidade corrigida pelo revisor';d.narratives.methodology='Descrição conferida';
 const settings={clientId:'demo13',identities:{etdi:{facilityName:'Cadastro anterior'}},references:[],mappings:[],enabledPresetVersions:[]};
 const next=prepareMonthlyReport(d,settings,emptyReportBatch());
 assert.equal(next.identity.facilityName,'Unidade corrigida pelo revisor');assert.equal(next.narratives.methodology,'Descrição conferida');
});

test('eficiência sem campanha comprovada ou com campanhas divergentes não entra na conclusão nem no documento',()=>{
 for(const campaigns of [[undefined,undefined],['manhã','tarde']]){
  const d=draft();d.data=batch([lab({campaignId:campaigns[0]}),lab({id:'out',sampleBase:'out',pointId:'tratado',campaignId:campaigns[1],value:v(125.4)})]);
  d.selection.selectedLabIds=['lab-1','out'];d.selection.efficiencyPairs=[{parameter:'DBO',inletId:'lab-1',outletId:'out',declaredId:null}];
  assert.ok(issues(d).some(i=>i.code==='efficiency-pair-invalid'));
  assert.doesNotMatch(suggestReportConclusion(d,getReportPreset('demo13','etdi')),/remoção calculada.*%/i);
  const efficiency=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft').sections.find(s=>s.id==='efficiency');
  assert.doesNotMatch(JSON.stringify(efficiency)??'',/90[,.]00/);
 }
});

test('identificação da campanha pode ser corrigida com autor, motivo e origem preservados',()=>{
 const d=draft();d.data=batch([lab()]);d.selection.selectedLabIds=['lab-1'];
 const next=correctReportMetadata(d,'lab-1',{campaignId:'Campanha C-01'},'Conferido no boletim C-01','reviewer',source.importedAt);
 assert.equal(effectiveReportData(next).lab[0].campaignId,'Campanha C-01');assert.equal(next.corrections.length,1);
 assert.equal(d.data.lab[0].campaignId,undefined);
});

test('modelo que exige eficiência aponta ausência de pares válidos',()=>{
 const d=createReportDraft('demo09','ete','2026-09');d.documentRendererVersion='3';
 assert.ok(issues(d).some(i=>i.code==='section-missing'&&/eficiência/i.test(i.message)));
});

test('modelo com apenas quadro de entrada não descarta resultados de saída',()=>{
 const d=draft();d.data=batch([lab({id:'out',sampleBase:'out',pointId:'tratado',value:v(125.4)})]);d.selection.selectedLabIds=['out'];
 d.fixedText={source:{fileName:'modelo',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Original']}],laboratoryTables:[{pointId:'bruto',title:'Entrada',columns:['Parâmetro','Unidade'],rows:[['DBO','mg/L']]}]};
 const tables=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft').sections.find(s=>s.id==='laboratory').tables;
 assert.ok(tables.some(t=>t.sourceIds.includes('out')&&t.rows.flat().some(c=>c.includes('125,4'))));
});

test('homologação de outro conteúdo fixo não libera emissão do rascunho anterior',()=>{
 const fixed={source:{fileName:'modelo',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Texto homologado']} ]};
 const settings={clientId:'demo13',enabledPresetVersions:['etdi@2'],references:[{id:'fixed-model:etdi',version:'a'.repeat(64),application:JSON.stringify(fixed)},{id:'renderer-approval:etdi:3',source:'a'.repeat(64),version:'3',approvedByUid:'admin'}]};
 const changed=structuredClone(fixed);changed.sections[0].paragraphs=['Conteúdo não homologado'];
 assert.equal(resolveReportPreset(settings,'demo13','etdi','2','3',changed).enabled,false);
 assert.equal(resolveReportPreset(settings,'demo13','etdi','2','3',fixed).enabled,true);
});

test('reimportação renomeada completa a fonte parcial com IDs e origem coerentes',()=>{
 const d=draft(),first=lab({id:'synthetic:lab:1'}),second=lab({id:'synthetic:lab:2',parameter:'DQO'});
 const next=mergeReportImport(mergeReportImport(d,batch([first])),{...batch([first,second]),sources:[{...source,id:'renamed'}],lab:[first,second].map(r=>({...r,id:r.id.replace('synthetic:','renamed:'),source:{sourceId:'renamed'}}))});
 assert.equal(next.data.sources.length,1);assert.deepEqual(next.data.lab.map(r=>r.id),['synthetic:lab:1','synthetic:lab:2']);
 assert.ok(next.data.lab.every(r=>r.source.sourceId==='synthetic'));
});
