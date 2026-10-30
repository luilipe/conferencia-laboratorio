import * as XLSX from "xlsx";
import type { ImportBatch, ImportContext, SourceInfo, ReportIssue } from "./types.ts";
import { emptyReportBatch, normalizeParameter, parseReportValue, reportDate, reportTime, reportIssue } from "./values.ts";

export const STANDARD_HEADERS: Record<string,string[]> = {
  Resultados:["id","labId","sampleNumber","revision","stationId","pointId","identification","company","date","time","publicationDate","parameter","raw","unit","reason","reference"],
  "Operação":["id","stationId","pointId","date","time","shift","treatment","parameter","raw","unit","reason","reference"],
  "Hidrômetros":["id","meterId","date","time","raw","unit","declaredIntervalVolume","intervalStart","intervalEnd","reason","reference"],
  Insumos:["id","stationId","date","kind","product","raw","unit","reason","reference"],
  "Diário":["id","date","shift","order","text","plantState","reason","reference"],
  Fontes:["reference","author","notes"],
};
export function buildStandardWorkbook(): XLSX.WorkBook {
  const workbook=XLSX.utils.book_new();
  for(const [name,header] of Object.entries(STANDARD_HEADERS)) XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([header]),name);
  return workbook;
}
export function validateManualBatch(batch: ImportBatch): ReportIssue[] {
  const issues:ReportIssue[]=[];
  for(const source of batch.sources) if(source.kind==="manual" && (!source.importedByUid || !source.name.trim())) issues.push(reportIssue("manual-source-incomplete","Entrada manual exige autoria e documento de referência.",[source.id]));
  for(const record of [...batch.lab,...batch.operations,...batch.meters,...batch.supplies,...batch.journal]) {
    const source=batch.sources.find(s=>s.id===record.source.sourceId);
    if(!source || (source.kind==="manual"&&(!record.source.authorUid || !record.source.reason?.trim()))) issues.push(reportIssue("manual-source-incomplete","Informe autor, motivo e documento de referência da entrada manual.",[record.id]));
  }
  return issues;
}
export function importStandardWorkbook(workbook: XLSX.WorkBook, source: SourceInfo, context: ImportContext): ImportBatch {
  const batch=emptyReportBatch(); batch.sources=[{...source,kind:"manual",adapterVersion:"standard-v1",importedByUid:context.actorUid}];
  let recognized=false;
  for(const [name,columns] of Object.entries(STANDARD_HEADERS)) {
    if(name==="Fontes" || !workbook.Sheets[name])continue;
    const sheet=workbook.Sheets[name];const rawRows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,range:0,defval:null});
    if(!rawRows[0] || !rawRows[0].some(h=>columns.includes(String(h))))throw new Error(`Cabeçalho inválido na aba ${name}.`);
    recognized=true;
    const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:null,raw:true});
    rows.forEach((row,offset)=>{
      const text=(key:string)=>String(row[key]??"").trim();
      if(!Object.values(row).some(v=>v!==null&&v!==""))return;
      const id=`${source.id}:manual:${name}:${text("id")||offset+2}`;
      const ref={sourceId:source.id,sheet:name,cell:`A${offset+2}`,authorUid:context.actorUid,reason:text("reference")&&text("reason")?`${text("reference")} — ${text("reason")}`:""};
      const date=reportDate(row.date); const value=parseReportValue(row.raw,text("unit"));
      const invalid=(message:string)=>batch.issues.push(reportIssue("manual-invalid",message,[id]));
      if(!date){invalid("Data ausente ou inválida na entrada manual.");return;}
      if(date.slice(0,7)!==context.period)batch.issues.push(reportIssue("outside-period","Registro manual fora da competência; confirme uso histórico.",[id],"warning"));
      if(name==="Resultados") {
        if(!text("labId")||!text("sampleNumber")||!text("parameter"))invalid("Identifique laboratório, amostra/laudo e parâmetro.");
        batch.lab.push({id,labId:text("labId"),sampleBase:text("sampleNumber").replace(/\.\d+$/,""),sampleNumber:text("sampleNumber"),revision:Number(row.revision??0),stationId:text("stationId")||null,pointId:text("pointId")||null,identification:text("identification"),company:text("company"),date,time:reportTime(row.time),publicationDate:reportDate(row.publicationDate),parameter:normalizeParameter(text("parameter")),value,source:ref});
      } else if(name==="Operação") {
        if(!text("pointId")||!text("parameter"))invalid("Informe ponto e parâmetro da medição.");
        batch.operations.push({id,stationId:text("stationId")||context.stationId||"",pointId:text("pointId"),date,time:reportTime(row.time),shift:text("shift")||null,treatment:text("treatment")||null,parameter:normalizeParameter(text("parameter")),value,source:ref});
      } else if(name==="Hidrômetros") {
        if(!text("meterId"))invalid("Identifique o hidrômetro.");
        batch.meters.push({id,meterId:text("meterId"),date,time:reportTime(row.time),cumulative:value,declaredIntervalVolume:row.declaredIntervalVolume==null?null:parseReportValue(row.declaredIntervalVolume,text("unit")),intervalStart:reportDate(row.intervalStart)??undefined,intervalEnd:reportDate(row.intervalEnd)??undefined,source:ref});
      } else if(name==="Insumos") {
        if(!["delivery","consumption"].includes(text("kind"))){invalid("Escolha entrega (delivery) ou consumo (consumption).");return;}
        if(!text("product"))invalid("Informe o produto.");
        batch.supplies.push({id,stationId:text("stationId")||context.stationId||"",date,kind:text("kind") as "delivery"|"consumption",product:text("product"),quantity:value,source:ref});
      } else if(name==="Diário") {
        if(!text("text")||!Number.isInteger(Number(row.order))||Number(row.order)<1||!["on","off","unknown"].includes(text("plantState"))){invalid("Informe texto, ordem positiva e estado on/off/unknown no diário.");return;}
        batch.journal.push({id,date,shift:text("shift")||"nao_informado",order:Number(row.order),text:text("text"),plantState:text("plantState") as "on"|"off"|"unknown",source:ref});
      }
    });
  }
  if(!recognized)throw new Error("Nenhuma aba padronizada encontrada.");
  batch.journal.sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift)||a.order-b.order);
  batch.issues.push(...validateManualBatch(batch));
  return batch;
}
