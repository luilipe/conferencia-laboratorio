import test from 'node:test';import assert from 'node:assert/strict';
import {importOperationsWorkbook} from '../lib/client-reports/import-operations.ts';
import {workbook,source,context} from './fixtures/client-report-fixtures.mjs';
test('Polidora conserva tratamentos/horários, datas laterais e totais',()=>{
 const w=workbook([['PLANILHA - AGOSTO/2026'],['Data','Operador',null,'pH (7,0 a 9,0)',null,'Data','PAC (kg)'],[46237,'Ana 08:00',null,7.5,null,5,10],[46237,'Ana 10:00',null,7.5,null,6,20],['TOTAL',null,null,15,null,null,30]]);
 const b=importOperationsWorkbook('demo24-polidora',w,source,{...context,clientId:'demo24',stationId:'combined',period:'2026-08'});
 assert.deepEqual(b.operations.map(x=>x.date),['2026-08-03','2026-08-03']); assert.deepEqual(b.operations.map(x=>x.time),['08:00','10:00']);
 assert.equal(b.supplies[0].date,'2026-08-05');assert.equal(b.supplies[0].kind,'consumption');assert.equal(b.operations.length,2);
});
test('Esmaltação localiza cabeçalho e deixa insumo sem unidade pendente',()=>{
 const b=importOperationsWorkbook('demo24-monitoramento',workbook([['AGOSTO/2026'],['Horário','Data','Tratamento','pH Final','Sulfato'],['08:00',46237,1,7.1,4],['09:00',46237,2,7.2,5]]),source,{...context,clientId:'demo24',stationId:'combined',period:'2026-08'});
 assert.deepEqual(b.operations.map(x=>x.treatment),['1','2']); assert.ok(b.issues.some(x=>x.code==='unit-missing'));
 assert.throws(()=>importOperationsWorkbook('demo24-monitoramento',workbook([['Cabeçalho desconhecido'],[1,2]]),source,context),/cabeçalho/i);
});
