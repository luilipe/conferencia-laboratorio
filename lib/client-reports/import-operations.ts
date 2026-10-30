import * as XLSX from "xlsx";
import type { ImportBatch, ImportContext, SourceInfo, ReportValue } from "./types.ts";
import { emptyReportBatch, normalizeParameter, parseReportValue, reportDate, reportTime, reportIssue, exactValue, isUnitlessReportParameter } from "./values.ts";

export type OperationProfile = "demo24-monitoramento" | "demo24-polidora" | "hospital" | "demo09-diario" | "demo09-eficiencia" | "demo13-history";
const clean = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g," ");
const str = (x: unknown) => String(x ?? "").trim();
const months = ["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
export function workbookPeriod(rows: unknown[][]): string | null {
  for (const row of rows.slice(0,10)) for (const cell of row) { const m = clean(cell).match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:\/|de|\s)\s*(20\d{2})/); if (m) return `${m[2]}-${String(months.indexOf(m[1])+1).padStart(2,"0")}`; }
  return null;
}
function dateInPeriod(raw: unknown, period: string): string | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 31) return reportDate(`${period}-${String(raw).padStart(2,"0")}`);
  return reportDate(raw);
}
function unitInHeader(header: unknown): string {
  const m = str(header).match(/(?:mg\/L|[mM][lL]\/[lL]|µg\/L|µS\/cm|mS\/cm|kg|ppm|m³|IBC|saco|\bL\b|°C|ºC)/i);
  return m?.[0] ?? "";
}
function excelValue(sheet: XLSX.WorkSheet, row: number, col: number, unit: string): ReportValue {
  const cell = sheet[XLSX.utils.encode_cell({r:row,c:col})];
  return parseReportValue(cell?.t === "e" ? cell.w || "#ERRO!" : cell?.f && cell.v == null ? "#SEM_VALOR_CALCULADO!" : cell?.v, unit);
}
const pointCodes: Record<string,string> = { "elevatoria 3":"elevatoria-3", "decantador 01":"decantador-1", "decantador 02":"decantador-2", "equalizado":"equalizado", "tanque anaerobio":"anaerobio", "saida tratado":"tratado", "elevatoria":"elevatoria", "reator anaerobico":"reator-1", "reator aerobico":"reator-2", "decantador":"decantador", "lancamento":"lancamento" };
pointCodes["elevatoria3"]="elevatoria-3";
function operationalParameter(header: unknown): string | null {
  const h=clean(header);
  if (/^ph\b/.test(h)) return "pH";
  if (/^ss\s*30/.test(h)) return "SS30";
  if (/^ss\s*60/.test(h)) return "SS60";
  if (/^temperatura/.test(h)) return "Temperatura";
  if (/^condutividade/.test(h)) return "Condutividade";
  if (/^cloro\b/.test(h)) return "Cloro";
  if (/^od\b/.test(h)) return "OD";
  if (/^std\b/.test(h)) return "STD";
  if (/^larvas/.test(h)) return "Larvas";
  if (/^espuma/.test(h)) return "Espuma";
  return null;
}
export function importOperationsWorkbook(profile: OperationProfile, workbook: XLSX.WorkBook, source: SourceInfo, context: ImportContext): ImportBatch {
  const batch=emptyReportBatch();batch.sources=[{...source,importedByUid:context.actorUid,adapterVersion:`${profile}-v1:${context.period}`}];
  let matched=false;
  for (const name of workbook.SheetNames) {
    const hidden=workbook.Workbook?.Sheets?.find(s=>s.name===name)?.Hidden;
    if (context.selectedSheets && !context.selectedSheets.includes(name)) continue;
    if (hidden && !context.selectedSheets?.includes(name)) continue;
    if (profile==="hospital" && !/^\d{1,2}$/.test(name)) continue;
    if (profile==="demo09-diario" && clean(name)!=="mensal") continue;
    const sheet=workbook.Sheets[name]; const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,range:0,defval:null,raw:true});
    const foundPeriod=workbookPeriod(rows);
    if (foundPeriod && context.period && foundPeriod!==context.period && profile!=="demo13-history") throw new Error(`O período encontrado (${foundPeriod}) difere da competência selecionada.`);
    const origin=(r:number,c:number)=>({sourceId:source.id,sheet:name,cell:XLSX.utils.encode_cell({r,c})});
    const id=(kind:string,r:number,c:number)=>`${source.id}:${profile}:${name}:${kind}:${r}:${c}`;
    const checkValue=(value:ReportValue,recordId:string,parameter:string)=>{
      if (value.status==="invalid") batch.issues.push(reportIssue("operation-invalid","Erro ou fórmula sem valor calculado na origem.",[recordId]));
      if (!value.unit && !isUnitlessReportParameter(parameter)) batch.issues.push(reportIssue("unit-missing",`Confirme a unidade de ${parameter}.`,[recordId]));
    };
    if (profile.startsWith("demo24-")) {
      const polidora=profile==="demo24-polidora";
      const headerRow=rows.findIndex(row=>row.some(c=>clean(c)==="data") && (polidora || row.some(c=>/^ph final/.test(clean(c)))));
      const phRow=polidora ? rows.findIndex(row=>row.some(c=>/^ph\b/.test(clean(c)))) : headerRow;
      if (headerRow<0 || phRow<0) continue;
      const header=rows[headerRow]; const dates=header.flatMap((c,i)=>clean(c)==="data"?[i]:[]); const dateCol=dates[0];
      const phCol=rows[phRow].findIndex(c=>polidora?/^ph\b/.test(clean(c)):/^ph final/.test(clean(c)));
      const timeCol=header.findIndex(c=>/horario|operador|hora/.test(clean(c)));
      const treatmentCol=header.findIndex(c=>clean(c)==="tratamento");
      const lateralRow=polidora ? rows.findIndex(row=>row.some(c=>clean(c)==="data")&&row.some(c=>/^pac\b/.test(clean(c)))) : headerRow;
      const lateral=rows[lateralRow] ?? [];
      const sideDate=polidora ? lateral.findIndex((c,i)=>clean(c)==="data"&&i>phCol) : dateCol;
      const supplyCols=lateral.flatMap((c,i)=>/^(pac|polimero|sulfato|aluminato|in\.|cloro$|pastilha)/.test(clean(c)) && i>phCol ? [i] : []);
      const start=Math.max(headerRow,phRow,lateralRow)+1;
      for(let r=start;r<rows.length;r++) {
        const row=rows[r]; const date=dateInPeriod(row[dateCol],context.period);
        if (/total|media/.test(clean(row[dateCol]))) {batch.issues.push(reportIssue("declared-total",`Agregado declarado em ${name}: ${row.map(str).join(" | ")}`,[],"warning"));continue;}
        if (date && row[phCol]!=null) {
          const recordId=id("operation",r,phCol), value=excelValue(sheet,r,phCol,"");
          batch.operations.push({id:recordId,stationId:context.stationId ?? "combined",pointId:polidora?"polidora":"esmaltacao",date,time:reportTime(row[timeCol] ?? row[1]),shift:null,treatment:treatmentCol>=0?str(row[treatmentCol])||null:null,parameter:"pH",value,source:origin(r,phCol)}); checkValue(value,recordId,"pH");
          if (!polidora) for(const [c,h] of header.entries()) if ((/^ph inicial|^ph reserv|^ph rede|^ss\s*(30|60)/).test(clean(h)) && row[c]!=null) {
            const parameter=normalizeParameter(str(h)), rid=id("operation",r,c), v=excelValue(sheet,r,c,unitInHeader(h));
            batch.operations.push({id:rid,stationId:context.stationId ?? "combined",pointId:"esmaltacao",date,time:reportTime(row[timeCol]),shift:null,treatment:treatmentCol>=0?str(row[treatmentCol])||null:null,parameter,value:v,source:origin(r,c)});checkValue(v,rid,parameter);
          }
          const pressCol=polidora?rows.find(row=>row.some(c=>clean(c)==="prensagem"))?.findIndex(c=>clean(c)==="prensagem"):header.findIndex(c=>clean(c)==="prensadas");
          if(pressCol!=null&&pressCol>=0&&row[pressCol]!=null){const rid=id("operation",r,pressCol);batch.operations.push({id:rid,stationId:context.stationId??"combined",pointId:polidora?"polidora":"esmaltacao",date,time:reportTime(row[timeCol]??row[1]),shift:null,treatment:null,parameter:"Prensadas",value:excelValue(sheet,r,pressCol,"prensa"),source:origin(r,pressCol)});}
        }
        const supplyDate=dateInPeriod(row[sideDate],context.period);
        for(const c of supplyCols) if(row[c]!=null&&supplyDate){
          const rawHeader = str(lateral[c]);
          const rid=id("supply",r,c), quantity=excelValue(sheet,r,c,unitInHeader(lateral[c]));
          batch.supplies.push({id:rid,stationId:context.stationId??"combined",date:supplyDate,kind:"consumption",product:rawHeader.replace(/\s*\([^)]*\)/g,""),quantity,source:origin(r,c)});
          checkValue(quantity,rid,rawHeader);
        }
      }
      matched=true;
    } else if (profile==="hospital" || profile==="demo09-diario") {
      const hr=rows.findIndex(row=>row.some(c=>/^ph\b/.test(clean(c))) && row.some(c=>/horario|dia|^ph\b/.test(clean(c))));
      if(hr<0) continue;
      const parameterCols=rows[hr].flatMap((h,c)=>operationalParameter(h)?[c]:[]);
      const labels=rows[hr-1]??[];const anchors=labels.flatMap((l,c)=>pointCodes[clean(l)]?[{c,id:pointCodes[clean(l)]}]:[]);
      if(!anchors.length) throw new Error("Cabeçalho de pontos não reconhecido; use entrada padronizada.");
      for(let r=hr+1;r<rows.length;r++) {
        const row=rows[r]; const shift=clean(row[0]).includes("tarde")?"tarde":/manha|manhã/.test(clean(row[0]))?"manhã":null;
        if(profile==="hospital"&&!shift)continue;
        const date=profile==="hospital"?dateInPeriod(Number(name),context.period):dateInPeriod(row[0],context.period);
        if(!date)continue;
        for(const c of parameterCols){
          const anchor=anchors.filter(a=>a.c<=c).at(-1)??anchors[0];
          const parameter=operationalParameter(rows[hr][c])!;
          const decantador=anchors.find(a=>a.id==="decantador");
          const columnDate=profile==="demo09-diario"&&decantador&&c>=decantador.c ? dateInPeriod(row[decantador.c-1],context.period)??date:date;
          const rid=id("operation",r,c), value=excelValue(sheet,r,c,unitInHeader(rows[hr][c]));
          if(value.status==="missing" && profile==="demo09-diario" && !row.some((x,i)=>parameterCols.includes(i)&&x!=null)) continue;
          batch.operations.push({id:rid,stationId:context.stationId??"ete",pointId:anchor.id,date:columnDate,time:null,shift,treatment:null,parameter,value,source:origin(r,c)});checkValue(value,rid,parameter);
        }
      }
      matched=true;
      if(profile==="hospital")batch.issues.push(reportIssue("source-period-confirm","Confirme o mês das abas diárias; as abas identificam o dia.",[],"warning"));
    } else if(profile==="demo09-eficiencia") {
      const parameterRow=rows.findIndex(row=>row.some(c=>clean(c)==="dbo")&&row.some(c=>clean(c)==="dqo"));if(parameterRow<0)continue;
      for(const parameter of ["DBO","DQO"]){const start=rows[parameterRow].findIndex(c=>clean(c)===parameter.toLowerCase());const header=rows[parameterRow+1]??[];const next=parameter==="DBO"?rows[parameterRow].findIndex(c=>clean(c)==="dqo"):header.length;const columns=header.flatMap((h,c)=>c>=start&&c<next&&/equalizado|decantador|eficiencia/.test(clean(h))?[c]:[]);
        for(let r=parameterRow+2;r<rows.length;r++){const date=reportDate(rows[r][start]);if(!date)continue;for(const c of columns){const efficiency=clean(header[c])==="eficiencia";batch.lab.push({id:id("lab",r,c),labId:"operacional",sampleBase:`${source.id}:${date}:${parameter}:${c}`,revision:0,sampleNumber:"Controle operacional de eficiência",stationId:context.stationId??"ete",pointId:clean(header[c])==="equalizado"?"bruto":"tratado",identification:str(header[c]),company:"",date,time:null,publicationDate:null,parameter:efficiency?`Eficiência ${parameter}`:parameter,value:excelValue(sheet,r,c,efficiency?"%":"mg/L"),source:origin(r,c)});}}
      }matched=true;
    } else if(profile==="demo13-history") {
      const hr=rows.findIndex(row=>clean(row[0])==="parametros"&&clean(row[1])==="unidade");if(hr<0)continue;
      const block=rows[hr-1]??[];const stations=clean(name).includes("bio")?"biologico":"etdi";
      const limit=new Date(`${context.period}-01T00:00:00Z`);limit.setUTCMonth(limit.getUTCMonth()-2);const min=limit.toISOString().slice(0,7);
      for(let c=2;c<rows[hr].length;c++){const date=reportDate(rows[hr][c]);if(!date||date.slice(0,7)<min||date.slice(0,7)>context.period)continue;let label="";for(let k=c;k>=0;k--)if(/resultados.*(bruto|tratado)/.test(clean(block[k]))){label=clean(block[k]);break;}if(!label)continue;
        for(let r=hr+1;r<rows.length;r++){if(!str(rows[r][0])||rows[r][c]==null)continue;batch.lab.push({id:id("history",r,c),labId:"historico",sampleBase:`${source.id}:${name}:${c}`,revision:0,sampleNumber:"Histórico informado",stationId:stations,pointId:label.includes("tratado")?"tratado":"bruto",identification:label,company:"",date,time:null,publicationDate:null,parameter:normalizeParameter(str(rows[r][0])),value:excelValue(sheet,r,c,str(rows[r][1])),source:origin(r,c)});}}
      matched=true;
    }
  }
  if(!matched)throw new Error("Cabeçalho, abas ou blocos não reconhecidos para o perfil escolhido. Use a planilha padronizada.");
  if(profile==="hospital"){
    let compared=0;
    for(const name of workbook.SheetNames.filter(n=>clean(n)==="mensal")){
      const sheet=workbook.Sheets[name],rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,range:0,defval:null,raw:true}),hr=rows.findIndex(row=>row.some(c=>/^ph\b/.test(clean(c))));if(hr<0)continue;
      const anchors=(rows[hr-1]??[]).flatMap((label,c)=>pointCodes[clean(label)]?[{c,id:pointCodes[clean(label)]}]:[]);if(!anchors.length)continue;
      for(let r=hr+1;r<rows.length;r++){const date=dateInPeriod(rows[r][0],context.period);if(!date)continue;for(let c=1;c<rows[hr].length;c++){
        const parameter=operationalParameter(rows[hr][c]),anchor=anchors.filter(a=>a.c<=c).at(-1)??anchors[0];if(!parameter||rows[r][c]==null)continue;
        const declared=excelValue(sheet,r,c,unitInHeader(rows[hr][c])),readings=batch.operations.filter(v=>v.date===date&&v.pointId===anchor.id&&v.parameter===parameter);
        if(!readings.length||!exactValue(declared))continue;
        if(readings.some(v=>!exactValue(v.value))){batch.issues.push(reportIssue("consolidated-unavailable",`Consolidado ${name}!${XLSX.utils.encode_cell({r,c})}: média diária indisponível por ausência/erro; sem substituição por zero.`,readings.map(v=>v.id),"warning"));continue;}
        const values=readings.map(v=>v.value.value!),mean=values.reduce((a,b)=>a+b,0)/values.length;compared++;
        if(Math.abs(mean-declared.value)>1e-6)batch.issues.push(reportIssue("consolidated-divergence",`Consolidado ${name}!${XLSX.utils.encode_cell({r,c})} / ${date} / ${anchor.id} / ${parameter}: declarado ${declared.raw}; média das abas diárias ${mean}. Fontes diárias mantidas.`,readings.map(v=>v.id),"warning"));
      }}
    }
    batch.sources[0].verificationNotes=[`${compared} valores numéricos do consolidado comparados com médias das abas diárias; o consolidado não foi importado como novas medições.`];
  }
  return batch;
}
