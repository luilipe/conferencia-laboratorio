import test from 'node:test';import assert from 'node:assert/strict';import * as X from 'xlsx';
import {buildStandardWorkbook,importStandardWorkbook,validateManualBatch} from '../lib/client-reports/manual.ts';
import {source,context} from './fixtures/client-report-fixtures.mjs';import {emptyReportBatch} from '../lib/client-reports/values.ts';
test('manual exige autor e referência; modelo de seis abas retorna unidades e diário ordenado',()=>{
 const b=emptyReportBatch();b.sources=[{...source,kind:'manual',importedByUid:''}];assert.ok(validateManualBatch(b).some(i=>i.code==='manual-source-incomplete'));
 const w=buildStandardWorkbook();assert.deepEqual(w.SheetNames,['Resultados','Operação','Hidrômetros','Insumos','Diário','Fontes']);
 w.Sheets['Insumos']=X.utils.json_to_sheet([{id:'s1',date:'03/09/2026',stationId:'etdi',kind:'delivery',product:'PAC',raw:2,unit:'IBC',reason:'Conferido',reference:'Registro de campo'}]);
 w.Sheets['Diário']=X.utils.json_to_sheet([3,1,2].map(order=>({id:`j${order}`,date:'2026-09-03',shift:'noturno',order,text:`Observação ${order}`,plantState:'off',reason:'Conferido',reference:'Registro de campo'})));
 const r=importStandardWorkbook(w,source,context);assert.deepEqual(r.journal.map(x=>x.order),[1,2,3]);assert.equal(r.supplies[0].quantity.unit,'IBC');assert.equal(r.supplies[0].kind,'delivery');assert.equal(r.issues.length,0);
 w.Sheets['Operação']=X.utils.json_to_sheet([{date:'31/02/2026',parameter:'pH',raw:7,stationId:'etdi',pointId:'bruto'}]);assert.ok(importStandardWorkbook(w,source,context).issues.some(i=>i.code==='manual-invalid'));
});
