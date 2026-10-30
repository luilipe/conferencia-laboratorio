import test from 'node:test';import assert from 'node:assert/strict';
import {createReportDraft,getReportPreset,resolveReportPreset} from '../lib/client-reports/presets.ts';
import {buildReportDocument} from '../lib/client-reports/document.ts';
import {validateClientReport} from '../lib/client-reports/validation.ts';
import {exportReportDocx} from '../lib/client-reports/export.ts';
import fs from 'node:fs';
import {lab,source,v} from './fixtures/client-report-fixtures.mjs';
test('novo renderizador remove quadros internos do corpo, preserva modelo original e mantém v2 anterior',()=>{
 const d=createReportDraft('demo13','etdi','2026-09'),p=getReportPreset('demo13','etdi');
 d.fixedText={source:{fileName:'Modelo sintético.docx',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Texto original']}],monthlySections:['laboratory','supplies'],layout:{font:'Arial',bodySize:24,coverTitle:'Título original',footer:['Rodapé do modelo'],margins:{top:1418,bottom:1418,left:1701,right:991}}};
 const old=buildReportDocument(d,p,'draft');assert.equal(old.rendererVersion,'2');assert.ok(old.sections.some(s=>s.id==='sources'));
 d.documentRendererVersion='3';const doc=buildReportDocument(d,p,'draft');assert.equal(doc.rendererVersion,'3');assert.equal(doc.modelLayout.coverTitle,'Título original');assert.ok(!doc.sections.some(s=>s.id==='sources'||s.id==='history'));assert.ok(doc.sections.find(s=>s.id==='supplies'));assert.ok(doc.sections.find(s=>s.id==='presentation').paragraphs.includes('Texto original'));
 assert.ok(validateClientReport(d,p).some(i=>i.code==='section-missing'&&i.message.includes('insumos')));
});
test('novo mês sem texto original exige cadastro inicial, sem dispensar as fontes mensais',()=>{
 const d=createReportDraft('demo09','ete','2026-09');d.documentRendererVersion='3';assert.ok(validateClientReport(d,getReportPreset('demo09','ete')).some(i=>i.code==='fixed-model-missing'));
});
test('Word v3 aceita perfil original sem reinterpretar Word v2',async()=>{
 const d=createReportDraft('demo13','etdi','2026-09');d.documentRendererVersion='3';
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(fs.readFileSync('public/report-assets/ouro-fino-v1.png'));
 try{const blob=await exportReportDocx(buildReportDocument(d,getReportPreset('demo13','etdi'),'draft'));assert.ok(blob.size>5000);}finally{globalThis.fetch=original;}
});
test('quadros originais preservam referências declaradas sem reutilizar resultados antigos',()=>{
 const d=createReportDraft('demo13','etdi','2026-10');d.documentRendererVersion='3';d.fixedText={source:{fileName:'modelo.docx',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Original']}],laboratoryTables:[{pointId:'bruto',title:'Entrada original',columns:['PARÂMETROS','Unidade','VMP original'],rows:[['DBO','mg/L','60 ou 80%']]}]};
 const doc=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft'),table=doc.sections.find(s=>s.id==='laboratory').tables[0];assert.ok(table.columns.includes('VMP original'));assert.ok(table.rows[0].includes('60 ou 80%'));assert.ok(doc.sections.find(s=>s.id==='laboratory').paragraphs.some(p=>p.includes('não homologadas')));
});
test('homologação antiga não libera automaticamente o renderizador novo',()=>{
 const config={clientId:'demo13',enabledPresetVersions:['etdi@2'],references:[]};assert.equal(resolveReportPreset(config,'demo13','etdi','2','3').enabled,false);
 config.references=[{id:'fixed-model:etdi',version:'hash-origem'},{id:'renderer-approval:etdi:3',source:'hash-origem',version:'3',approvedByUid:'admin'}];assert.equal(resolveReportPreset(config,'demo13','etdi','2','3').enabled,true);
});
test('quadros originais não descartam resultado quando a unidade muda entre meses',()=>{
 const d=createReportDraft('demo13','etdi','2026-10');d.documentRendererVersion='3';d.data.sources=[source];
 d.data.lab=[lab({id:'previous',sampleBase:'previous',value:v('0,3','mg/L')}),lab({id:'current',sampleBase:'current',date:'2026-10-01',value:v('300','µg/L')})];d.selection.selectedLabIds=['previous','current'];
 d.fixedText={source:{fileName:'modelo.docx',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Original']}],laboratoryTables:[{pointId:'bruto',title:'Entrada',columns:['PARÂMETROS','Unidade','VMP original'],rows:[['DBO','mg/L','60']]}]};
 const cells=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft').sections.find(s=>s.id==='laboratory').tables.flatMap(t=>t.rows.flat());assert.ok(cells.some(c=>c.includes('0,3 mg/L')));assert.ok(cells.some(c=>c.includes('300 µg/L')));
});
test('identificação opcional cadastrada permanece no documento novo',()=>{
 const d=createReportDraft('demo13','etdi','2026-10');d.documentRendererVersion='3';d.identity.phone='(11) 3333-4444';d.identity.stateRegistration='123.456.789.000';
 const requester=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft').sections.find(s=>s.id==='identity').tables.find(t=>t.id==='requester');
 assert.match(requester.rows[0][1],/Telefone: \(11\) 3333-4444/);
 assert.match(requester.rows[0][1],/Inscrição estadual: 123\.456\.789\.000/);
});
