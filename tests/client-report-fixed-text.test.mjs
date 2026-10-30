import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFixedModelText, parseFixedModelText } from '../lib/client-reports/fixed-text.ts';
import { createReportDraft, getReportPreset } from '../lib/client-reports/presets.ts';
import { buildReportDocument } from '../lib/client-reports/document.ts';
const fixed={source:{fileName:'Modelo sintético.docx',sha256:'a'.repeat(64)},sections:[
{id:'presentation',title:'Apresentação',paragraphs:['Apresentação original.']},
{id:'technical-introduction',title:'Informações Técnicas',paragraphs:['Contexto original da estação.']},
{id:'objective',title:'Objetivo',paragraphs:['Objetivo original.']},
{id:'methodology',title:'Informações Técnicas',paragraphs:['O tratamento utiliza etapas descritas no modelo.']},
{id:'operations',title:'Análises e controle operacional',paragraphs:['O pH é medido com pH-metro.']},
{id:'bibliography',title:'Bibliografia',paragraphs:['Referência original.']}]};
const settings={clientId:'demo13',identities:{},mappings:[],enabledPresetVersions:[],updatedByUid:'admin',references:[{id:'fixed-model:etdi',parameter:'Textos fixos do modelo',pointId:'etdi',unit:'',min:null,max:null,source:fixed.source.fileName,version:fixed.source.sha256,application:JSON.stringify(fixed),approvedByUid:'admin'}]};
test('novos meses recebem textos integrais, isolados por estação, sem conclusão ou resultados antigos',()=>{
const first=applyFixedModelText(createReportDraft('demo13','etdi','2026-09'),settings),next=applyFixedModelText(createReportDraft('demo13','etdi','2026-10'),settings);
assert.deepEqual(first.fixedText,next.fixedText);assert.equal(next.narratives.conclusion,'');assert.equal(next.data.lab.length,0);
assert.equal(next.narratives.presentation,fixed.sections[0].paragraphs[0]);assert.ok(next.narratives.methodologySource.includes(fixed.source.fileName));
next.fixedText.sections[0].paragraphs[0]='alterado';assert.equal(first.fixedText.sections[0].paragraphs[0],'Apresentação original.');
assert.equal(applyFixedModelText(createReportDraft('demo13','biologico','2026-10'),settings).fixedText,undefined);
});
test('prévia conserva textos do modelo, conclusão atual e snapshot independente do cadastro posterior',()=>{
const d=applyFixedModelText(createReportDraft('demo13','etdi','2026-10'),settings);d.narratives.conclusion='Conclusão deste mês.';
const doc=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft');
for(const s of fixed.sections)assert.deepEqual(doc.sections.find(x=>x.id===s.id)?.paragraphs.slice(0,s.paragraphs.length),s.paragraphs,s.id);
assert.equal(doc.sections.find(x=>x.id==='conclusion').paragraphs[0],'Conclusão deste mês.');
const before=JSON.stringify(d);applyFixedModelText(d,{...settings,references:[]});assert.equal(JSON.stringify(d),before);
});
test('catálogo fixo recusa conclusão, diário, dados, seções repetidas e origem inválida',()=>{
for(const id of ['conclusion','results','journal','identity'])assert.throws(()=>parseFixedModelText({...fixed,sections:[{id,title:'Indevido',paragraphs:['texto']}]}));
assert.throws(()=>parseFixedModelText({...fixed,sections:[fixed.sections[0],fixed.sections[0]]}));
assert.throws(()=>parseFixedModelText({...fixed,source:{...fixed.source,sha256:''}}));
});
