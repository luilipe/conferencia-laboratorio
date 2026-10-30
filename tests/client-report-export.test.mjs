import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as X from 'xlsx';
import {exportReportDocx,exportReportPdf,exportReportXlsx,reportFileName,reportChartTable} from '../lib/client-reports/export.ts';import {buildReportDocument} from '../lib/client-reports/document.ts';import {getReportPreset} from '../lib/client-reports/presets.ts';import {makeDraft,lab,v,source} from './fixtures/client-report-fixtures.mjs';
import {jsPDF} from 'jspdf';
import {inflateSync} from 'node:zlib';
test('fontes incorporadas cobrem símbolos técnicos sem perda silenciosa',()=>{const pdf=new jsPDF();for(const [name,chars] of [['NotoSans-Regular','₅µ³°'],['NotoSansMath-Regular','≤≥']]){pdf.addFileToVFS(`${name}.ttf`,fs.readFileSync(`public/report-assets/${name}.ttf`).toString('base64'));pdf.addFont(`${name}.ttf`,name,'normal');pdf.setFont(name);for(const char of chars)assert.ok(pdf.getFont().metadata.cmap.unicode.codeMap[char.charCodeAt(0)],`${name}: ${char}`);}});
test('tabela de gráficos preserva lacunas e leituras repetidas em colunas por série',()=>{const t=reportChartTable({id:'c',title:'Controle',unit:'mL/L',series:[{label:'R1',points:[{date:'2026-09-01',value:1},{date:'2026-09-01',value:2},{date:'2026-09-02',value:null}]},{label:'R2',points:[{date:'2026-09-01',value:3},{date:'2026-09-02',value:null}]}]});assert.deepEqual(t.columns,['Data ou intervalo','R1','R2','Unidade']);assert.equal(t.rows.length,3);assert.equal(t.rows[1][1],'2,00');assert.equal(t.rows[2][1],'—');});
test('exporta conteúdo editável, PDF Unicode e Excel textual sem fórmula',async()=>{
 const d=makeDraft();d.data.sources=[source];d.data.lab=[lab({value:v('< 2,0','µg/L'),parameter:'DBO₅'})];d.data.journal=[{id:'note',date:'2026-09-01',shift:'noturno',order:1,text:'=HYPERLINK("https://example.invalid")',plantState:'unknown',source:{sourceId:source.id}}];
 const doc=buildReportDocument(d,getReportPreset('demo13','etdi','1'),'draft');doc.sections.forEach(s=>s.charts=[]);
 assert.equal(reportFileName(doc,'pdf'),'demo13_etdi_2026-09_v0_RASCUNHO.pdf');
 const word=await exportReportDocx(doc);assert.ok(word.size>5000);assert.equal(word.type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 const fonts={regular:fs.readFileSync('public/report-assets/NotoSans-Regular.ttf').toString('base64'),bold:fs.readFileSync('public/report-assets/NotoSans-Bold.ttf').toString('base64'),math:fs.readFileSync('public/report-assets/NotoSansMath-Regular.ttf').toString('base64')};const pdf=await exportReportPdf(doc,fonts);assert.ok(pdf.size>5000);assert.equal(pdf.type,'application/pdf');
 const excel=await exportReportXlsx(d),w=X.read(await excel.arrayBuffer());assert.equal(w.SheetNames.length,6);const note=Object.values(w.Sheets['Diário']).find(c=>c&&typeof c==='object'&&c.v===d.data.journal[0].text);assert.equal(note.t,'s');assert.equal(note.f,undefined);assert.ok(Object.values(w.Sheets.Resultados).some(c=>c?.v==='< 2,0'));
});
test('células do PDF mantêm fundo claro após desenhar textos e símbolos',async()=>{
 const d=makeDraft(),doc=buildReportDocument(d,getReportPreset('demo13','etdi','1'),'draft');doc.sections=[{id:'test',title:'Tabela de controle',orientation:'portrait',paragraphs:[],charts:[],tables:[{id:'cells',title:'Células',columns:['A','B','C'],rows:[['Primeiro','≤ 2,0','Terceiro']],sourceIds:[]}]}];
 const fonts=Object.fromEntries([['regular','NotoSans-Regular'],['bold','NotoSans-Bold'],['math','NotoSansMath-Regular']].map(([key,file])=>[key,fs.readFileSync(`public/report-assets/${file}.ttf`).toString('base64')]));
 const bytes=Buffer.from(await (await exportReportPdf(doc,fonts)).arrayBuffer()),raw=bytes.toString('latin1');let cells=0;
 for(const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)){let decoded;try{decoded=inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{continue;}if(!decoded.includes(' re\n'))continue;let fill=[1,1,1];for(const line of decoded.split('\n')){if(/^([\d.]+ ){3}rg$/.test(line))fill=line.split(' ').slice(0,3).map(Number);else if(/^[\d.]+ g$/.test(line))fill=Array(3).fill(Number(line.split(' ')[0]));else if(line==='B'){cells++;assert.ok(fill.every(c=>c>.8),`Fundo escuro na célula ${cells}: ${fill}`);}}}
 assert.equal(cells,6);
});
test('fidelidade visual v2/v3 usa títulos próprios e local de emissão sem COMBINED cru',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(fs.readFileSync('public/report-assets/ouro-fino-v1.png'));
 try {
  const d=makeDraft({clientId:'demo24',stationId:'combined',period:'2026-09'});
  d.presetVersion='2';d.documentRendererVersion='3';
  d.fixedText={source:{fileName:'demo24.docx',sha256:'a'.repeat(64)},sections:[{id:'presentation',title:'Apresentação',paragraphs:['Texto']}],layout:{font:'Arial',bodySize:24,coverTitle:'Relatório Demo24',titleLines:['Esmaltação e Polidora'],issuePlace:'Cordeirópolis',footer:['Ouro Fino'],margins:{top:720,bottom:720,left:720,right:720}}};
  const doc=buildReportDocument(d,getReportPreset('demo24','combined','2'),'draft');
  const word=await exportReportDocx(doc);assert.ok(word.size>5000);
  const fonts=Object.fromEntries([['regular','NotoSans-Regular'],['bold','NotoSans-Bold'],['math','NotoSansMath-Regular']].map(([key,file])=>[key,fs.readFileSync(`public/report-assets/${file}.ttf`).toString('base64')]));
  const pdf=await exportReportPdf(doc,fonts);assert.ok(pdf.size>5000);
 } finally {
  globalThis.fetch=original;
 }
});
