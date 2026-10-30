import test from 'node:test';import assert from 'node:assert/strict';
import {validateNarrativeSuggestion,applyNarrativeSuggestion} from '../lib/client-reports/narrative-review.ts';
import {buildNarrativeContext,narrativeContextHash} from '../lib/client-reports/narrative-context.ts';
import {makeDraft,lab,source} from './fixtures/client-report-fixtures.mjs';
import {getReportPreset} from '../lib/client-reports/presets.ts';
const d=()=>{const d=makeDraft({presetVersion:'2',documentRendererVersion:'4'});d.data.sources=[source];d.data.lab=[lab()];d.selection.selectedLabIds=['lab-1'];return d;};
const suggestion=()=>({conclusion:'DBO; Bruto / Equalizado; coleta 2026-09-01: 1.254,00 mg/L.',summary:[],actions:[],limitations:[],claims:[{text:'DBO; Bruto / Equalizado; coleta 2026-09-01: 1.254,00 mg/L.',evidenceIds:['lab-1']}]});
test('IA não transforma resultado limitado em exato e não troca unidades ou a associação entre parâmetros',()=>{
 const context={clientId:'demo13',stationId:'etdi',period:'2026-09',instructionsVersion:'1',evidence:[{id:'dbo',kind:'result',text:'DBO; Tratado: < 5 mg/L.',sourceIds:[]},{id:'dqo',kind:'result',text:'DQO; Tratado: 10 mg/L.',sourceIds:[]}]};
 const value=(text,ids=['dbo'])=>({conclusion:text,summary:[],actions:[],limitations:[],claims:[{text,evidenceIds:ids}]});
 assert.doesNotThrow(()=>validateNarrativeSuggestion(value('DBO: < 5 mg/L.'),context));
 for(const text of ['DBO: 5 mg/L.','DBO: 5 g/L.','DBO: > 5 mg/L.','DBO: < 5 kg/L.','DBO: < 5 µg/L.'])assert.throws(()=>validateNarrativeSuggestion(value(text),context),/unidade|operador|resultado|tupla/i);
 assert.throws(()=>validateNarrativeSuggestion(value('DBO: 10 mg/L. DQO: < 5 mg/L.',['dbo','dqo']),context),/parâmetro|tupla|resultado/i);
});
test('validação rejeita evidência de outro cliente, números inventados, parâmetros trocados e ações já acordadas',()=>{
 const context=buildNarrativeContext(d(),getReportPreset('demo13','etdi'));const s=suggestion();assert.ok(validateNarrativeSuggestion(s,context));
 assert.throws(()=>validateNarrativeSuggestion({...s,claims:[{text:s.conclusion,evidenceIds:['foreign']}]},context),/evidência/i);
 assert.throws(()=>validateNarrativeSuggestion({...s,conclusion:'DBO: 77777 mg/L'},context),/afirma|número|conclusão/i);
 assert.throws(()=>validateNarrativeSuggestion({...s,claims:[{text:s.conclusion.replace('DBO','DQO'),evidenceIds:['lab-1']}]},context),/parâmetro|evidência/i);
 assert.throws(()=>validateNarrativeSuggestion({...s,actions:[{id:'a',findingId:'x',proposal:'Rever',responsible:'Cliente',dueDate:'2026-11-01',status:'agreed',evidenceIds:['lab-1']}]},context),/ação/i);
});
test('aplicar é explícito e preserva origem; resposta antiga não sobrescreve dados alterados',async()=>{
 const draft=d(),context=buildNarrativeContext(draft,getReportPreset('demo13','etdi')),origin={generationId:'g',sourceVersionId:'v',contextHash:await narrativeContextHash(context),model:'simulado',promptVersion:'1'};const before=draft.narratives.conclusion;
 const applied=await applyNarrativeSuggestion(draft,suggestion(),origin);assert.equal(draft.narratives.conclusion,before);assert.notEqual(applied.narratives.conclusion,before);assert.equal(applied.aiOrigin.generationId,'g');assert.equal(applied.conclusionState.reviewed,false);
 draft.data.lab[0].value.raw='alterado';await assert.rejects(()=>applyNarrativeSuggestion(draft,suggestion(),origin),/alterad|contexto/i);
});
