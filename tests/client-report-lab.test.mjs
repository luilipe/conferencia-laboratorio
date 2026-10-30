import assert from 'node:assert/strict';
import test from 'node:test';
import {importLabWorkbook,selectLatestLabRevisions} from '../lib/client-reports/import-lab.ts';
import {validateClientReport} from '../lib/client-reports/validation.ts';
import {getReportPreset} from '../lib/client-reports/presets.ts';
import {createMrWorkbook,mrHeaders,source,context,lab,v,makeDraft} from './fixtures/client-report-fixtures.mjs';
const row={'N° Amostra':'S/2026.9','Identificação':'Ponto informado','Empresa Solicitante':'Sintético','Data de Coleta':'01/09/2026 12:30','Data de Publicação':'01/10/2026','Identificação da Análise':'DBO₅','Resultado da Análise':'< 2,0','Unidade de Medida da Análise':'µg/L'};
test('Materiais Flutuantes qualitativos não exigem unidade numérica; DBO continua exigindo',()=>{
 const b=importLabWorkbook(createMrWorkbook([{...row,'Identificação da Análise':'Materiais Flutuantes','Resultado da Análise':'Ausência','Unidade de Medida da Análise':null}]),source,context);
 assert.equal(b.lab[0].value.qualitative,'Ausência');assert.equal(b.lab[0].value.value,null);assert.equal(b.lab[0].value.originalUnit,'');assert.ok(!b.issues.some(i=>i.code==='unit-missing'));
 const d=makeDraft();d.data.sources=[source];d.data.lab=[lab({parameter:'Materiais Flutuantes',value:v('Ausência','')}),lab({id:'dbo-no-unit',sampleBase:'other',value:v(1,'')})];const issues=validateClientReport(d,getReportPreset('demo13','etdi'));assert.ok(!issues.some(i=>i.code==='unit-missing'&&i.recordIds.includes('lab-1')));assert.ok(issues.some(i=>i.code==='unit-missing'&&i.recordIds.includes('dbo-no-unit')));
});
test('MR encontra cabeçalho reordenado, preserva origem/coleta e exige correspondência',()=>{
 const b=importLabWorkbook(createMrWorkbook([row],mrHeaders.toReversed()),source,context);
 assert.equal(b.lab[0].value.raw,'< 2,0'); assert.equal(b.lab[0].value.originalUnit,'µg/L'); assert.equal(b.lab[0].source.sheet,'Samples'); assert.equal(b.lab[0].date,'2026-09-01'); assert.equal(b.lab[0].publicationDate,'2026-10-01'); assert.equal(b.lab[0].pointId,null);
 assert.ok(b.issues.some(i=>i.code==='point-unmapped'));
 const ph=importLabWorkbook(createMrWorkbook([{...row,'Identificação da Análise':'pH','Unidade de Medida da Análise':null}]),source,context);
 assert.ok(!ph.issues.some(i=>i.code==='unit-missing'));
 const bad=importLabWorkbook(createMrWorkbook([{...row,'Unidade de Medida da Análise':null}]),source,context); assert.ok(bad.issues.some(i=>i.code==='unit-missing'));
 assert.throws(()=>importLabWorkbook(createMrWorkbook([row],mrHeaders.filter(h=>h!=='Resultado da Análise')),source,context),/cabeçalho/i);
});
test('revisão é numérica, incompleta não mistura laudos e conflitos não somem',()=>{
 const a=lab({revision:9,id:'a'}),b=lab({revision:10,id:'b'});
 assert.equal(selectLatestLabRevisions([a,b]).active[0].revision,10);
 assert.ok(selectLatestLabRevisions([a,lab({revision:9,parameter:'DQO',id:'c'}),b]).issues.some(i=>i.code==='revision-incomplete'));
 assert.ok(selectLatestLabRevisions([b,lab({revision:10,id:'d',value:v(999)})]).issues.some(i=>i.code==='lab-conflict'));
 const mapped=importLabWorkbook(createMrWorkbook([row]),source,{...context,mappings:[{labId:'mr-ambiental',companyAlias:'Sintético',identification:'Ponto informado',stationId:'etdi',pointId:'bruto'}]}); assert.equal(mapped.lab[0].pointId,'bruto');
});

test('modelo MR da Demo13 extrai estação e tipo do ponto pela Identificação',()=>{
 const inputs=[
  ['ETDI - Bruto (Mensal)','etdi','bruto'],
  ['ETDI - Tratado (Mensal)','etdi','tratado'],
  ['Biológico - Bruto (Mensal)','biologico','bruto'],
  ['Biológico - Tratado (Mensal)','biologico','tratado'],
  ['  BIOLOGICO – TRATADO (Semanal)  ','biologico','tratado'],
  ['ETDI—Bruto','etdi','bruto'],
 ];
 const b=importLabWorkbook(createMrWorkbook(inputs.map(([identification],i)=>({...row,'N° Amostra':`DEMO13-${i}/2026.1`,'Empresa Solicitante':'Demo13 Lubrificantes S/A - Ouro Fino','Identificação':identification}))),source,context);
 assert.deepEqual(b.lab.map(r=>[r.stationId,r.pointId]),inputs.map(([,station,point])=>[station,point]));
 assert.equal(b.issues.filter(i=>i.code==='point-unmapped').length,0);
 assert.equal(b.lab[3].identification,'Biológico - Tratado (Mensal)');
 assert.equal(b.lab[3].value.raw,'< 2,0');
});

test('extração da Demo13 preserva correspondências cadastradas e deixa casos desconhecidos pendentes',()=>{
 const company='Demo13 Lubrificantes S/A - Ouro Fino';
 const identification='ETDI - Tratado (Mensal)';
 const b=importLabWorkbook(createMrWorkbook([{...row,'Empresa Solicitante':company,'Identificação':identification}]),source,{...context,mappings:[{labId:'mr-ambiental',companyAlias:company,identification,stationId:'etdi',pointId:'bruto'}]});
 assert.equal(b.lab[0].pointId,'bruto');
 assert.ok(!b.issues.some(i=>i.code==='point-unmapped'));
 const unknown=['ETDI','ETDI - Ponto 2 (Mensal)','ETDI - Bruto / Tratado','ETDI / Biológico - Tratado','Observação ETDI - Tratado','ETDI - Tratado (Mensal) (Outra estação)'];
 const pending=importLabWorkbook(createMrWorkbook(unknown.map((text,i)=>({...row,'N° Amostra':`UNKNOWN-${i}/2026.1`,'Empresa Solicitante':company,'Identificação':text}))),source,context);
 assert.ok(pending.lab.every(r=>r.stationId===null&&r.pointId===null));
 assert.equal(pending.issues.filter(i=>i.code==='point-unmapped').length,unknown.length);
 const otherCompany=importLabWorkbook(createMrWorkbook([{...row,'Identificação':identification}]),source,context);
 assert.equal(otherCompany.lab[0].pointId,null);
 const otherClient=importLabWorkbook(createMrWorkbook([{...row,'Empresa Solicitante':company,'Identificação':identification}]),source,{...context,clientId:'demo01',stationId:'ete'});
 assert.equal(otherClient.lab[0].stationId,null);
});
