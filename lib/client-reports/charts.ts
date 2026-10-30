import type {ClientReportDraft,ReportPreset,ReportChart,ReportChartDefinition,PreparedChart,LabResult,OperationReading} from './types.ts';
import {hasLabComparison,labHistoryMonths} from './lab-history.ts';
import {reportDate} from './values.ts';
import {effectiveReportData,calculateRemoval,calculateMeterIntervals} from './calculations.ts';
import {convertReportValue,exactValue,normalizeUnit,normalizeParameter,formatReportValue,formatReportNumber,displayReportDate,isUnitlessReportParameter} from './values.ts';
type Point=ReportChart['series'][number]['points'][number];
const days=(period:string)=>Array.from({length:new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).getUTCDate()},(_,i)=>`${period}-${String(i+1).padStart(2,'0')}`);
const canonicalUnit=(u:string)=>normalizeUnit(u)==='µg/L'?'mg/L':normalizeUnit(u);
const unitKey=(u:string)=>encodeURIComponent(u||'adimensional');
export function buildReportCharts(draft:ClientReportDraft,preset:ReportPreset,sectionId:string):ReportChart[]{
 const data=effectiveReportData(draft),source=({laboratory:'laboratory',operations:'operations',efficiency:'efficiency',meters:'meters'} as Record<string,ReportChartDefinition['source']>)[sectionId];
 if(!source)return [];
 const definitions=(preset.chartDefinitions??[]).filter(d=>d.source===source&&(!d.optional||draft.selection.optionalChartIds?.includes(d.id)));
 if(draft.clientId==='demo09'&&source==='operations')for(const parameter of [...new Set(data.operations.filter(r=>r.date.startsWith(draft.period)).map(r=>r.parameter))].sort())definitions.push({id:`demo09-operation-${parameter}`,title:`Controle ${parameter} — consolidado visível`,kind:'bar',source:'operations',parameter,unit:null,pointIds:preset.points.map(p=>p.id),optional:false});
 const results:ReportChart[]=[];
 for(const def of definitions){
  if(def.source==='efficiency'){
   const calculated:Point[]=[],declared:Point[]=[];let occurrence=0;
   for(const pair of draft.selection.efficiencyPairs.filter(p=>p.parameter===def.parameter)){
    const inlet=data.lab.find(r=>r.id===pair.inletId),outlet=data.lab.find(r=>r.id===pair.outletId),stated=data.lab.find(r=>r.id===pair.declaredId);
    if(!inlet||!outlet||!inlet.date.startsWith(draft.period)||!outlet.date.startsWith(draft.period))continue;
    const valid=(!hasLabComparison(draft)||!!reportDate(inlet.date)&&!!reportDate(outlet.date)&&!!inlet.pointId&&!!outlet.pointId)&&inlet.date===outlet.date&&inlet.pointId!==outlet.pointId&&inlet.parameter===def.parameter&&outlet.parameter===def.parameter;
    const key=`${inlet.date}|${inlet.time??''}|${occurrence++}`,label=`${displayReportDate(inlet.date)} ${inlet.time??''} · ${inlet.pointId} → ${outlet.pointId} · campanha ${occurrence}`;
    calculated.push({date:inlet.date,key,label,time:inlet.time,value:valid?calculateRemoval(inlet.value,outlet.value):null,sourceIds:[inlet.id,outlet.id]});
    declared.push({date:inlet.date,key,label,time:inlet.time,value:stated&&stated.date===inlet.date&&stated.value.unit==='%'&&exactValue(stated.value)?stated.value.value:null,sourceIds:stated?[stated.id]:[]});
   }
   results.push({id:def.id,title:def.title,unit:'%',kind:'bar',xMode:'category',series:[{id:'calculated',label:'Calculada',points:calculated},{id:'declared',label:'Declarada',points:declared}]});continue;
  }
  if(def.source==='meters'){
   const intervals=def.pointIds.flatMap(id=>calculateMeterIntervals(data.meters.filter(r=>r.meterId===id&&r.date.startsWith(draft.period)),draft.selection.meterBaselines[id]??null).intervals);
   const units=[...new Set(intervals.map(i=>canonicalUnit(i.unit)))].sort();if(!units.length)units.push(def.unit??'');
   for(const unit of units){results.push({id:def.id+(units.length>1&&unit!==def.unit?`-${unitKey(unit)}`:''),title:def.title,unit,kind:'bar',xMode:'category',xLabel:'Intervalo comprovado (sem distribuição diária)',series:def.pointIds.map(id=>({id,label:id,points:intervals.filter(i=>i.meterId===id&&canonicalUnit(i.unit)===unit).map(i=>{const converted=convertReportValue({raw:'',value:i.volume,operator:'=',qualitative:null,unit:i.unit,originalUnit:i.unit,status:i.volume===null?'missing':'measured'},unit);return {date:i.toDate,key:`${i.fromDate??'sem base'}|${i.toDate}`,label:`${i.fromDate?displayReportDate(i.fromDate):'Sem base'} a ${displayReportDate(i.toDate)}`,value:exactValue(converted)?converted.value:null,sourceIds:i.sourceIds};})}))});}continue;
  }
  const history=hasLabComparison(draft)&&def.source==='laboratory',months=history?labHistoryMonths(draft.period,draft.selection.labComparison!.previousMonths):[draft.period];
  const records:(LabResult|OperationReading)[]=(def.source==='laboratory'?data.lab:data.operations).filter(r=>(history?!!reportDate(r.date)&&months.includes(r.date.slice(0,7)):r.date.startsWith(draft.period))&&normalizeParameter(r.parameter)===def.parameter&&def.pointIds.includes(r.pointId??''));
  // Approved conversions only. Incompatible dimensions are separate, never assigned to the first row's unit.
  const unitFor=(r:LabResult|OperationReading)=>def.unit!==null&&convertReportValue({...r.value,value:r.value.value??0},def.unit).status!=='invalid'?def.unit:canonicalUnit(r.value.unit);
  const units=[...new Set(records.map(unitFor))].sort();if(!units.length)units.push(def.unit??'');
  for(const unit of units){
   const group=records.filter(r=>unitFor(r)===unit).sort((a,b)=>a.date.localeCompare(b.date)||(a.time??'').localeCompare(b.time??''));
   const category=group.some(r=>('treatment' in r&&r.treatment)||(!r.time&&'shift' in r&&r.shift));
   let repeated=false;
   const series=def.pointIds.map(id=>{
    const counts=new Map<string,number>(),points:Point[]=[];
    for(const r of group.filter(r=>r.pointId===id)){
     const shift='shift' in r?r.shift:null,treatment='treatment' in r?r.treatment:null,base=`${r.date}|${r.time??''}|${shift??''}|${treatment??''}`,occ=counts.get(base)??0;counts.set(base,occ+1);if(occ)repeated=true;
     const value=convertReportValue(r.value,unit);
     points.push({date:r.date,key:`${base}|${occ}`,label:[displayReportDate(r.date),r.time,shift,treatment?`tratamento ${treatment}`:null,occ?`repetição ${occ+1}`:null].filter(Boolean).join(' · '),value:exactValue(value)&&(!!unit||isUnitlessReportParameter(def.parameter))?value.value:null,time:r.time,shift,treatment,sourceIds:[r.id],displayValue:formatReportValue(r.value,history?'source':undefined)+(r.value.unit!==unit?` → ${formatReportValue(value)}`:'')});
    }
    return {id,label:preset.points.find(p=>p.id===id)?.label??id,points};
   });
   const xMode:ReportChart['xMode']=category||repeated?'category':group.some(r=>r.time)?'date-time':'date';
   const slots=new Map<string,Point>();for(const s of series)for(const p of s.points)slots.set(p.key!,p);
   for(const date of months.flatMap(days))if(![...slots.values()].some(p=>p.date===date))slots.set(`${date}||||0`,{date,key:`${date}||||0`,label:displayReportDate(date),value:null,sourceIds:[]});
   const sorted=[...slots.values()].sort((a,b)=>a.key!.localeCompare(b.key!));
   for(const s of series){const own=new Map(s.points.map(p=>[p.key,p]));s.points=sorted.map(p=>own.get(p.key)??{...p,value:null,sourceIds:[],displayValue:'Sem medição'});}
   const chart:ReportChart={id:def.id+(units.length>1&&unit!==def.unit?`-${unitKey(unit)}`:''),title:def.title+(units.length>1?` (${unit||'adimensional'} — unidade separada)`:''),unit,kind:def.kind,xMode,xLabel:xMode==='category'?'Data / horário / turno / tratamento / repetição':'Data e horário da medição',series};
   for(const ref of draft.references.filter(r=>r.approvedByUid&&r.parameter===def.parameter&&def.pointIds.includes(r.pointId)&&r.unit===unit))for(const [bound,value] of [['min',ref.min],['max',ref.max]] as const)if(value!==null)chart.series.push({id:`reference-${ref.id}-${bound}`,label:`Referência ${ref.pointId}: ${ref.source} (${bound})`,reference:true,points:sorted.map(p=>({...p,value,sourceIds:[ref.id]}))});
   results.push(chart);
  }
 }return results;
}
function keyed(chart:ReportChart){return chart.series.map((s,i)=>{const seen=new Map<string,number>();return {...s,id:s.id??`${s.label}-${i}`,points:s.points.map(p=>{const n=seen.get(p.date)??0;seen.set(p.date,n+1);return {...p,key:p.key??`${p.date}|${n}`,label:p.label??p.date};})};});}
export function prepareReportChart(chart:ReportChart):PreparedChart{
 const series=keyed(chart),map=new Map<string,{key:string;label:string;position:number}>();
 for(const s of series)for(const p of s.points)if(!map.has(p.key)){const timestamp=Date.parse(`${p.date}T${p.time??'00:00'}:00Z`);map.set(p.key,{key:p.key,label:p.label,position:Number.isFinite(timestamp)?timestamp:map.size});}
 const slots=[...map.values()].sort((a,b)=>a.key.localeCompare(b.key));if(chart.xMode==='category'||!chart.xMode)slots.forEach((s,i)=>s.position=i);
 const values=series.flatMap(s=>s.points.flatMap(p=>p.value===null?[]:[p.value])),kind=chart.kind??'line';let min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1;
 if(kind==='bar'){min=Math.min(0,min);max=Math.max(0,max);}if(min===max){min-=min===0?0:Math.max(1,Math.abs(min)*.05);max+=Math.max(1,Math.abs(max)*.05);}const pad=(max-min)*.05;if(kind==='line'){min-=pad;max+=pad;}
 return {kind,xMode:chart.xMode??'category',slots,min,max,series:series.map(s=>{const points=new Map(s.points.map(p=>[p.key,p]));return {id:s.id,label:s.label,reference:s.reference??false,values:slots.map(slot=>points.get(slot.key)?.value??null),sourceIds:slots.map(slot=>points.get(slot.key)?.sourceIds??[])};})};
}
export function reportChartTable(chart:ReportChart):{columns:string[];rows:string[][]}{
 const prepared=prepareReportChart(chart),series=keyed(chart);
 return {columns:[chart.xLabel??'Data ou intervalo',...series.map(s=>s.label),'Unidade','Origem (IDs)'],rows:prepared.slots.map((slot,i)=>[slot.label,...series.map(s=>{const p=s.points.find(p=>p.key===slot.key);return p?.displayValue??formatReportNumber(p?.value??null);}),chart.unit,prepared.series.flatMap(s=>s.sourceIds[i]).join('; ')])};
}
