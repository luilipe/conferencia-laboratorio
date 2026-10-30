import type { ClientReportDraft, ImportBatch, ReportValue, SourceInfo, SourceRef } from "./types.ts";
import { reportIssue, reportDate } from "./values.ts";

export function mergeReportImport(draft:ClientReportDraft,batch:ImportBatch):ClientReportDraft{
  const next=structuredClone(draft),sourceIds=new Map<string,string>();
  for(const source of batch.sources){
    const existing=next.data.sources.find(s=>source.kind==='manual'?s.id===source.id:!!source.sha256&&s.sha256===source.sha256&&s.adapterVersion===source.adapterVersion);
    if(existing){sourceIds.set(source.id,existing.id);continue;}
    const id=next.data.sources.some(s=>s.id===source.id)?`${source.id}:${crypto.randomUUID()}`:source.id;
    sourceIds.set(source.id,id);next.data.sources.push({...source,id});
  }
  for(const group of ["lab","operations","meters","supplies","journal"] as const){
    const incoming=batch[group].filter(r=>sourceIds.has(r.source.sourceId));
    for(const row of incoming){const r=structuredClone(row);r.source.sourceId=sourceIds.get(row.source.sourceId)!;
      // Importers prefix IDs with the source ID. Canonicalize renamed copies of the same file.
      if(r.source.sourceId!==row.source.sourceId&&r.id.startsWith(`${row.source.sourceId}:`))r.id=r.source.sourceId+r.id.slice(row.source.sourceId.length);
      if(next.data[group].some(existing=>existing.id===r.id&&existing.source.sourceId===r.source.sourceId))continue;
      const comparable=(record:typeof r)=>{const copy=structuredClone(record);delete copy.source.externalRecordId;return JSON.stringify(copy);};
      if(next.data[group].some(existing=>comparable({...existing,id:r.id} as typeof r)===comparable(r)&&(existing.id===r.id||existing.id.startsWith(`${r.id}:conflict:`))))continue;
      const before=next.data[group].find(existing=>existing.id===r.id);
      if(before){if(JSON.stringify(before)===JSON.stringify(r))continue;const originalId=r.id;r.id=`${r.id}:conflict:${crypto.randomUUID()}`;next.data.issues.push(reportIssue("record-conflict","Duas leituras conflitantes foram preservadas. Confira as fontes e exclua ou corrija a leitura descartada.",[originalId,r.id]));}
      (next.data[group] as {id:string}[]).push(r);
    }
  }
  next.data.issues=[...new Map([...next.data.issues,...batch.issues].map(i=>[i.id,i])).values()];return next;
}
export function correctReportMetadata(draft:ClientReportDraft,recordId:string,fields:Record<string,string|null>,reason:string,actorUid:string,at:string):ClientReportDraft{
  const next=structuredClone(draft),group=(["lab","operations","meters","supplies","journal"] as const).find(g=>next.data[g].some(r=>r.id===recordId));
  if(!group)throw new Error("Registro não encontrado.");
  const original=next.data[group].find(r=>r.id===recordId)!;
  const allowed=["stationId","pointId","date","time","shift","treatment","parameter","meterId","kind","product","plantState","intervalStart","intervalEnd",...(group==='lab'?['campaignId']:[])];
  for(const [key,value] of Object.entries(fields)){if(!allowed.includes(key)||!(key in original)&&!["intervalStart","intervalEnd","campaignId"].includes(key))throw new Error("Campo não pertence ao registro.");if(key==="date"&&!reportDate(value))throw new Error("Data inválida.");if(key==='campaignId'&&!value?.trim())throw new Error('Informe a identificação documentada da campanha.');if(key==="kind"&&!["delivery","consumption"].includes(value??""))throw new Error("Tipo de evento inválido.");if(key==="plantState"&&!["on","off","unknown"].includes(value??""))throw new Error("Estado inválido.");}
  const id=crypto.randomUUID(),source=manualSource(original.source,next.data.sources,reason,actorUid,at,id);
  const dateMetadata=fields.date&&'datePrecision' in original?{datePrecision:'day' as const,collectionPeriod:fields.date.slice(0,7)}:{};
  const replacement={...original,...fields,...dateMetadata,id,source:source.ref};(next.data[group] as {id:string}[]).push(replacement);next.data.sources.push(source.info);
  next.selection.excludedRecordIds.push(recordId);next.corrections.push({originalId:recordId,replacementId:id,actorUid,at,reason:reason.trim()});
  if(next.selection.selectedLabIds.includes(recordId))next.selection.selectedLabIds.push(id);
  next.selection.efficiencyPairs=next.selection.efficiencyPairs.map(p=>({...p,inletId:p.inletId===recordId?id:p.inletId,outletId:p.outletId===recordId?id:p.outletId,declaredId:p.declaredId===recordId?id:p.declaredId}));return next;
}
function manualSource(original:SourceRef,sources:SourceInfo[],reason:string,actorUid:string,at:string,id:string):{info:SourceInfo;ref:SourceRef}{
  if(!reason.trim()||!actorUid.trim()||!Number.isFinite(Date.parse(at)))throw new Error("Correção exige autor, data e motivo.");
  const before=sources.find(s=>s.id===original.sourceId);if(!before)throw new Error("Fonte original não encontrada.");
  const sourceId=`manual:${id}`;return {info:{id:sourceId,name:`Correção referenciada em ${before.name}`,sha256:"",kind:"manual",size:0,importedAt:at,importedByUid:actorUid,adapterVersion:"manual-v1"},ref:{...original,sourceId,authorUid:actorUid,reason:`${before.name} — ${reason.trim()}`}};
}
export function correctReportValue(draft:ClientReportDraft,recordId:string,field:"value"|"quantity"|"cumulative"|"declaredIntervalVolume",replacement:ReportValue,reason:string,actorUid:string,at:string):ClientReportDraft{
  if(!reason.trim())throw new Error("Informe o motivo da correção.");
  const next=structuredClone(draft),group=["lab","operations","meters","supplies"] as const;
  const found=group.find(g=>next.data[g].some(r=>r.id===recordId));if(!found)throw new Error("Registro não encontrado.");
  const original=next.data[found].find(r=>r.id===recordId)!;
  if(!(field in original))throw new Error("Campo não pertence a este registro.");
  const id=crypto.randomUUID(),source=manualSource(original.source,next.data.sources,reason,actorUid,at,id);
  const record={...original,id,[field]:structuredClone(replacement),source:source.ref};(next.data[found] as {id:string}[]).push(record);next.data.sources.push(source.info);
  next.selection.excludedRecordIds.push(recordId);next.corrections.push({originalId:recordId,replacementId:id,actorUid,at,reason:reason.trim()});
  if(next.selection.selectedLabIds.includes(recordId))next.selection.selectedLabIds.push(id);
  next.selection.efficiencyPairs=next.selection.efficiencyPairs.map(p=>({...p,inletId:p.inletId===recordId?id:p.inletId,outletId:p.outletId===recordId?id:p.outletId,declaredId:p.declaredId===recordId?id:p.declaredId}));
  return next;
}
export function correctJournalText(draft:ClientReportDraft,recordId:string,text:string,reason:string,actorUid:string,at:string):ClientReportDraft{
  if(!text.trim())throw new Error("Informe o texto revisado.");const next=structuredClone(draft),original=next.data.journal.find(r=>r.id===recordId);if(!original)throw new Error("Ocorrência não encontrada.");
  const id=crypto.randomUUID(),source=manualSource(original.source,next.data.sources,reason,actorUid,at,id);next.data.journal.push({...original,id,text:text.trim(),source:source.ref});next.data.sources.push(source.info);next.selection.excludedRecordIds.push(recordId);next.corrections.push({originalId:recordId,replacementId:id,actorUid,at,reason:reason.trim()});return next;
}
export function excludeReportRecord(draft:ClientReportDraft,recordId:string,reason:string,actorUid:string):ClientReportDraft{
  if(!reason.trim()||!actorUid.trim())throw new Error("Exclusão exige autor e motivo.");const next=structuredClone(draft);if(!next.selection.excludedRecordIds.includes(recordId))next.selection.excludedRecordIds.push(recordId);next.acknowledgements[`exclude:${recordId}`]={actorUid,reason:reason.trim()};return next;
}
