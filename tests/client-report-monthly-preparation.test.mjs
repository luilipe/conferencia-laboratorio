import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMonthlyReport} from '../lib/client-reports/monthly-preparation.ts';
import {createReportDraft} from '../lib/client-reports/presets.ts';
import {emptyReportBatch} from '../lib/client-reports/values.ts';
import {lab,source,v} from './fixtures/client-report-fixtures.mjs';
import {getReportPreset} from '../lib/client-reports/presets.ts';
import {validateClientReport} from '../lib/client-reports/validation.ts';
const settings={clientId:'demo13',identities:{etdi:{facilityName:'Unidade cadastrada'}},references:[],mappings:[],enabledPresetVersions:[],updatedByUid:'admin'};
const batch=(rows)=>({...emptyReportBatch(),sources:[source],lab:rows});
test('prepara coleta atual mesmo publicada no mês seguinte; histórico e outra estação não viram mês atual',()=>{
 const d=createReportDraft('demo13','etdi','2026-09');
 const n=prepareMonthlyReport(d,settings,batch([lab({publicationDate:'2026-10-05'}),lab({id:'other',stationId:'biologico'}),lab({id:'old',sampleBase:'old',date:'2026-08-01'})]));
 assert.equal(n.identity.facilityName,'Unidade cadastrada');assert.equal(n.narratives.conclusion,'');assert.ok(n.selection.selectedLabIds.includes('lab-1'));assert.ok(!n.selection.selectedLabIds.includes('other'));
 assert.deepEqual(prepareMonthlyReport(n,settings,batch([lab()])),n);assert.equal(d.data.lab.length,0);
});
test('revisão incompleta e conflito ficam pendentes; preservar conclusão, exclusões e correções',()=>{
 const d=createReportDraft('demo13','etdi','2026-09');d.narratives.conclusion='Edição humana';
 const rows=[lab(),lab({id:'dqo',parameter:'DQO'}),lab({id:'new',revision:2,value:v(2)})];
 const n=prepareMonthlyReport(d,settings,batch(rows));assert.ok(n.data.issues.some(i=>i.code==='revision-incomplete'));assert.equal(n.narratives.conclusion,'Edição humana');
 assert.ok(validateClientReport(n,getReportPreset('demo13','etdi')).some(i=>i.code==='revision-incomplete'));
 assert.ok(prepareMonthlyReport(d,settings,batch([lab(),lab({id:'conflict',value:v(9)})])).data.issues.some(i=>i.code==='lab-conflict'));
});
test('fonte ausente não cria resultados, consumos ou eficiência presumida',()=>{
 const n=prepareMonthlyReport(createReportDraft('demo13','etdi','2026-10'),settings,emptyReportBatch());assert.equal(n.data.lab.length,0);assert.equal(n.data.supplies.length,0);assert.deepEqual(n.selection.efficiencyPairs,[]);
});
test('não pareia eficiência somente por mesma data; campanha precisa de vínculo confirmado',()=>{
 const n=prepareMonthlyReport(createReportDraft('demo13','etdi','2026-09'),settings,batch([lab(),lab({id:'out',sampleBase:'other',pointId:'tratado'})]));assert.deepEqual(n.selection.efficiencyPairs,[]);
});
test('ponto desconhecido não desaparece por estar fora da seleção automática',()=>{
 const d=createReportDraft('demo13','etdi','2026-09');d.documentRendererVersion='3';const n=prepareMonthlyReport(d,settings,batch([lab({stationId:null,pointId:null})]));assert.ok(validateClientReport(n,getReportPreset('demo13','etdi')).some(i=>i.code==='point-unmapped'));
});
test('campanha documentada permite montar eficiência automaticamente, preservando operadores',()=>{
 const d=createReportDraft('demo13','etdi','2026-09');
 const rows=[lab({campaignId:'campanha-confirmada'}),lab({id:'out',sampleBase:'out',pointId:'tratado',campaignId:'campanha-confirmada',value:v(12)})];
 const n=prepareMonthlyReport(d,settings,batch(rows));assert.equal(n.selection.efficiencyPairs.length,1);
 rows[1].value=v('< 12');assert.equal(prepareMonthlyReport(d,settings,batch(rows)).selection.efficiencyPairs.length,0);
});
test('histórico da janela configurada não cria pendências mensais artificiais no fluxo novo',()=>{
 const d=createReportDraft('demo13','etdi','2026-10');d.documentRendererVersion='3';const n=prepareMonthlyReport(d,settings,batch([lab()]));assert.ok(!validateClientReport(n,getReportPreset('demo13','etdi')).some(i=>i.code==='outside-period'));
});
test('atualizar fontes não restaura uma seleção explicitamente desmarcada',()=>{
 const rows=[lab(),lab({id:'second',sampleBase:'second'})],b=batch(rows);
 const d=prepareMonthlyReport(createReportDraft('demo13','etdi','2026-09'),settings,b);d.selection.selectedLabIds=['lab-1'];
 assert.deepEqual(prepareMonthlyReport(d,settings,b).selection.selectedLabIds,['lab-1']);
});
