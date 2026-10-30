import test from 'node:test';import assert from 'node:assert/strict';
import {labHistoryMonths,labCollectionPeriod,labCollectionLabel,applyLabHistorySelection,modelResultIssues,buildLabComparison} from '../lib/client-reports/lab-history.ts';
import {effectiveReportData} from '../lib/client-reports/calculations.ts';import {validateClientReport} from '../lib/client-reports/validation.ts';
import {createReportDraft,getReportPreset} from '../lib/client-reports/presets.ts';import {lab,v,source} from './fixtures/client-report-fixtures.mjs';import {excludeReportRecord,correctReportValue} from '../lib/client-reports/editor.ts';
import {correctReportMetadata} from '../lib/client-reports/editor.ts';
function draft(){const d=createReportDraft('demo13','etdi','2026-09');d.data.sources=[source];d.selection.labComparison={version:1,previousMonths:2};d.data.lab=['2026-07-06','2026-08-03','2026-09-01'].map((date,i)=>lab({id:`r${i}`,date,sampleBase:`s${i}`}));return d;}
test('janela consecutiva, virada do ano e controles inválidos',()=>{
 assert.deepEqual(labHistoryMonths('2026-09',2),['2026-07','2026-08','2026-09']);assert.deepEqual(labHistoryMonths('2026-09',3),['2026-06','2026-07','2026-08','2026-09']);assert.deepEqual(labHistoryMonths('2026-01',2),['2025-11','2025-12','2026-01']);assert.deepEqual(labHistoryMonths('2026-10',2),['2026-08','2026-09','2026-10']);for(const [p,n] of [['2026-13',2],['2026-00',2],['2026-01',4],['2026-01',-1],['2026-01',1.5]])assert.throws(()=>labHistoryMonths(p,n));
});
test('seleção explícita mantém coletas, descarta revisão antiga, respeita correção e exclusão',()=>{
 let d=draft();assert.equal(effectiveReportData(d).lab.length,0);d.data.lab.push(lab({id:'repeat',date:'2026-09-01',sampleBase:'repeat'}),lab({id:'new-revision',date:'2026-09-01',sampleBase:'s2',revision:2}),lab({id:'future',date:'2026-10-01',sampleBase:'future'}),lab({id:'other-station',stationId:'biologico'}));
 d=excludeReportRecord(d,'r0','Descartado','u');d=correctReportValue(d,'r1','value',v('3'),'Revisado','u','2026-10-19T10:00:00Z');
 const next=applyLabHistorySelection(d);assert.ok(next.selection.selectedLabIds.includes('repeat'));assert.ok(next.selection.selectedLabIds.includes('new-revision'));for(const id of ['r0','r1','r2','future','other-station'])assert.ok(!next.selection.selectedLabIds.includes(id));assert.equal(next.selection.selectedLabIds.length,3);
 next.selection.selectedLabIds=[];assert.equal(effectiveReportData(next).lab.length,0);assert.equal(applyLabHistorySelection(next).selection.selectedLabIds.length,3);
 const old=draft();delete old.selection.labComparison;assert.equal(effectiveReportData(old).lab.length,1);assert.deepEqual(applyLabHistorySelection(old),old);
});
test('precisão mensal mantém dia vazio, distingue histórico/atual e impede eficiência',()=>{
 let d=draft();d.data.lab=[lab({id:'a',date:'',datePrecision:'month',collectionPeriod:'2026-08',sampleBase:'a'}),lab({id:'b',date:'',datePrecision:'month',collectionPeriod:'2026-09',pointId:'tratado',sampleBase:'b'})];d=applyLabHistorySelection(d);
 assert.equal(labCollectionPeriod(d.data.lab[0]),'2026-08');assert.equal(labCollectionLabel(d.data.lab[0]),'08/2026 — dia não informado');assert.equal(d.data.lab[0].date,'');
 const issues=validateClientReport(d,getReportPreset('demo13','etdi'));assert.ok(issues.some(i=>i.code==='model-day-missing'&&i.severity==='warning'&&i.recordIds.includes('a')));assert.ok(issues.some(i=>i.code==='model-day-missing'&&i.severity==='blocker'&&i.recordIds.includes('b')));assert.ok(!issues.some(i=>i.code==='date-invalid'));
 d.selection.efficiencyPairs=[{parameter:'DBO',inletId:'a',outletId:'b',declaredId:null}];assert.ok(validateClientReport(d,getReportPreset('demo13','etdi')).some(i=>i.code==='efficiency-pair-invalid'));
 d.period='2026-10';assert.ok(validateClientReport(d,getReportPreset('demo13','etdi')).some(i=>i.code==='current-lab-missing'));
});
test('alternativas divergentes são recalculadas; amostras documentadas não conflitam',()=>{
 let d=draft();d.data.lab=[lab({id:'a',labId:'Transcrição de modelo',sampleBase:'internal:a',sampleNumber:'',modelAlternativeGroup:'model-alternative:etdi',source:{sourceId:'s1',region:'resumo'},value:v('100')}),lab({id:'b',labId:'Transcrição de modelo',sampleBase:'internal:b',sampleNumber:'',modelAlternativeGroup:'model-alternative:etdi',source:{sourceId:'s1',region:'completo'},value:v('200')}),lab({id:'repeat',sampleBase:'repeat',value:v('300')})];d=applyLabHistorySelection(d);
 assert.ok(modelResultIssues(d).some(i=>i.code==='model-source-conflict'));d=excludeReportRecord(d,'a','Preferência conferida','u');assert.ok(!modelResultIssues(d).some(i=>i.code==='model-source-conflict'));assert.equal(d.data.lab.length,3);
});
test('matrizes mantêm meses vazios, IDs, unidades e no máximo quatro coletas por quadro',()=>{
 let d=draft();d.data.lab.push(lab({id:'rep',sampleBase:'rep',value:v('<0,3')}),lab({id:'unit',sampleBase:'unit',value:v('2','mL/L')}),lab({id:'unknown',sampleBase:'unknown',pointId:null,value:v('Ausente','')}));d=applyLabHistorySelection(d);
 const c=buildLabComparison(d,getReportPreset('demo13','etdi'));assert.deepEqual(c.months,['2026-07','2026-08','2026-09']);assert.equal(new Set(c.origins.sourceIds).size,6);assert.ok(c.tables.some(t=>t.title.includes('Ponto ou unidade a confirmar')));assert.ok(c.tables.every(t=>t.columns.length<=6));assert.ok(c.tables.some(t=>t.rows.flat().some(s=>s.includes('< 0,3'))));
 d.period='2026-10';const oct=buildLabComparison(d,getReportPreset('demo13','etdi'));assert.equal(oct.currentIds.length,0);assert.ok(oct.tables.some(t=>t.rows.flat().includes('Sem resultado na fonte')));
});
test('corrigir data mensal muda precisão com trilha, sem reviver revisão excluída',()=>{
 let d=draft();d.data.lab=[lab({id:'monthly',date:'',datePrecision:'month',collectionPeriod:'2026-09'})];d=applyLabHistorySelection(d);
 const fixed=correctReportMetadata(d,'monthly',{date:'2026-09-03'},'Dia confirmado na fonte','u','2026-10-19T10:00:00Z'),r=fixed.data.lab.at(-1);assert.equal(r.datePrecision,'day');assert.equal(labCollectionPeriod(r),'2026-09');assert.equal(labCollectionLabel(r),'03/09/2026');assert.equal(d.data.lab[0].date,'');
 const versions=draft();versions.data.lab.push(lab({id:'new',sampleBase:'s2',revision:2}));const excluded=excludeReportRecord(versions,'new','Descartado','u');assert.ok(!applyLabHistorySelection(excluded).selection.selectedLabIds.includes('r2'));
});
test('histórico operacional não satisfaz fonte mensal e resultado desmarcado não bloqueia ponto',()=>{
 let d=draft();d.data.lab.push(lab({id:'unselected',sampleBase:'unselected',pointId:null}));d=applyLabHistorySelection(d);d.selection.selectedLabIds=d.selection.selectedLabIds.filter(id=>id!=='unselected');
 d.clientId='demo09';d.stationId='ete';d.data.lab=d.data.lab.map(r=>({...r,stationId:'ete'}));d.data.operations=[{id:'old-op',stationId:'ete',pointId:'bruto',date:'2026-08-01',parameter:'pH',value:v('7',''),source:{sourceId:source.id}}];
 const issues=validateClientReport(d,getReportPreset('demo09','ete'));assert.ok(issues.some(i=>i.code==='section-missing'&&i.message.includes('operations')));assert.ok(!issues.some(i=>i.code==='point-unmapped'&&i.recordIds.includes('unselected')));
});
test('matriz preserva precisão de resultados pequenos, sem arredondar limites a zero',()=>{
 let d=draft();d.data.lab=[lab({value:v('<0,00010')})];d=applyLabHistorySelection(d);const c=buildLabComparison(d,getReportPreset('demo13','etdi'));assert.ok(c.tables.flatMap(t=>t.rows.flat()).some(s=>s.startsWith('< 0,0001 mg/L')));
});
test('origem de duas coletas sem laudo no mesmo dia possui chave visível em cada célula',()=>{
 let d=draft();d.data.lab=[lab({id:'first',sampleBase:'first',sampleNumber:'',value:v('1')}),lab({id:'second',sampleBase:'second',sampleNumber:'',value:v('2')})];d=applyLabHistorySelection(d);const c=buildLabComparison(d,getReportPreset('demo13','etdi'));
 const cells=c.tables.flatMap(t=>t.rows.flat());for(const id of ['first','second']){const origin=c.origins.rows.find(row=>row.some(cell=>cell.includes(id))),key=origin[0].match(/\[R\d+\]/)?.[0];assert.ok(key);assert.ok(cells.some(cell=>cell.includes(key)));}
});
test('alternativa desmarcada exige motivo auditável; amostras distintas documentadas não conflitam',()=>{
 let d=draft();const group='model-alternative:teste';d.data.lab=[lab({id:'summary',labId:'Transcrição de modelo',sampleNumber:'',sampleBase:'internal:summary',modelAlternativeGroup:group,value:v('1'),source:{sourceId:'s1',region:'resumo'}}),lab({id:'full',labId:'Transcrição de modelo',sampleNumber:'',sampleBase:'internal:full',modelAlternativeGroup:group,value:v('2'),source:{sourceId:'s2',region:'completo'}})];d=applyLabHistorySelection(d);d.selection.selectedLabIds=['full'];
 assert.ok(modelResultIssues(d).some(i=>i.code==='model-source-decision-required'&&i.recordIds.includes('summary')));const audited=excludeReportRecord(d,'summary','Origem conferida','u');assert.ok(!modelResultIssues(audited).some(i=>i.code.startsWith('model-source-')));
 d.data.lab.forEach((r,i)=>{delete r.modelAlternativeGroup;r.sampleNumber=`LAUDO-${i}`;r.sampleBase=`sample-${i}`;});d=applyLabHistorySelection(d);assert.ok(!modelResultIssues(d).some(i=>i.code.startsWith('model-source-')));
});
test('transcrições de amostras documentadas distintas no mesmo dia não são alternativas',()=>{
 let d=draft();d.data.lab=[lab({id:'one',labId:'Transcrição de modelo',sampleNumber:'LAUDO-A',sampleBase:'sample-a',value:v('1'),source:{sourceId:'a',region:'um'}}),lab({id:'two',labId:'Transcrição de modelo',sampleNumber:'LAUDO-B',sampleBase:'sample-b',value:v('2'),source:{sourceId:'b',region:'dois'}})];d=applyLabHistorySelection(d);assert.ok(!modelResultIssues(d).some(i=>i.code==='model-source-conflict'));
});
test('DEMO13 conserva os dois quadros completos e parâmetros sem medição como lacunas',()=>{
 const d=applyLabHistorySelection(draft()),c=buildLabComparison(d,getReportPreset('demo13','etdi'));
 for(const label of ['Entrada / Equalizado','Saída / Tratado']){const table=c.tables.find(t=>t.title===label);assert.ok(table);assert.ok(table.rows.some(row=>row[0]==='Fluoreto'&&row.slice(2).every(cell=>cell==='Sem resultado na fonte')));}
});
