import assert from 'node:assert/strict';import test from 'node:test';
import {calculateRemoval,summarizeValues,calculateMeterIntervals,summarizeSupplies,effectiveReportData} from '../lib/client-reports/calculations.ts';
import {v,source,makeDraft,lab} from './fixtures/client-report-fixtures.mjs';
test('eficiência e estatísticas excluem ausência/limite e conservam precisão',()=>{
 assert.ok(Math.abs(calculateRemoval(v(1254),v(909))-27.51196172)<1e-6);assert.equal(calculateRemoval(v(0),v(5)),null);assert.equal(calculateRemoval(v('< 2,0'),v(5)),null);assert.equal(calculateRemoval(v(240),v(5.07)),97.8875);assert.equal(calculateRemoval(v(600),v(21)),96.5);assert.equal(calculateRemoval(v(2,'kg'),v(1,'L')),null);assert.equal(calculateRemoval(v(1),v(2)),-100);
 assert.deepEqual(summarizeValues([v(0),v(''),v(10),v('<2')]),{count:2,mean:5,min:0,max:10});assert.ok(Math.abs(summarizeValues([...Array(25).fill(v(23.4,'°C')),v(24.4,'°C')]).mean-23.438461538)<1e-8);
});
test('hidrômetro conserva intervalo, lacunas, base e reset; entrega não é consumo',()=>{
 const meter=(date,val,id)=>({id,meterId:'tratado',date,time:null,cumulative:v(val,'m³'),declaredIntervalVolume:null,source:{sourceId:source.id}});
 const r=calculateMeterIntervals([meter('2026-09-03',110,'b'),meter('2026-09-01',100,'a')],null);assert.equal(r.intervals[0].volume,null);assert.equal(r.intervals[1].fromDate,'2026-09-01');assert.equal(r.intervals[1].volume,10);
 assert.ok(calculateMeterIntervals([meter('2026-09-02',10,'reset')],meter('2026-09-01',100,'base')).issues.some(x=>x.code==='meter-reset'));
 const e=(kind,raw,unit,id)=>({id,stationId:'etdi',date:'2026-09-01',kind,product:'PAC',quantity:v(raw,unit),source:{sourceId:source.id}});
 const s=summarizeSupplies([e('delivery',10,'L','1'),e('consumption',5,'L','2'),e('consumption',2,'IBC','3')]);assert.equal(s.find(x=>x.kind==='consumption'&&x.unit==='L').quantity,5);assert.equal(s.length,3);
});
test('dados efetivos preservam originais, seleção e versões mais recentes',()=>{
 const d=makeDraft();d.data.lab=[lab({id:'old',revision:1}),lab({id:'new',revision:2}),lab({id:'other',stationId:'biologico'})];assert.deepEqual(effectiveReportData(d).lab.map(x=>x.id),['new']);d.selection.selectedLabIds=['old'];assert.deepEqual(effectiveReportData(d).lab.map(x=>x.id),['old']);assert.equal(d.data.lab.length,3);
});
test('volume documentado mantém sua unidade mesmo com base acumulada em outra unidade',()=>{
 const baseline={id:'base',meterId:'tratado',date:'2026-08-31',time:null,cumulative:v(20,'m³'),declaredIntervalVolume:null,source:{sourceId:source.id}};
 const reading={...baseline,id:'reading',date:'2026-09-02',cumulative:v(21,'m³'),declaredIntervalVolume:v(100,'L'),intervalStart:'2026-09-01',intervalEnd:'2026-09-02'};
 const interval=calculateMeterIntervals([reading],baseline).intervals[0];assert.equal(interval.volume,100);assert.equal(interval.unit,'L');assert.equal(interval.fromDate,'2026-09-01');
});
