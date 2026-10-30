import test from 'node:test';import assert from 'node:assert/strict';import * as XLSX from 'xlsx';
import {importOperationsWorkbook} from '../lib/client-reports/import-operations.ts';
import {selectLatestLabRevisions} from '../lib/client-reports/import-lab.ts';
import {workbook,source,context} from './fixtures/client-report-fixtures.mjs';
test('Hospital usa apenas dias, turnos, erros e fórmulas sem cache',()=>{
 const w=workbook([[],['Elevatória 3',null],['Horário','pH'],['1º Análise /Manha',7],['2º Análise / Tarde',8]],'01');
 w.Sheets['01'].B5={t:'e',v:7,w:'#DIV/0!'};
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Horário','pH'],['manhã',99]]),'MENSAL');
 const b=importOperationsWorkbook('hospital',w,source,{...context,clientId:'demo08',stationId:'ete',period:'2026-08'});
 assert.deepEqual(b.operations.map(x=>x.shift),['manhã','tarde']);assert.ok(b.operations.some(x=>x.value.status==='invalid'));
 w.Sheets['01'].B4={t:'n',f:'1+1'};const c=importOperationsWorkbook('hospital',w,source,{...context,clientId:'demo08',period:'2026-08'});assert.equal(c.operations[0].value.status,'invalid');
});
test('Hospital confere mês textual, ponto sem espaço e média declarada sem duplicar medições',()=>{
 const w=workbook([['AGOSTO DE 2026'],['Elevatória3',null],['Horário','pH'],['manhã',7],['tarde',9]],'01');XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Data','Elevatória3'],['Dia','pH'],[1,99]]),'MENSAL');const ctx={...context,clientId:'demo08',stationId:'ete',period:'2026-08'};
 const b=importOperationsWorkbook('hospital',w,source,ctx);assert.equal(b.operations.length,2);assert.ok(b.operations.every(r=>r.pointId==='elevatoria-3'));assert.ok(b.issues.some(i=>i.code==='consolidated-divergence'&&i.message.includes('8')));assert.throws(()=>importOperationsWorkbook('hospital',w,source,{...ctx,period:'2026-09'}),/período/i);
});
test('Demo09 só importa MENSAL visível no mês selecionado e separa eficiência',()=>{
 const w=workbook([['SETEMBRO/2026'],['Elevatória',null],['Dia','pH'],[1,7],[2,8]],'MENSAL');XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['DATA','pH'],['01/01/2013',99]]),'aux');w.Workbook={Sheets:[{name:'MENSAL',Hidden:0},{name:'aux',Hidden:1}]};
 const b=importOperationsWorkbook('demo09-diario',w,source,{...context,clientId:'demo09',stationId:'ete'});assert.ok(b.operations.every(x=>x.date.startsWith('2026-09')));assert.ok(b.operations.every(x=>x.source.sheet==='MENSAL'));assert.equal(b.operations.length,2);
 const e=workbook([['DBO',null,null,null,null,null,null,null,'DQO'],[null,'EQUALIZADO',null,'DECANTADOR',null,'EFICIÊNCIA',null,null,null,'EQUALIZADO',null,'DECANTADOR',null,'EFICIÊNCIA'],[46266,240,null,5.07,null,97.8875,null,null,46266,600,null,21,null,96.5]],'1');const c=importOperationsWorkbook('demo09-eficiencia',e,source,{...context,clientId:'demo09',stationId:'ete'});assert.equal(c.lab.length,6);assert.equal(c.lab.find(x=>x.parameter==='DBO'&&x.pointId==='bruto').value.value,240);
});
test('histórico DEMO13 preserva três meses e bruto/tratado, sem simular laudos',()=>{
 const w=workbook([['PARÂMETROS',null,'RESULTADOS ETDI - BRUTO',null,null,'RESULTADOS ETDI - TRATADO'],['PARÂMETROS','Unidade','01/07/2026','01/08/2026','01/09/2026','01/09/2026'],['DBO','mg/L',1,2,3,4]],'ETDI');const b=importOperationsWorkbook('demo13-history',w,source,context);assert.equal(b.lab.length,4);assert.ok(b.lab.every(x=>x.labId==='historico'));assert.equal(b.lab.at(-1).pointId,'tratado');
});
test('entrada e saída da eficiência Demo09 permanecem ativas sem conflito de revisão',()=>{
 const w=workbook([['DBO',null,null,null,null,null,null,null,'DQO'],[null,'EQUALIZADO',null,'DECANTADOR',null,'EFICIÊNCIA',null,null,null,'EQUALIZADO',null,'DECANTADOR',null,'EFICIÊNCIA'],[46266,240,null,5.07,null,97.8875,null,null,46266,600,null,21,null,96.5]],'1');
 const batch=importOperationsWorkbook('demo09-eficiencia',w,source,{...context,clientId:'demo09',stationId:'ete'}),selected=selectLatestLabRevisions(batch.lab);
 assert.equal(selected.active.filter(r=>r.parameter==='DBO').length,2);assert.equal(selected.issues.filter(i=>i.code==='lab-conflict').length,0);
});
