import type {ModelResultsCatalog,ImportContext,ImportBatch,ModelResultEntry} from './types.ts';
import {emptyReportBatch,reportDate} from './values.ts';
import {getReportPreset} from './presets.ts';
import {parseModelReportValue} from './model-values.ts';

function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Objeto inválido no catálogo.');
 const obj=value as Record<string,unknown>;if(Object.keys(obj).some(k=>!keys.includes(k)))throw Error('Campo desconhecido ou de aprovação/habilitação não permitido.');return obj;
}
function text(value:unknown){if(typeof value!=='string')throw Error('Texto inválido no catálogo.');return value;}
function list(value:unknown){if(!Array.isArray(value))throw Error('Lista inválida no catálogo.');return value as unknown[];}
const period=(v:unknown)=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v)&&Number(v.slice(0,4))>=1900;
export function parseModelResultsCatalog(input:string):ModelResultsCatalog{
 if(new TextEncoder().encode(input).length>20*1024*1024)throw Error('Catálogo excede 20 MiB.');
 const c=object(JSON.parse(input),['format','version','entries']);
 if(c.format!=='ouro-fino.normalized-model-results'||c.version!==1)throw Error('Formato/versão de catálogo desconhecido.');
 const entries=list(c.entries);if(!entries.length||entries.length>8)throw Error('Catálogo deve conter de um a oito vínculos.');
 const bindings=new Set<string>(),ids=new Set<string>();let total=0;
 for(const item of entries){
  const e=object(item,['clientId','stationId','period','sources','records','issues']);text(e.clientId);text(e.stationId);if(!period(e.period))throw Error('Competência inválida.');
  getReportPreset(e.clientId as ModelResultEntry['clientId'],e.stationId as string);
  const binding=`${e.clientId}/${e.stationId}`;if(bindings.has(binding))throw Error('Vínculo duplicado.');bindings.add(binding);
  const sources=list(e.sources),sourceMap=new Map<string,Record<string,unknown>>();
  if(!sources.length||sources.length>20)throw Error('Fontes inválidas.');
  for(const item of sources){const s=object(item,['id','name','sha256','kind','size','adapterVersion','verificationNotes']);
   for(const k of ['id','name','sha256','adapterVersion'])text(s[k]);
   if(!s.id||sourceMap.has(s.id as string)||!/^[a-f0-9]{64}$/.test(s.sha256 as string)||!['lab','history'].includes(s.kind as string)||!Number.isSafeInteger(s.size)||Number(s.size)<0||!['model-results-v1','model-results-v1-excel'].includes(s.adapterVersion as string))throw Error('Fonte/hash/versão inválidos.');
   if(s.verificationNotes!==undefined)list(s.verificationNotes).forEach(text);sourceMap.set(s.id as string,s);
  }
  const records=list(e.records);total+=records.length;if(records.length>5000||total>20000)throw Error('Limite de registros excedido.');
  for(const item of records){const r=object(item,['id','labId','sampleBase','revision','sampleNumber','stationId','pointId','identification','company','date','time','publicationDate','parameter','value','source','datePrecision','collectionPeriod','declaredReference','modelAlternativeGroup']);
   for(const k of ['id','labId','sampleBase','sampleNumber','identification','company','date','parameter'])text(r[k]);
   if(!r.id||!r.sampleBase||!r.parameter||ids.has(r.id as string)||r.stationId!==e.stationId||!Number.isSafeInteger(r.revision)||Number(r.revision)<0)throw Error('ID, estação ou revisão inválidos/duplicados.');ids.add(r.id as string);
   for(const k of ['pointId','time','publicationDate'])if(r[k]!==null)text(r[k]);
   if(r.time!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time as string))throw Error('Hora inválida.');
   if(r.publicationDate!==null&&reportDate(r.publicationDate)!==r.publicationDate)throw Error('Publicação inválida.');
   if(r.datePrecision!==undefined&&!['day','month'].includes(r.datePrecision as string))throw Error('Precisão inválida.');
   if(r.datePrecision==='month'){if(r.date!==''||!period(r.collectionPeriod))throw Error('Data mensal exige competência e dia vazio.');}
   else if(reportDate(r.date)!==r.date||!r.date||r.collectionPeriod!==undefined&&r.collectionPeriod!==(r.date as string).slice(0,7))throw Error('Data de coleta inválida.');
   if(r.declaredReference!==undefined)text(r.declaredReference);if(r.modelAlternativeGroup!==undefined&&(!text(r.modelAlternativeGroup).startsWith('model-alternative:')||r.sampleNumber))throw Error('Contexto de alternativas inválido.');
   const ref=object(r.source,['sourceId','sheet','cell','page','authorUid','reason','photoId','region','externalRecordId']);text(ref.sourceId);
   for(const [k,v] of Object.entries(ref))if(k!=='page')text(v);else if(!Number.isSafeInteger(v)||Number(v)<1)throw Error('Página inválida.');
   const source=sourceMap.get(ref.sourceId as string);if(!source||!ref.sheet||!ref.cell)throw Error('Origem/localização não encontrada.');
   const v=object(r.value,['raw','value','operator','qualitative','unit','originalUnit','status']);text(v.raw);text(v.originalUnit);
   const expected=parseModelReportValue(v.raw as string,v.originalUnit as string,source.adapterVersion==='model-results-v1-excel');
   for(const key of Object.keys(expected) as (keyof typeof expected)[])if(v[key]!==expected[key])throw Error('ReportValue contradiz original/operador/unidade.');
   if(v.status==='missing')throw Error('Resultado vazio não deve gerar medição.');
  }
  for(const item of list(e.issues)){const issue=object(item,['id','code','severity','message','recordIds','acknowledgedByUid','acknowledgement']);for(const k of ['id','code','message'])text(issue[k]);
   if(!['blocker','warning'].includes(issue.severity as string)||issue.acknowledgedByUid!==null||issue.acknowledgement!==null)throw Error('Aprovação não permitida.');
   for(const id of list(issue.recordIds))if(!records.some(r=>(r as {id:string}).id===text(id)))throw Error('Pendência sem registro correspondente.');
  }
 }
 return c as unknown as ModelResultsCatalog;
}

export function importModelResults(catalog:ModelResultsCatalog,context:ImportContext):ImportBatch{
 const checked=parseModelResultsCatalog(JSON.stringify(catalog)),batch=emptyReportBatch();
 if(!context.actorUid.trim()||!Number.isFinite(Date.parse(context.importedAt))||!context.stationId)throw Error('Contexto autenticado incompleto.');
 const entry=checked.entries.find(e=>e.clientId===context.clientId&&e.stationId===context.stationId);if(!entry)return batch;
 batch.sources=entry.sources.map(s=>({...structuredClone(s),importedAt:context.importedAt,importedByUid:context.actorUid}));
 batch.lab=structuredClone(entry.records);batch.issues=structuredClone(entry.issues);return batch;
}
