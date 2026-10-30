import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDraft,lab,v,source} from './fixtures/client-report-fixtures.mjs';
import {getReportPreset,REPORT_PRESETS,resolveReportPreset} from '../lib/client-reports/presets.ts';
import {buildReportDocument} from '../lib/client-reports/document.ts';
import {buildNarrativeContext,narrativeContextHash} from '../lib/client-reports/narrative-context.ts';
import {applyEditorialModel,getEditorialProposal} from '../lib/client-reports/editorial.ts';
import {conclusionDataKey,updateConclusionState} from '../lib/client-reports/conclusion.ts';

export function modernDraft(){const d=makeDraft({presetVersion:'2',documentRendererVersion:'4'});d.data.sources=[source];d.data.lab=[lab({campaignId:'C-01'}),lab({id:'out',sampleBase:'out',pointId:'tratado',value:v(125.4),campaignId:'C-01'})];d.selection.selectedLabIds=['lab-1','out'];d.selection.efficiencyPairs=[{parameter:'DBO',inletId:'lab-1',outletId:'out',declaredId:null}];return d;}
test('todos os oito modelos recebem estrutura v4 sem alterar resultados ou versões antigas',()=>{
 for(const p of REPORT_PRESETS){const d=modernDraft();d.clientId=p.clientId;d.stationId=p.stationId;const before=JSON.stringify(d);const doc=buildReportDocument(d,getReportPreset(p.clientId,p.stationId),'draft');assert.equal(doc.rendererVersion,'4');assert.equal(doc.editorial.version,'1');assert.equal(doc.sections[0].id,'executive-summary');assert.ok(doc.sections.some(s=>s.id==='conclusion'));assert.equal(JSON.stringify(d),before);}
 const old=makeDraft();assert.equal(buildReportDocument(old,getReportPreset('demo13','etdi','1'),'draft').rendererVersion,'1');
});
test('contexto factual preserva operadores e não calcula eficiência incompatível ou fora de campanha',async()=>{
 const d=modernDraft(),p=getReportPreset('demo13','etdi');let c=buildNarrativeContext(d,p);assert.match(c.evidence.find(e=>e.kind==='calculation').text,/90,00/);
 const hash=await narrativeContextHash(c);d.revision++;assert.equal(await narrativeContextHash(buildNarrativeContext(d,p)),hash);
 for(const value of [v('< 2'),v(2,'kg')]){d.data.lab[1].value=value;c=buildNarrativeContext(d,p);assert.ok(!c.evidence.some(e=>e.kind==='calculation'));assert.ok(c.evidence.some(e=>e.kind==='gap'));}
 d.data.lab[1].value=v(125.4);d.data.lab[1].date='2026-08-01';assert.ok(!buildNarrativeContext(d,p).evidence.some(e=>e.kind==='calculation'));
});
test('propostas editoriais não são aprovação e não copiam dados/conclusão de outro modelo',()=>{
 const d=modernDraft(),proposal=getEditorialProposal(d.clientId,d.stationId);assert.ok(proposal.sections.length);assert.equal(proposal.approvedByUid,undefined);
 const settings={clientId:d.clientId,identities:{},mappings:[],references:[],enabledPresetVersions:['etdi@2'],updatedByUid:'admin'};
 assert.deepEqual(applyEditorialModel(d,settings),d);assert.equal(resolveReportPreset(settings,'demo13','etdi','2','4').enabled,false);
 settings.editorialModels={etdi:{...proposal,approvedByUid:'marco',approvedAt:'2026-10-26',sourceHash:'a'.repeat(64)}};settings.enabledRendererVersions={etdi:['4']};settings.technicalApproverUid='marco';
 const next=applyEditorialModel(d,settings);assert.equal(next.editorialModel.version,'1');assert.deepEqual(next.data,d.data);assert.equal(next.narratives.conclusion,d.narratives.conclusion);assert.equal(resolveReportPreset(settings,'demo13','etdi','2','4').enabled,true);
});
test('resumo e ações editados invalidam revisão v4 sem modificar o texto anterior',()=>{
 const d=modernDraft();d.editorial={version:'1',summary:[],actions:[],scope:'Escopo',limitations:[]};d.conclusionState={dataKey:conclusionDataKey(d),reviewed:true};const n=structuredClone(d);n.editorial.scope='Escopo revisto';const updated=updateConclusionState(d,n);assert.equal(updated.conclusionState.reviewed,false);assert.equal(updated.narratives.conclusion,d.narratives.conclusion);
});
