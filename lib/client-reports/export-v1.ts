import type { ReportDocument, ClientReportDraft, ReportChart } from "./types.ts";
import type { CellObject } from "xlsx";
import { effectiveReportData, calculateMeterIntervals, calculateRemoval, summarizeSupplies, summarizeValues } from "./calculations.ts";
import { formatReportNumber } from "./values.ts";

function assertRenderer(content:ReportDocument):void {if(content.rendererVersion!=="1")throw new Error("Esta versão do renderizador não está disponível. Abra o relatório com o aplicativo compatível.");}
export function reportFileName(content:ReportDocument,extension:"docx"|"pdf"|"xlsx"):string{
  return `${content.clientId}_${content.stationId}_${content.period}_v${content.revision}${content.mode==="draft"?"_RASCUNHO":""}.${extension}`.replace(/[^a-zA-Z0-9_.-]/g,"_");
}
export function renderReportChart(chart:ReportChart):string {
  if(typeof globalThis.document==="undefined")throw new Error("Gráficos são gerados no navegador. Use documento sem gráficos nos testes Node.");
  const canvas=globalThis.document.createElement("canvas");canvas.width=1200;canvas.height=460;
  const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Não foi possível desenhar o gráfico.");
  ctx.fillStyle="#fff";ctx.fillRect(0,0,1200,460);ctx.font="22px Arial";ctx.fillStyle="#183b3b";ctx.fillText(chart.title,80,30);
  const labels=[...new Set(chart.series.flatMap(s=>s.points.map(p=>p.date)))].sort();
  const values=chart.series.flatMap(s=>s.points.flatMap(p=>p.value===null?[]:[p.value]));
  const low=values.length?Math.min(0,...values):0,high=values.length?Math.max(1,...values):1,range=high-low||1;
  const left=90,right=1160,top=65,bottom=360;
  ctx.font="16px Arial";
  for(let i=0;i<=4;i++){const y=bottom-i/4*(bottom-top);ctx.strokeStyle="#e2e9e9";ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle="#42585a";ctx.fillText(formatReportNumber(low+range*i/4),5,y+5);}
  const colors=["#137c83","#db7d27","#645ac7","#a54368","#247744"];
  const xFor=(date:string)=>left+(labels.indexOf(date)/Math.max(1,labels.length-1))*(right-left);
  chart.series.forEach((series,index)=>{
    ctx.strokeStyle=colors[index%colors.length];ctx.lineWidth=3;let connected=false;ctx.beginPath();
    for(const point of series.points){if(point.value===null){connected=false;continue;}const x=xFor(point.date),y=bottom-(point.value-low)/range*(bottom-top);if(connected)ctx.lineTo(x,y);else ctx.moveTo(x,y);connected=true;}
    ctx.stroke();for(const point of series.points){if(point.value===null)continue;ctx.fillStyle=colors[index%colors.length];ctx.beginPath();ctx.arc(xFor(point.date),bottom-(point.value-low)/range*(bottom-top),4,0,2*Math.PI);ctx.fill();}
    ctx.fillStyle=colors[index%colors.length];ctx.font="16px Arial";ctx.fillText(series.label,90+index*210,440);
  });
  ctx.fillStyle="#42585a";ctx.font="14px Arial";for(let i=0;i<5&&labels.length;i++){const idx=Math.round(i*(labels.length-1)/4);ctx.fillText(labels[idx],Math.max(80,xFor(labels[idx])-40),390,185);}
  ctx.fillText(chart.unit||"Adimensional",10,55);if(!values.length)ctx.fillText("Sem dados numéricos selecionados",430,205);
  return canvas.toDataURL("image/png");
}
export function reportChartTable(chart:ReportChart):{columns:string[];rows:string[][]}{
  const dates=[...new Set(chart.series.flatMap(s=>s.points.map(p=>p.date)))].sort();
  return {columns:["Data ou intervalo",...chart.series.map(s=>s.label),"Unidade"],rows:dates.flatMap(date=>{const points=chart.series.map(s=>s.points.filter(p=>p.date===date));return Array.from({length:Math.max(1,...points.map(p=>p.length))},(_,index)=>[date,...points.map(p=>formatReportNumber(p[index]?.value??null)),chart.unit]);})};
}
export async function exportReportDocx(content:ReportDocument):Promise<Blob>{
  assertRenderer(content);
  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,Header,Footer,PageNumber,PageOrientation,WidthType,HeadingLevel,ImageRun,SectionType}=await import("docx");
  const paragraph=(text:string,bold=false)=>new Paragraph({children:[new TextRun({text,bold,font:"Arial",size:22})],spacing:{after:120},widowControl:true});
  const makeTable=(columns:string[],rows:string[][])=>new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[columns,...rows].map((row,index)=>new TableRow({tableHeader:index===0,cantSplit:true,children:row.map(value=>new TableCell({width:{size:100/columns.length,type:WidthType.PERCENTAGE},shading:index===0?{fill:"E9F2F2"}:undefined,margins:{top:90,bottom:90,left:90,right:90},children:[new Paragraph({children:[new TextRun({text:value,font:"Arial",size:18,bold:index===0})],spacing:{after:0}})]}))}))});
  const doc=new Document({creator:"Ouro Fino",title:`Relatório mensal ${content.identity.clientDisplayName}`,styles:{default:{document:{run:{font:"Arial",size:22,color:"000000"},paragraph:{spacing:{after:120}}}}},sections:content.sections.map((section,index)=>{
    const children:(InstanceType<typeof Paragraph>|InstanceType<typeof Table>)[]=[];
    if(index===0){children.push(new Paragraph({text:`Relatório mensal de acompanhamento ${content.identity.clientDisplayName}`,heading:HeadingLevel.TITLE}),paragraph(`Estação ${content.stationId} · competência ${content.period} · versão ${content.revision}`),paragraph(content.mode==="draft"?"RASCUNHO — aguardando revisão técnica":"Documento finalizado após revisão técnica",true));}
    children.push(new Paragraph({text:section.title,heading:HeadingLevel.HEADING_1,keepNext:true}),...section.paragraphs.map(p=>paragraph(p)));
    for(const table of section.tables){children.push(paragraph(table.title,true),makeTable(table.columns,table.rows));if(!table.rows.length)children.push(paragraph("Sem registros selecionados."));}
    for(const chart of section.charts){const png=renderReportChart(chart),data=reportChartTable(chart);const width=section.orientation==="landscape"?700:550;children.push(paragraph(chart.title,true),new Paragraph({children:[new ImageRun({type:"png",data:Uint8Array.from(atob(png.split(",")[1]),c=>c.charCodeAt(0)),transformation:{width,height:Math.round(width*460/1200)}})]}),makeTable(data.columns,data.rows));}
    return {properties:{type:index===0||content.sections[index-1].orientation!==section.orientation?SectionType.NEXT_PAGE:SectionType.CONTINUOUS,page:{size:{orientation:section.orientation==="landscape"?PageOrientation.LANDSCAPE:PageOrientation.PORTRAIT},margin:{top:1000,bottom:1000,left:1000,right:1000,header:450,footer:450}}},headers:{default:new Header({children:[new Paragraph({children:[new TextRun({text:`OURO FINO · ${content.identity.clientDisplayName} · ${content.period}${content.mode==="draft"?" · RASCUNHO":""}`,size:18,font:"Arial"})]})]})},footers:{default:new Footer({children:[new Paragraph({children:[new TextRun({text:`Versão ${content.revision} · `,size:18}),new TextRun({children:[PageNumber.CURRENT],size:18}),new TextRun({text:" / ",size:18}),new TextRun({children:[PageNumber.TOTAL_PAGES],size:18})]})]})},children};
  })});
  return Packer.toBlob(doc);
}
type PdfFonts={regular:string;bold:string;math:string};
async function loadFonts():Promise<PdfFonts>{
  const read=async(name:string)=>{const response=await fetch(`/report-assets/${name}.ttf`);if(!response.ok)throw new Error("Fonte do PDF indisponível. Recarregue o aplicativo.");const bytes=new Uint8Array(await response.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);};
  const [regular,bold,math]=await Promise.all([read("NotoSans-Regular"),read("NotoSans-Bold"),read("NotoSansMath-Regular")]);return {regular,bold,math};
}
export async function exportReportPdf(content:ReportDocument,providedFonts?:PdfFonts):Promise<Blob>{
  assertRenderer(content);const {jsPDF}=await import("jspdf");const fonts=providedFonts??await loadFonts();
  const pdf=new jsPDF({unit:"mm",format:"a4",orientation:content.sections[0]?.orientation??"portrait",compress:true});
  pdf.addFileToVFS("NotoSans-Regular.ttf",fonts.regular);pdf.addFont("NotoSans-Regular.ttf","NotoSans","normal");pdf.addFileToVFS("NotoSans-Bold.ttf",fonts.bold);pdf.addFont("NotoSans-Bold.ttf","NotoSans","bold");
  pdf.addFileToVFS("NotoSansMath-Regular.ttf",fonts.math);pdf.addFont("NotoSansMath-Regular.ttf","NotoSansMath","normal");
  let orientation=content.sections[0]?.orientation??"portrait",y=30;
  const width=()=>pdf.internal.pageSize.getWidth()-32,height=()=>pdf.internal.pageSize.getHeight()-20;
  const font=(size:number,bold=false)=>{pdf.setFont("NotoSans",bold?"bold":"normal");pdf.setFontSize(size);};
  const unicodeText=(value:string,x:number,y:number,size:number,bold=false)=>{for(const run of value.split(/([≤≥≈≠])/g).filter(Boolean)){font(size,bold);if(/^[≤≥≈≠]$/.test(run))pdf.setFont("NotoSansMath","normal");pdf.text(run,x,y);x+=pdf.getTextWidth(run);}font(size,bold);};
  const header=()=>{font(8);pdf.setTextColor(45,83,85);pdf.text(`OURO FINO · ${content.identity.clientDisplayName} · ${content.period} · v${content.revision}${content.mode==="draft"?" · RASCUNHO":""}`,16,15,{maxWidth:width()});pdf.setDrawColor(180,200,200);pdf.line(16,21,16+width(),21);pdf.setTextColor(20,30,35);y=30;};
  const nextPage=()=>{pdf.addPage("a4",orientation);header();};header();
  const text=(value:string,size=10,bold=false)=>{font(size,bold);const lines=pdf.splitTextToSize(value||" ",width()) as string[];const lineHeight=size*.48;for(const line of lines){if(y+lineHeight>height())nextPage();unicodeText(line,16,y,size,bold);y+=lineHeight;}y+=3;};
  const drawTable=(columns:string[],rows:string[][])=>{
    const cw=width()/columns.length,lineHeight=4.1,padding=2;
    const linesFor=(row:string[])=>{font(8);return columns.map((_,i)=>pdf.splitTextToSize(row[i]??"",cw-padding*2) as string[]);};
    const draw=(lines:string[][],headerRow:boolean)=>{const linesCount=Math.max(1,...lines.map(c=>c.length));const rh=linesCount*lineHeight+padding*2;pdf.setFillColor(headerRow?229:255,headerRow?241:255,headerRow?241:255);font(8,headerRow);for(let i=0;i<columns.length;i++){pdf.setFillColor(headerRow?229:255,headerRow?241:255,headerRow?241:255);pdf.setDrawColor(210,220,220);pdf.rect(16+i*cw,y,cw,rh,"FD");for(let l=0;l<lines[i].length;l++)unicodeText(lines[i][l],16+i*cw+padding,y+padding+3+l*lineHeight,8,headerRow);}y+=rh;};
    const headerLines=linesFor(columns),headerHeight=Math.max(...headerLines.map(l=>l.length))*lineHeight+padding*2;
    if(y+headerHeight+12>height())nextPage();draw(headerLines,true);
    for(const row of rows){const remaining=linesFor(row);while(remaining.some(c=>c.length)){let available=Math.floor((height()-y-padding*2)/lineHeight);if(available<1){nextPage();draw(headerLines,true);available=Math.floor((height()-y-padding*2)/lineHeight);}const count=Math.min(available,Math.max(...remaining.map(c=>c.length)));draw(remaining.map(c=>c.splice(0,count)),false);if(remaining.some(c=>c.length)){nextPage();draw(headerLines,true);}}}
    if(!rows.length)text("Sem registros selecionados.",9);y+=5;
  };
  text(`Relatório mensal de acompanhamento ${content.identity.clientDisplayName}`,18,true);text(`Estação ${content.stationId} · competência ${content.period} · versão ${content.revision}`);if(content.mode==="draft")text("RASCUNHO — aguardando revisão técnica",11,true);
  for(const section of content.sections){if(section.orientation!==orientation){orientation=section.orientation;nextPage();}if(y+20>height())nextPage();text(section.title,14,true);for(const paragraph of section.paragraphs)text(paragraph);for(const table of section.tables){if(y+22>height())nextPage();text(table.title,10,true);drawTable(table.columns,table.rows);}for(const chart of section.charts){const h=width()*460/1200;if(y+h+14>height())nextPage();text(chart.title,11,true);pdf.addImage(renderReportChart(chart),"PNG",16,y,width(),h);y+=h+5;const data=reportChartTable(chart);drawTable(data.columns,data.rows);}}
  const pages=pdf.getNumberOfPages();for(let i=1;i<=pages;i++){pdf.setPage(i);font(8);pdf.setTextColor(90,100,110);pdf.text(`Versão ${content.revision} · página ${i} de ${pages}`,16,pdf.internal.pageSize.getHeight()-9);}
  return pdf.output("blob");
}
export async function exportReportXlsx(draft:ClientReportDraft,mode:"draft"|"finalized"="draft"):Promise<Blob>{
  const XLSX=await import("xlsx"),data=effectiveReportData(draft),workbook=XLSX.utils.book_new();
  const source=(r:{source:{sourceId:string;sheet?:string;cell?:string;photoId?:string;region?:string;externalRecordId?:string}})=>[r.source.sourceId,r.source.sheet??"",r.source.cell??"",r.source.photoId??"",r.source.region??"",r.source.externalRecordId??""];
  const provenance=["Fonte","Aba","Célula","Foto","Região","Registro na foto"];
  const value=(v:{raw:string;value:number|null;operator:string|null;unit:string;originalUnit:string;status:string})=>[v.raw,v.operator??"",v.value,v.unit,v.originalUnit,v.status];
  const values=["Original","Operador","Valor numérico","Unidade","Unidade original","Situação"];
  const results:unknown[][]=[["ID","Laboratório","Amostra","Revisão","Estação","Ponto","Coleta","Horário","Publicação","Parâmetro",...values,...provenance],...data.lab.map(r=>[r.id,r.labId,r.sampleNumber,r.revision,r.stationId,r.pointId,r.date,r.time,r.publicationDate,r.parameter,...value(r.value),...source(r)]),[],["Eficiência","Data","Calculada %","Declarada %"]];
  for(const pair of draft.selection.efficiencyPairs){const inlet=data.lab.find(r=>r.id===pair.inletId),outlet=data.lab.find(r=>r.id===pair.outletId),declared=data.lab.find(r=>r.id===pair.declaredId);results.push([pair.parameter,inlet?.date??"",inlet&&outlet&&inlet.date===outlet.date?calculateRemoval(inlet.value,outlet.value):null,declared?.value.value??null]);}
  const operations:unknown[][]=[["ID","Data","Horário","Turno","Tratamento","Estação","Ponto","Parâmetro",...values,...provenance],...data.operations.map(r=>[r.id,r.date,r.time,r.shift,r.treatment,r.stationId,r.pointId,r.parameter,...value(r.value),...source(r)]),[],["Ponto","Parâmetro","Unidade","Quantidade","Média","Mínimo","Máximo"]];
  const grouped=new Map<string,typeof data.operations>();for(const r of data.operations){const k=JSON.stringify([r.pointId,r.parameter,r.value.unit]);grouped.set(k,[...(grouped.get(k)??[]),r]);}for(const rows of grouped.values()){const s=summarizeValues(rows.map(r=>r.value));operations.push([rows[0].pointId,rows[0].parameter,rows[0].value.unit,s.count,s.mean,s.min,s.max]);}
  const meters:unknown[][]=[["ID","Hidrômetro","Data","Horário",...values,"Volume informado","Início informado","Fim informado",...provenance],...data.meters.map(r=>[r.id,r.meterId,r.date,r.time,...value(r.cumulative),r.declaredIntervalVolume?.raw??"",r.intervalStart??"",r.intervalEnd??"",...source(r)]),[],["Hidrômetro","Início","Fim","Volume do intervalo","Unidade"]];
  for(const id of new Set(data.meters.map(m=>m.meterId)))for(const i of calculateMeterIntervals(data.meters.filter(m=>m.meterId===id),draft.selection.meterBaselines[id]??null).intervals)meters.push([i.meterId,i.fromDate,i.toDate,i.volume,i.unit]);
  const supplies:unknown[][]=[["ID","Data","Evento","Produto",...values,...provenance],...data.supplies.map(r=>[r.id,r.date,r.kind==="delivery"?"Entrega":"Consumo",r.product,...value(r.quantity),...source(r)]),[],["Produto","Evento","Unidade","Total"]];for(const s of summarizeSupplies(data.supplies))supplies.push([s.product,s.kind==="delivery"?"Entrega":"Consumo",s.unit,s.quantity]);
  const sheets:Record<string,unknown[][]>={Resultados:results,"Operação":operations,"Hidrômetros":meters,Insumos:supplies,"Diário":[["ID","Data","Turno","Ordem","Texto","Estado da ETE",...provenance],...data.journal.map(r=>[r.id,r.date,r.shift,r.order,r.text,r.plantState,...source(r)])],Fontes:[["ID","Arquivo ou referência","Tipo","Identificação do conteúdo","Data da importação","Autor","Versão de leitura"],...data.sources.map(s=>[s.id,s.name,s.kind,s.sha256,s.importedAt,s.importedByUid,s.adapterVersion])]};
  sheets.Fontes.push([], ["Trilha de correções","Substituto","Revisor","Data","Motivo"],...draft.corrections.map(c=>[c.originalId,c.replacementId,c.actorUid,c.at,c.reason]));
  for(const [name,rows] of Object.entries(sheets)){rows.unshift([mode==="draft"?"RASCUNHO — aguardando revisão técnica":"FINALIZADO",draft.clientId,draft.stationId,draft.period,`Versão ${draft.revision}`],[]);const sheet=XLSX.utils.aoa_to_sheet(rows);sheet["!cols"]=Array.from({length:Math.max(...rows.map(r=>r.length))},()=>({wch:22}));for(const [key,cell] of Object.entries(sheet))if(!key.startsWith("!")&&cell&&typeof cell==="object"&&typeof (cell as CellObject).v==="string"){(cell as CellObject).t="s";delete (cell as CellObject).f;}XLSX.utils.book_append_sheet(workbook,sheet,name);}
  return new Blob([XLSX.write(workbook,{type:"array",bookType:"xlsx"})],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
