import type { ReportValue, MeterReading, MeterInterval, ReportIssue, SupplyEvent, SupplyTotal, ClientReportDraft, ImportBatch, LabResult } from "./types.ts";
import { exactValue, convertReportValue, reportIssue, reportDate } from "./values.ts";
import { selectLatestLabRevisions } from "./import-lab.ts";
import {hasLabComparison} from './lab-history.ts';

export function summarizeValues(values:ReportValue[]):{count:number;mean:number|null;min:number|null;max:number|null}{
  const exact=values.filter(exactValue).map(v=>v.value);
  return {count:exact.length,mean:exact.length?exact.reduce((sum,v)=>sum+v,0)/exact.length:null,min:exact.length?Math.min(...exact):null,max:exact.length?Math.max(...exact):null};
}
export function calculateRemoval(inlet:ReportValue,outlet:ReportValue):number|null{
  if(!exactValue(inlet)||inlet.value<=0)return null;
  const compatible=convertReportValue(outlet,inlet.unit);
  return exactValue(compatible)?(inlet.value-compatible.value)/inlet.value*100:null;
}
export function confirmedCampaignRemoval(inlet:LabResult|undefined,outlet:LabResult|undefined,parameter:string,period:string,stationId:string):number|null{
 if(!inlet||!outlet||inlet.stationId!==stationId||outlet.stationId!==stationId||inlet.parameter!==parameter||outlet.parameter!==parameter||!reportDate(inlet.date)||inlet.date.slice(0,7)!==period||inlet.date!==outlet.date||!inlet.pointId||!outlet.pointId||inlet.pointId===outlet.pointId||!inlet.campaignId?.trim()||inlet.campaignId!==outlet.campaignId)return null;
 return calculateRemoval(inlet.value,outlet.value);
}
export function calculateMeterIntervals(readings:MeterReading[],baseline:MeterReading|null):{intervals:MeterInterval[];issues:ReportIssue[]}{
  const intervals:MeterInterval[]=[],issues:ReportIssue[]=[];
  const sorted=[...readings].sort((a,b)=>a.date.localeCompare(b.date)||(a.time??"").localeCompare(b.time??""));
  const previous=new Map<string,MeterReading>();if(baseline)previous.set(baseline.meterId,baseline);
  for(const reading of sorted){
    const before=previous.get(reading.meterId),declared=reading.declaredIntervalVolume;
    let volume:number|null=null,fromDate=before?.date??null,unit=before?.cumulative.unit||reading.cumulative.unit;
    if(declared&&exactValue(declared)&&reading.intervalStart&&reading.intervalEnd===reading.date&&reading.intervalStart<=reading.date){volume=declared.value;fromDate=reading.intervalStart;unit=declared.unit;}
    else if(before&&exactValue(before.cumulative)&&exactValue(reading.cumulative)){
      const value=convertReportValue(reading.cumulative,before.cumulative.unit);
      if(exactValue(value)&&before.date<=reading.date){volume=value.value-before.cumulative.value;if(volume<0){volume=null;issues.push(reportIssue("meter-reset","Leitura diminuiu: registre troca/reset e informe o volume validado.",[before.id,reading.id]));}}
      else issues.push(reportIssue("meter-incompatible","Unidades ou datas incompatíveis no hidrômetro.",[reading.id]));
    } else issues.push(reportIssue("meter-base-missing","Volume do primeiro intervalo indisponível: informe uma leitura anterior ou volume documentado.",[reading.id],"warning"));
    intervals.push({meterId:reading.meterId,fromDate,toDate:reading.date,volume,unit,sourceIds:[...(before?[before.id]:[]),reading.id]});
    if(exactValue(reading.cumulative))previous.set(reading.meterId,reading);
  }
  return {intervals,issues};
}
export function summarizeSupplies(events:SupplyEvent[]):SupplyTotal[]{
  const totals=new Map<string,SupplyTotal>();
  for(const event of events){if(!exactValue(event.quantity))continue;const key=JSON.stringify([event.product,event.kind,event.quantity.unit]);const total=totals.get(key)??{product:event.product,kind:event.kind,unit:event.quantity.unit,quantity:0,sourceIds:[]};total.quantity+=event.quantity.value;total.sourceIds.push(event.id);totals.set(key,total);}
  return [...totals.values()];
}
export function effectiveReportData(draft:ClientReportDraft):ImportBatch{
  const excluded=new Set([...draft.selection.excludedRecordIds,...draft.corrections.map(c=>c.originalId)]);
  const selected=new Set(draft.selection.selectedLabIds);
  const candidates=draft.data.lab.filter(r=>!excluded.has(r.id)&&r.stationId===draft.stationId&&(hasLabComparison(draft)?selected.has(r.id):selected.size?selected.has(r.id):r.date.slice(0,7)===draft.period));
  const lab=selectLatestLabRevisions(candidates).active;
  return {...draft.data,lab,operations:draft.data.operations.filter(r=>!excluded.has(r.id)&&r.stationId===draft.stationId),supplies:draft.data.supplies.filter(r=>!excluded.has(r.id)&&r.stationId===draft.stationId),meters:draft.data.meters.filter(r=>!excluded.has(r.id)),journal:draft.data.journal.filter(r=>!excluded.has(r.id))};
}
