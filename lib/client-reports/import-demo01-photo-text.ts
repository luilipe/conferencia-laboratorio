import type { GlobePhotoPackage, PreparedGlobePhotoImport, GlobePhotoChangeSet, ClientReportDraft, ImportContext, SourceInfo, PhotoDated, ReportValue } from "./types.ts";
import { emptyReportBatch, parseReportValue, reportDate, normalizeParameter, reportIssue } from "./values.ts";
import { getReportPreset } from "./presets.ts";

const groups=["observacoes","medicoes","hidrometros","insumos","resultados_laboratoriais"] as const;
const arrays=["fotos",...groups,"confirmacoes","pendencias"] as const;
const folded=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
type Shape=Record<string,"string"|"nullable"|"integer"|"nullableInteger">;
function object(value:unknown): value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
function shape(value:unknown,fields:Shape,label:string): asserts value is Record<string,unknown>{
  if(!object(value))throw new Error(`${label}: objeto inválido.`);
  for(const [key,type] of Object.entries(fields)){
    const v=value[key];if(type==="string"&&typeof v==="string")continue;
    if(type==="nullable"&&(v===null||typeof v==="string"))continue;
    if((type==="integer"||type==="nullableInteger")&&Number.isSafeInteger(v)&&(v as number)>=0)continue;
    if(type==="nullableInteger"&&v===null)continue;
    throw new Error(`${label}: campo ${key} inválido ou ausente.`);
  }
}
const dated:Shape={id:"string",data:"nullable",data_original:"nullable",origem_data:"string"};
const timed:Shape={...dated,turno:"string",hora:"nullable"};
const recordShapes:Record<typeof groups[number],Shape>={
  observacoes:{...timed,ordem:"integer",texto_original:"string",texto_relatorio:"string",estado_ete:"string"},
  medicoes:{...timed,ponto_original:"nullable",parametro_original:"nullable",valor_original:"nullable",unidade_original:"nullable"},
  hidrometros:{...timed,hidrometro_original:"nullable",tipo:"string",valor_original:"nullable",unidade_original:"nullable",inicio_intervalo:"nullable",fim_intervalo:"nullable"},
  insumos:{...timed,produto_original:"nullable",tipo:"string",quantidade_original:"nullable",unidade_original:"nullable"},
  resultados_laboratoriais:{...dated,laboratorio_original:"nullable",laudo_original:"nullable",amostra_original:"nullable",revisao_laudo:"nullableInteger",ponto_original:"nullable",parametro_original:"nullable",resultado_original:"nullable",unidade_original:"nullable"},
};
export function readGlobePhotoPackage(text:string):GlobePhotoPackage{return JSON.parse(unwrap(text)) as GlobePhotoPackage;}
function unwrap(text:string):string{
  let body=text.replace(/^\uFEFF/,"").trim();
  if(body.startsWith("```")){const m=body.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);if(!m)throw new Error("Use apenas o JSON ou uma única cerca externa, sem texto extra.");body=m[1];}
  return body;
}
export function canonicalPhotoJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalPhotoJson).join(",")}]`;
  if(object(value))return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalPhotoJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function parsePackage(text:string,context:ImportContext):GlobePhotoPackage{
  if(new TextEncoder().encode(text).length>2*1024*1024)throw new Error("Tamanho do TXT excede 2 MiB.");
  let p:unknown;try{p=JSON.parse(unwrap(text));}catch(error){throw new Error(`JSON inválido: ${error instanceof Error?error.message:"confira o texto"}`);}
  if(!object(p)||p.formato!=="ouro-fino.demo01.fotos"||p.versao!==1)throw new Error("Formato ou versão de TXT desconhecido.");
  if(typeof p.somente_exemplo!=="boolean")throw new Error("Informe somente_exemplo como verdadeiro ou falso.");
  if(p.somente_exemplo&&!context.demo)throw new Error("Arquivo de exemplo: permitido apenas em demonstração, sem uso operacional.");
  if(context.clientId!=="demo01"||p.cliente!=="demo01"||p.estacao!=="ete")throw new Error("Selecione Demo01 / ETE para importar este TXT.");
  if(p.competencia!==context.period||!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.competencia)))throw new Error("Competência do TXT difere da seleção.");
  if(typeof p.lote_id!=="string"||!p.lote_id.trim()||p.lote_id.length>150||!Number.isSafeInteger(p.revisao)||(p.revisao as number)<1)throw new Error("ID ou revisão do lote inválido.");
  const ids=new Set<string>(),photoIds=new Set<string>(),recordIds=new Set<string>();
  for(const a of arrays){if(!Array.isArray(p[a]))throw new Error(`Grupo ${a} ausente ou inválido.`);for(const row of p[a] as unknown[]){if(!object(row)||typeof row.id!=="string"||!row.id.trim()||row.id.length>150||ids.has(row.id))throw new Error("IDs ausentes ou repetidos no TXT.");ids.add(row.id);if(a==="fotos")photoIds.add(row.id);if(groups.includes(a as typeof groups[number]))recordIds.add(row.id);}}
  for(const row of p.fotos as unknown[])shape(row,{id:"string",arquivo:"nullable",descricao:"string"},"Foto");
  for(const group of groups)for(const row of p[group] as Record<string,unknown>[]){
    shape(row,recordShapes[group],group);shape(row.origem,{foto_id:"string",regiao:"nullable",legibilidade:"string"},"Origem");
    if(!photoIds.has(row.origem.foto_id as string))throw new Error("Foto referenciada não existe no lote.");
    if(!["legivel","parcial","ilegivel"].includes(row.origem.legibilidade as string)||!["foto","foto_e_contexto","usuario","nao_definida"].includes(row.origem_data as string))throw new Error("Legibilidade ou origem da data inválida.");
    if("hora" in row&&row.hora!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(row.hora)))throw new Error("Hora inválida; use HH:mm ou null.");
    if(group==="observacoes"&&(!(Number(row.ordem)>0)||!["ligada","desligada","nao_informado"].includes(String(row.estado_ete))))throw new Error("Ordem ou estado da ETE inválido.");
    if(group==="hidrometros"&&!["leitura_acumulada","volume_informado","nao_definido"].includes(String(row.tipo)))throw new Error("Tipo de hidrômetro inválido.");
    if(group==="insumos"&&!["entrega","consumo","nao_definido"].includes(String(row.tipo)))throw new Error("Tipo de insumo inválido.");
  }
  const records=groups.flatMap(g=>p[g] as Record<string,unknown>[]);
  for(const row of p.confirmacoes as unknown[]){shape(row,{id:"string",registro_id:"string",campo:"string",valor_confirmado:"string",observacao:"string"},"Confirmação");const record=records.find(r=>r.id===row.registro_id);if(!record)throw new Error("Confirmação referencia registro inexistente.");if(!String(row.observacao).trim()||!Object.hasOwn(record,String(row.campo))||["id","origem","origem_data"].includes(String(row.campo)))throw new Error("Confirmação sem justificativa ou campo inválido.");}
  for(const row of p.pendencias as unknown[]){shape(row,{id:"string",registro_id:"nullable",foto_id:"nullable",campo:"nullable",descricao:"string"},"Pendência");if(row.registro_id!==null&&!recordIds.has(row.registro_id as string))throw new Error("Pendência referencia registro inexistente.");if(row.foto_id!==null&&!photoIds.has(row.foto_id as string))throw new Error("Pendência referencia foto inexistente.");}
  return p as unknown as GlobePhotoPackage;
}
export function importGlobePhotoText(text:string,source:SourceInfo,context:ImportContext):PreparedGlobePhotoImport{
  const p=parsePackage(text,context), batch=emptyReportBatch(),pending=new Set<string>();
  const sourceId=`demo01:${p.lote_id}:r${p.revisao}`;
  batch.sources=[{...source,id:sourceId,kind:"operations",size:new TextEncoder().encode(text).length,originalText:text,importedByUid:context.actorUid,adapterVersion:"demo01-photo-v1"}];
  if(p.somente_exemplo)batch.issues.push(reportIssue("synthetic-example","Lote sintético: emissão operacional proibida."));
  const recordId=(r:PhotoDated)=>`${p.lote_id}:${r.id}`;
  const prepared=(r:PhotoDated):Record<string,unknown>=>{
    const copy:Record<string,unknown>={...r};
    for(const c of p.confirmacoes.filter(c=>c.registro_id===r.id)) {let value:unknown=c.valor_confirmado;if(["revisao_laudo","ordem"].includes(c.campo))value=Number(value);copy[c.campo]=value;}
    const group=groups.find(g=>p[g].some(row=>row.id===r.id))!;shape(copy,recordShapes[group],"Confirmação");
    if("tipo" in copy&&!(group==="insumos"?["entrega","consumo","nao_definido"]:["leitura_acumulada","volume_informado","nao_definido"]).includes(String(copy.tipo)))throw new Error("Tipo confirmado inválido.");
    if("estado_ete" in copy&&!["ligada","desligada","nao_informado"].includes(String(copy.estado_ete)))throw new Error("Estado confirmado inválido.");
    if("hora" in copy&&copy.hora!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(copy.hora)))throw new Error("Hora confirmada inválida.");return copy;
  };
  const origin=(r:PhotoDated)=>({sourceId,photoId:r.origem.foto_id,region:r.origem.regiao??"",externalRecordId:r.id,reason:p.confirmacoes.filter(c=>c.registro_id===r.id).map(c=>`${c.campo}: ${c.observacao}`).join("; ")});
  const hold=(r:PhotoDated,message:string)=>{pending.add(r.id);batch.issues.push(reportIssue("photo-pending",message,[recordId(r)]));};
  const dateFor=(r:PhotoDated,copy:Record<string,unknown>):string|null=>{
    const date=reportDate(copy.data);
    const confirmations=p.confirmacoes.filter(c=>c.registro_id===r.id);
    const open=p.pendencias.some(x=>x.registro_id===r.id&&!confirmations.some(c=>c.campo===x.campo));
    if(!date||date.slice(0,7)!==context.period||open||(r.origem.legibilidade!=="legivel"&&!confirmations.length)){hold(r,!date?"Data ausente ou inválida na foto.":date.slice(0,7)!==context.period?"Data da foto fora da competência.":"Leitura parcial ou pendência da transcrição requer conferência.");return null;}
    return date;
  };
  const pointFor=(raw:unknown)=>{
    const name=String(raw??"");const mapping=context.mappings?.find(m=>folded(m.identification)===folded(name)&&m.stationId==="ete");
    return mapping?.pointId??getReportPreset("demo01","ete").points.find(pt=>folded(pt.label)===folded(name))?.id??null;
  };
  const valueFor=(r:PhotoDated,c:Record<string,unknown>,field:string,parameter:string):ReportValue|null=>{
    const value=parseReportValue(c[field],String(c.unidade_original??""));
    if(value.status!=="measured"||(!value.unit&&parameter!=="pH")){hold(r,"Valor ou unidade pendente: confira o original e informe a correção.");return null;}
    // A interpretação confirmada permanece ao lado da leitura original no pacote.
    return value;
  };
  for(const r of p.observacoes){const c=prepared(r),date=dateFor(r,c);if(!date)continue;batch.journal.push({id:recordId(r),date,shift:String(c.turno),order:Number(c.ordem),text:String(c.texto_relatorio),plantState:c.estado_ete==="ligada"?"on":c.estado_ete==="desligada"?"off":"unknown",source:origin(r)});}
  for(const r of p.medicoes){const c=prepared(r),date=dateFor(r,c),pointId=pointFor(c.ponto_original),parameter=normalizeParameter(String(c.parametro_original??"")),value=valueFor(r,c,"valor_original",parameter);if(!pointId||!parameter)hold(r,"Ponto ou parâmetro sem correspondência.");if(!date||!pointId||!parameter||!value)continue;batch.operations.push({id:recordId(r),date,stationId:"ete",pointId,parameter,value,time:c.hora as string|null,shift:String(c.turno),treatment:null,source:origin(r)});}
  for(const r of p.hidrometros){const c=prepared(r),date=dateFor(r,c),value=valueFor(r,c,"valor_original","Hidrômetro");const meter=folded(String(c.hidrometro_original??""));if(!["equalizado","sanitario","tratado"].includes(meter)||c.tipo==="nao_definido"){hold(r,"Identifique o hidrômetro e confirme leitura acumulada ou volume do intervalo.");continue;}if(!date||!value)continue;
    const start=reportDate(c.inicio_intervalo),end=reportDate(c.fim_intervalo);if(c.tipo==="volume_informado"&&(!start||!end||start>end||end!==date)){hold(r,"Volume informado exige início/fim válidos do intervalo.");continue;}
    batch.meters.push({id:recordId(r),meterId:meter,date,time:c.hora as string|null,cumulative:c.tipo==="leitura_acumulada"?value:parseReportValue(null,value.unit),declaredIntervalVolume:c.tipo==="volume_informado"?value:null,...(start?{intervalStart:start}:{}),...(end?{intervalEnd:end}:{}),source:origin(r)});
  }
  for(const r of p.insumos){const c=prepared(r),date=dateFor(r,c),quantity=valueFor(r,c,"quantidade_original","Insumo");if(!c.produto_original||c.tipo==="nao_definido"){hold(r,"Produto ou natureza do evento ainda pendente.");continue;}if(!date||!quantity)continue;batch.supplies.push({id:recordId(r),stationId:"ete",date,kind:c.tipo==="entrega"?"delivery":"consumption",product:String(c.produto_original),quantity,source:origin(r)});}
  for(const r of p.resultados_laboratoriais){const c=prepared(r),date=dateFor(r,c),pointId=pointFor(c.ponto_original),parameter=normalizeParameter(String(c.parametro_original??"")),value=valueFor(r,c,"resultado_original",parameter);if(!c.laboratorio_original||!c.laudo_original||!c.amostra_original||!pointId||!parameter||!Number.isSafeInteger(c.revisao_laudo)){hold(r,"Resultado laboratorial exige laboratório, laudo, amostra, revisão, ponto e parâmetro identificados.");continue;}if(!date||!value)continue;batch.lab.push({id:recordId(r),labId:String(c.laboratorio_original),sampleBase:String(c.amostra_original),sampleNumber:`${c.laudo_original} / ${c.amostra_original}`,revision:Number(c.revisao_laudo),stationId:"ete",pointId,identification:String(c.ponto_original),company:"",date,time:null,publicationDate:null,parameter,value,source:origin(r)});}
  for(const pnd of p.pendencias)if(pnd.registro_id===null)batch.issues.push(reportIssue("photo-pending",pnd.descricao,[`${p.lote_id}:${pnd.id}`]));
  return {package:p,batch,pendingRecordIds:[...pending]};
}
function previousPackage(draft:ClientReportDraft,loteId:string):GlobePhotoPackage|null{
  const packets=draft.data.sources.filter(s=>s.adapterVersion==="demo01-photo-v1"&&s.originalText).map(s=>JSON.parse(unwrap(s.originalText!)) as GlobePhotoPackage).filter(p=>p.lote_id===loteId);
  return packets.sort((a,b)=>b.revisao-a.revisao)[0]??null;
}
export function previewGlobePhotoUpdate(draft:ClientReportDraft,incoming:PreparedGlobePhotoImport):GlobePhotoChangeSet{
  const before=previousPackage(draft,incoming.package.lote_id), after=incoming.package;
  const records=(p:GlobePhotoPackage)=>new Map(groups.flatMap(g=>p[g] as PhotoDated[]).map(r=>[r.id,canonicalPhotoJson({record:r,confirmations:p.confirmacoes.filter(c=>c.registro_id===r.id),pending:p.pendencias.filter(c=>c.registro_id===r.id)})]));
  const a=before?records(before):new Map<string,string>(),b=records(after);
  const changes:GlobePhotoChangeSet={kind:"new",addedIds:[...b.keys()].filter(id=>!a.has(id)),changedIds:[...b.keys()].filter(id=>a.has(id)&&a.get(id)!==b.get(id)),removedIds:[...a.keys()].filter(id=>!b.has(id)),issues:[]};
  if(!before)return changes;
  if(canonicalPhotoJson(before)===canonicalPhotoJson(after))changes.kind="duplicate";
  else if(after.revisao<=before.revisao){changes.kind="conflict";changes.issues.push(reportIssue("photo-revision-conflict","Conflito: mesmo lote com revisão igual ou anterior e conteúdo diferente."));}
  else changes.kind="update";
  return changes;
}
export function applyGlobePhotoImport(draft:ClientReportDraft,incoming:PreparedGlobePhotoImport):ClientReportDraft{
  if(draft.clientId!=="demo01"||draft.stationId!=="ete"||draft.period!==incoming.package.competencia)throw new Error("Lote não pertence a este cliente/estação/competência.");
  const changes=previewGlobePhotoUpdate(draft,incoming);if(changes.kind==="duplicate")return draft;if(changes.kind==="conflict")throw new Error("Conflito de revisão do lote; mantenha o original e peça um TXT com revisão nova.");
  const next=structuredClone(draft), prefix=`${incoming.package.lote_id}:`;
  const reviewed=[...next.data.lab,...next.data.operations,...next.data.meters,...next.data.supplies,...next.data.journal].filter(r=>r.id.startsWith(prefix)&&r.source.authorUid);
  for(const group of ["lab","operations","meters","supplies","journal"] as const)Object.assign(next.data,{[group]:[...next.data[group].filter(r=>!r.id.startsWith(prefix)||!!r.source.authorUid),...incoming.batch[group]]});
  next.data.sources.push(...incoming.batch.sources);next.data.issues=[...next.data.issues.filter(i=>!i.recordIds.some(id=>id.startsWith(prefix))),...incoming.batch.issues];
  const changed=new Set([...changes.changedIds,...changes.removedIds]);for(const row of reviewed)if(changed.has(row.source.externalRecordId??"")&&!next.selection.excludedRecordIds.includes(row.id))next.data.issues.push(reportIssue("photo-local-review","O TXT novo altera um registro com revisão local. Confira novamente ou exclua o substituto anterior com motivo.",[row.id]));
  return next;
}
export function reviewGlobePhotoRecord(draft:ClientReportDraft,sourceId:string,recordId:string,confirmations:{campo:string;valor_confirmado:string;observacao:string}[],context:ImportContext):ClientReportDraft{
  if(!context.actorUid.trim()||!confirmations.length||confirmations.some(c=>!c.observacao.trim()))throw new Error("Confirmação exige autor e justificativa em cada campo.");
  const original=draft.data.sources.find(s=>s.id===sourceId&&s.adapterVersion==="demo01-photo-v1");if(!original?.originalText)throw new Error("TXT original não encontrado.");
  const prior=draft.data.sources.filter(s=>s.adapterVersion===`demo01-review-v1:${sourceId}`&&s.reviewedText).at(-1);
  const p=readGlobePhotoPackage(prior?.reviewedText??original.originalText),uuid=crypto.randomUUID();
  p.confirmacoes.push(...confirmations.map((c,i)=>({...c,id:`revisao-${uuid}-${i}`,registro_id:recordId})));
  const text=JSON.stringify(p),prepared=importGlobePhotoText(text,original,{...context,clientId:"demo01",stationId:"ete",period:draft.period});
  const next=structuredClone(draft),id=`manual:demo01:${uuid}`,reason=confirmations.map(c=>`${c.campo}: ${c.observacao}`).join("; ");
  next.data.sources.push({id,name:`Revisão de ${original.name} / ${recordId}`,sha256:"",kind:"manual",size:new TextEncoder().encode(text).length,importedAt:context.importedAt,importedByUid:context.actorUid,adapterVersion:`demo01-review-v1:${sourceId}`,reviewedText:text});
  const originalId=`${p.lote_id}:${recordId}`;
  for(const group of ["lab","operations","meters","supplies","journal"] as const){const row=prepared.batch[group].find(r=>r.id===originalId);if(!row)continue;
    const replacementId=`${originalId}:review:${uuid}`,previous=next.data[group].filter(r=>r.source.externalRecordId===recordId&&r.id.startsWith(`${p.lote_id}:`));
    const replacement={...row,id:replacementId,source:{...row.source,sourceId:id,authorUid:context.actorUid,reason:`${original.name} — ${reason}`}};(next.data[group] as {id:string}[]).push(replacement);
    for(const before of [...previous.map(r=>r.id),originalId]){next.selection.excludedRecordIds.push(before);next.corrections.push({originalId:before,replacementId,actorUid:context.actorUid,at:context.importedAt,reason});}
    if(next.selection.selectedLabIds.some(selected=>previous.some(r=>r.id===selected)))next.selection.selectedLabIds.push(replacementId);
    next.selection.efficiencyPairs=next.selection.efficiencyPairs.map(pair=>({...pair,inletId:previous.some(r=>r.id===pair.inletId)?replacementId:pair.inletId,outletId:previous.some(r=>r.id===pair.outletId)?replacementId:pair.outletId,declaredId:previous.some(r=>r.id===pair.declaredId)?replacementId:pair.declaredId}));
  }
  next.data.issues=next.data.issues.filter(i=>!i.recordIds.includes(originalId));next.data.issues.push(...prepared.batch.issues.filter(i=>i.recordIds.includes(originalId)));return next;
}
