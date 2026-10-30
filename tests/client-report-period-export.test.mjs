import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {exportReportXlsx} from '../lib/client-reports/export.ts';
import {buildReportDocument} from '../lib/client-reports/document.ts';
import {getReportPreset} from '../lib/client-reports/presets.ts';
import {makeDraft} from './fixtures/client-report-fixtures.mjs';

test('v2 mantém operação da competência igual no documento e Excel; v1 preserva exportação antiga',async()=>{
 const d=makeDraft({presetVersion:'2'});
 d.data.journal=[{id:'current-note',date:'2026-09-02',shift:'Manhã',order:1,text:'CURRENT MONTH NOTE',plantState:'',source:{sourceId:'source'}},{id:'old-note',date:'2026-08-02',shift:'Manhã',order:1,text:'OLD MONTH NOTE',plantState:'',source:{sourceId:'source'}}];
 d.selection.selectedJournalIds=['current-note','old-note'];
 const doc=buildReportDocument(d,getReportPreset('demo13','etdi'),'draft');
 assert.ok(!JSON.stringify(doc.sections).includes('OLD MONTH NOTE'));
 for(const version of ['1','2']){
  d.presetVersion=version;
  const book=XLSX.read(await (await exportReportXlsx(d)).arrayBuffer(),{type:'array'});
  const rows=XLSX.utils.sheet_to_json(book.Sheets['Diário'],{header:1});
  assert.equal(JSON.stringify(rows).includes('CURRENT MONTH NOTE'),true);
  assert.equal(JSON.stringify(rows).includes('OLD MONTH NOTE'),version==='1');
 }
});
