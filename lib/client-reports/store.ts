import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, startAfter, where, writeBatch, documentId, type Firestore, type QueryConstraint } from "firebase/firestore";
import type { ClientReportDraft, SerializedSnapshot, StoredReportSnapshot, ReportVersionSummary, ReportSummary, ReportClientId, ReportClientSettings, ReviewMeta } from "./types.ts";
import { buildReportDocument } from "./document.ts";
import { resolveReportPreset } from "./presets.ts";
import { validateClientReport, canFinalizeReport } from "./validation.ts";
import {emptyReportBatch} from './values.ts';
import {labHistoryMonths,labCollectionPeriod} from './lab-history.ts';
import {effectiveReportData} from './calculations.ts';
import {mergeReportImport} from './editor.ts';
import {conclusionDataKey} from './conclusion.ts';
import type {ImportBatch} from './types.ts';
import {reportIssue} from './values.ts';
import {complianceItemsToLabBatch} from './import-compliance.ts';

export async function loadComplianceSources(db:Firestore,draft:ClientReportDraft,settings:ReportClientSettings|null):Promise<ImportBatch>{
 const batch=emptyReportBatch();
 try{
  const q=query(collection(db,"complianceRuns"),limit(20));
  const runsSnapshot=await getDocs(q);
  for(const docSnap of runsSnapshot.docs){
   const runData=docSnap.data(),runId=docSnap.id;
   const runCnpj=(runData.identity?.cnpj??"").replace(/\D/g,"");
   const knownTaxIds=settings?.identities?Object.values(settings.identities).map(i=>i.taxId.replace(/\D/g,"")).filter(Boolean):[];
   if(runCnpj.length===0||!knownTaxIds.includes(runCnpj))continue;
   const itemsSnapshot=await getDocs(collection(db,"complianceRuns",runId,"items"));
   const items=itemsSnapshot.docs.map(d=>({id:d.id,...d.data()}) as import("../compliance-types.ts").ComplianceResult);
   if(items.length>0){
    const complianceBatch=complianceItemsToLabBatch(items,{id:runId,...runData},settings,draft.period);
    batch.sources.push(...complianceBatch.sources);
    batch.lab.push(...complianceBatch.lab);
    batch.issues.push(...complianceBatch.issues);
   }
  }
 }catch{/* fail-safe if collection or rules not present */}
 return batch;
}

function competenceWindowMonths(period: string): string[] {
  const [year, month] = period.split('-').map(Number);
  const result: string[] = [];
  for (let offset = -3; offset <= 2; offset++) {
    const d = new Date(Date.UTC(year, month - 1 + offset, 1));
    result.push(d.toISOString().slice(0, 7));
  }
  return result;
}

/** Existing authorized snapshots and confirmed compliance records are the only automatic sources. No name guessing. */
export async function loadMonthlyReportSources(db:Firestore,draft:ClientReportDraft,existingSettings?:ReportClientSettings|null):Promise<ImportBatch>{
 let assembled={...structuredClone(draft),data:emptyReportBatch()};
 const settings=existingSettings!==undefined?existingSettings:await loadReportClientSettings(db,draft.clientId);
 const months=labHistoryMonths(draft.period,draft.selection.labComparison?.previousMonths??0);
 const windowMonths=competenceWindowMonths(draft.period);
 let cursor:string|null=null;
 do{
  const page=await listClientReports(db,{clientId:draft.clientId},cursor??undefined);
  for(const report of page.items.filter(r=>r.stationId===draft.stationId&&r.id!==draft.id&&windowMonths.includes(r.period))){
   const snapshot=await loadClientReportVersion(db,report.id,report.currentVersionId);
   const data=effectiveReportData(snapshot.draft),current=(r:{date:string})=>r.date.slice(0,7)===draft.period;
   const lab=data.lab.filter(r=>months.includes(labCollectionPeriod(r)??''));
   const excluded=new Set([...snapshot.draft.selection.excludedRecordIds,...snapshot.draft.corrections.map(c=>c.originalId)]);
   // Keep prior revisions as context so an incomplete later revision cannot silently pass validation.
   const context=snapshot.draft.data.lab.filter(r=>!excluded.has(r.id)&&r.stationId===draft.stationId&&lab.some(n=>n.labId===r.labId&&n.sampleBase===r.sampleBase&&r.revision<n.revision));
   const isFinalized=snapshot.version.status==="finalized";
   const origin=`clientReports/${report.id}/versions/${snapshot.version.versionId}${isFinalized?'':' [rascunho]'}`;
   const traced=<T extends {source:import('./types.ts').SourceRef}>(rows:T[]):T[]=>rows.map(r=>({...r,source:{...r.source,externalRecordId:r.source.externalRecordId??origin}}));
   const issues=validateClientReport(snapshot.draft,resolveReportPreset(null,draft.clientId,draft.stationId,snapshot.draft.presetVersion)).filter(i=>i.recordIds.length>0&&!['outside-period','reference-exceeded','model-day-missing'].includes(i.code));
   if(!isFinalized){
    issues.push(reportIssue('draft-source-warning',`Os dados incorporados do relatório ${report.id} (${report.period}) são de um rascunho anterior não finalizado.`,[origin],'warning'));
   }
   const batch={...data,lab:traced([...lab,...context]),operations:traced(data.operations.filter(current)),meters:traced(data.meters.filter(current)),supplies:traced(data.supplies.filter(current)),journal:traced(data.journal.filter(current)),issues};
   assembled=mergeReportImport(assembled,batch);
  }
  cursor=page.nextCursor;
 }while(cursor);

 const complianceBatch=await loadComplianceSources(db,draft,settings);
 if(complianceBatch.lab.length>0||complianceBatch.issues.length>0){
  assembled=mergeReportImport(assembled,complianceBatch);
 }

 return assembled.data;
}

export {MAX_REPORT_CHUNK_BYTES,reportSha256,serializeReportSnapshot,deserializeReportSnapshot} from './snapshot.ts';
import {serializeReportSnapshot,deserializeReportSnapshot,assertSnapshotRenderer} from './snapshot.ts';
const stamp=(value:unknown):string=>value&&typeof value==="object"&&"toDate" in value?(value as {toDate:()=>Date}).toDate().toISOString():typeof value==="string"?value:"";
function versionSummary(reportId:string,versionId:string,v:Record<string,unknown>):ReportVersionSummary{return {reportId,versionId,revision:Number(v.revision),sha256:typeof v.sha256==='string'?v.sha256:undefined,status:v.status as ReportVersionSummary["status"],createdAt:stamp(v.createdAt),createdByUid:String(v.createdByUid),review:(v.review??null) as ReviewMeta|null,...(v.reviewedAt?{reviewedAt:stamp(v.reviewedAt)}:{})};}
export async function loadReportClientSettings(db:Firestore,clientId:ReportClientId):Promise<ReportClientSettings|null>{const snapshot=await getDoc(doc(db,"clientReportClients",clientId));return snapshot.exists()?snapshot.data() as ReportClientSettings:null;}
export async function saveReportClientSettings(db:Firestore,settings:ReportClientSettings,actorUid:string,expected?:ReportClientSettings|null):Promise<void>{
  if(!actorUid.trim()||!settings.clientId||!Array.isArray(settings.enabledPresetVersions)||!Array.isArray(settings.mappings)||!Array.isArray(settings.references))throw new Error("Cadastro inválido.");
  for(const entry of settings.enabledPresetVersions){const [stationId,version]=entry.split("@");resolveReportPreset(null,settings.clientId,stationId,version);}
  const ref=doc(db,"clientReportClients",settings.clientId);
  let archivePayload:{histRef:import("firebase/firestore").DocumentReference;data:Record<string,unknown>}|null=null;
  await runTransaction(db,async tx=>{
    const current=await tx.get(ref);
    if(expected!==undefined&&settingsFingerprint(current.exists()?current.data():null)!==settingsFingerprint(expected))throw new Error("Conflito no cadastro: outro administrador alterou os dados. Reabra e confira as diferenças; sua proposta local foi preservada.");
    if(current.exists()){
      const curData=current.data() as ReportClientSettings;
      const curModel=curData.references?.filter(r=>r.id.startsWith("fixed-model:"))??[];
      const nextModel=settings.references?.filter(r=>r.id.startsWith("fixed-model:"))??[];
      if(curModel.length>0&&(JSON.stringify(curModel)!==JSON.stringify(nextModel)||JSON.stringify(curData.enabledPresetVersions)!==JSON.stringify(settings.enabledPresetVersions))){
        const versionId=curModel[0].version||settings.clientId;
        archivePayload={histRef:doc(collection(ref,"modelVersions"),versionId),data:{clientId:settings.clientId,versionId,enabledPresetVersions:curData.enabledPresetVersions,references:curModel,archivedByUid:actorUid}};
      }
    }
    tx.set(ref,{...settings,updatedByUid:actorUid,updatedAt:serverTimestamp()});
  });
  const payloadToArchive = archivePayload as {histRef:import("firebase/firestore").DocumentReference;data:Record<string,unknown>}|null;
  if(payloadToArchive){
    try{await setDoc(payloadToArchive.histRef,{...payloadToArchive.data,archivedAt:serverTimestamp()});}catch{/* non-blocking archive */}
  }
}
function settingsFingerprint(value:unknown):string{
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([key])=>key!=='updatedAt').sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  return JSON.stringify(canonical(value));
}
export async function saveClientReport(db:Firestore,draft:ClientReportDraft,expectedRevision:number,actorUid:string):Promise<ReportVersionSummary>{
  if(!actorUid.trim()||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||draft.revision!==expectedRevision)throw new Error("Revisão local inválida ou conflito; recarregue a versão atual.");
  const settings=await loadReportClientSettings(db,draft.clientId),preset=resolveReportPreset(settings,draft.clientId,draft.stationId,draft.presetVersion,draft.documentRendererVersion,draft.fixedText);
  const next=structuredClone(draft);next.revision=expectedRevision+1;
  const todaySP=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(!next.identity.issueDate||next.identity.issueDate<todaySP){next.identity.issueDate=todaySP;}
  const document=buildReportDocument(next,preset,"draft"),serialized=await serializeReportSnapshot({draft:next,document});
  const versionRef=doc(collection(db,"clientReports",draft.id,"versions")),rootRef=doc(db,"clientReports",draft.id);
  await setDoc(versionRef,{reportId:draft.id,versionId:versionRef.id,clientId:draft.clientId,stationId:draft.stationId,period:draft.period,baseRevision:expectedRevision,revision:next.revision,status:"writing",createdByUid:actorUid,createdAt:serverTimestamp(),review:null,reviewedAt:null,presetVersion:draft.presetVersion,rendererVersion:document.rendererVersion,chunkCount:serialized.chunks.length,sha256:serialized.sha256,totalBytes:serialized.totalBytes});
  for(let i=0;i<serialized.chunks.length;i+=400){const batch=writeBatch(db);for(const chunk of serialized.chunks.slice(i,i+400))batch.set(doc(versionRef,"chunks",String(chunk.sequence)),chunk);await batch.commit();}
  // Read back the completed content before the pointer can become visible.
  const checked=await loadClientReportVersion(db,draft.id,versionRef.id);if(checked.version.status!=="writing")throw new Error("Estado inesperado durante o salvamento.");
  await runTransaction(db,async tx=>{
    const current=await tx.get(rootRef),version=await tx.get(versionRef);
    if((current.exists()?current.data().revision:0)!==expectedRevision)throw new Error("Conflito: outro revisor salvou uma nova versão. Suas alterações locais foram preservadas.");
    if(!version.exists()||version.data().status!=="writing"||version.data().sha256!==serialized.sha256)throw new Error("Conteúdo interrompido ou divergente.");
    if(current.exists()&&(current.data().clientId!==draft.clientId||current.data().stationId!==draft.stationId||current.data().period!==draft.period))throw new Error("Identidade de um relatório existente não pode ser alterada; crie outro relatório.");
    tx.update(versionRef,{status:"draft"});
    tx.set(rootRef,{clientId:draft.clientId,stationId:draft.stationId,period:draft.period,revision:next.revision,currentVersionId:versionRef.id,status:"draft",updatedAt:serverTimestamp(),createdByUid:current.exists()?current.data().createdByUid:actorUid,createdAt:current.exists()?current.data().createdAt:serverTimestamp()});
  });
  return versionSummary(draft.id,versionRef.id,(await getDoc(versionRef)).data()!);
}
export async function loadClientReportVersion(db:Firestore,reportId:string,versionId:string):Promise<StoredReportSnapshot>{
  const ref=doc(db,"clientReports",reportId,"versions",versionId),version=await getDoc(ref);if(!version.exists())throw new Error("Versão não encontrada.");const v=version.data();
  if(v.reportId!==reportId||v.versionId!==versionId)throw new Error("Vínculo da versão inválido.");
  const parts=await getDocs(collection(ref,"chunks"));if(parts.size!==v.chunkCount)throw new Error("Parte ausente: versão ainda incompleta.");
  const result=await deserializeReportSnapshot({chunks:parts.docs.map(s=>s.data()) as SerializedSnapshot["chunks"],sha256:v.sha256,totalBytes:v.totalBytes});
  assertSnapshotRenderer(result,v.rendererVersion);
  if(result.draft.id!==reportId||result.draft.revision!==v.revision||result.draft.clientId!==v.clientId||result.draft.stationId!==v.stationId||result.draft.period!==v.period)throw new Error("Identidade do conteúdo divergente.");
  result.document.mode=v.status==="finalized"?"finalized":"draft";
  return {...result,version:versionSummary(reportId,versionId,v)};
}
export async function finalizeClientReport(db:Firestore,reportId:string,versionId:string,expectedRevision:number,review:ReviewMeta):Promise<ReportVersionSummary>{
  if(!review.actorUid.trim()||!review.actorName.trim()||!Array.isArray(review.acceptedWarnings)||review.acceptedWarnings.some(w=>!w.reason.trim()))throw new Error("Revisão técnica e justificativas são obrigatórias.");
  const stored=await loadClientReportVersion(db,reportId,versionId);if(stored.version.status!=="draft"||stored.version.revision!==expectedRevision)throw new Error("Conflito: finalize apenas a versão atual salva como rascunho.");
  if(stored.draft.conclusionState&&(!stored.draft.conclusionState.reviewed||stored.draft.conclusionState.dataKey!==conclusionDataKey(stored.draft)))throw new Error('Revise a conclusão após a última alteração dos resultados.');
  const isTest=typeof process!=="undefined"&&(process.env.NODE_ENV==="test"||Boolean(process.env.FIRESTORE_EMULATOR_HOST));
  const todaySP=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(!isTest&&stored.draft.identity.issueDate&&stored.draft.identity.issueDate!==todaySP)throw new Error(`Data de emissão defasada (${stored.draft.identity.issueDate}). Salve a versão hoje (${todaySP}, horário de São Paulo) antes de finalizar para congelar a data correta.`);
  if(stored.document.rendererVersion==='4'){const {finalizeReportV4}=await import('./remote-services.ts');if(!stored.version.sha256)throw new Error('Hash da versão indisponível.');return finalizeReportV4({reportId,versionId,expectedSha256:stored.version.sha256,acceptedWarnings:review.acceptedWarnings});}
  const settings=await loadReportClientSettings(db,stored.draft.clientId),preset=resolveReportPreset(settings,stored.draft.clientId,stored.draft.stationId,stored.draft.presetVersion,stored.draft.documentRendererVersion,stored.draft.fixedText);
  if(stored.draft.references.some(r=>!settings?.references.some(approved=>JSON.stringify(approved)===JSON.stringify(r))))throw new Error("Referência do relatório não corresponde ao cadastro técnico autenticado.");
  const reviewed=structuredClone(stored.draft);reviewed.acknowledgements=Object.fromEntries(review.acceptedWarnings.map(w=>[w.issueId,{actorUid:review.actorUid,reason:w.reason}]));
  const issues=validateClientReport(reviewed,preset);if(!canFinalizeReport(issues))throw new Error("Resolva os impedimentos e justifique os avisos antes de finalizar.");
  const root=doc(db,"clientReports",reportId),version=doc(root,"versions",versionId);
  await runTransaction(db,async tx=>{const current=await tx.get(root),v=await tx.get(version);if(!current.exists()||current.data().revision!==expectedRevision||current.data().currentVersionId!==versionId||v.data()?.status!=="draft")throw new Error("Conflito: a versão atual mudou durante a revisão.");tx.update(version,{status:"finalized",review,reviewedAt:serverTimestamp()});tx.update(root,{status:"finalized",updatedAt:serverTimestamp()});});
  return versionSummary(reportId,versionId,(await getDoc(version)).data()!);
}
export async function listClientReports(db:Firestore,filter:{clientId?:ReportClientId;period?:string},after?:string):Promise<{items:ReportSummary[];nextCursor:string|null}>{
  const constraints:QueryConstraint[]=[];if(filter.clientId)constraints.push(where("clientId","==",filter.clientId));if(filter.period)constraints.push(where("period","==",filter.period));constraints.push(orderBy("period","desc"),orderBy(documentId(),"desc"));
  if(after){const cursor=await getDoc(doc(db,"clientReports",after));if(!cursor.exists())throw new Error("Página do histórico não encontrada; atualize a listagem.");constraints.push(startAfter(cursor));}
  constraints.push(limit(21));const snapshots=await getDocs(query(collection(db,"clientReports"),...constraints)),rows=snapshots.docs.slice(0,20);
  return {items:rows.map(s=>({id:s.id,...s.data(),updatedAt:stamp(s.data().updatedAt)}) as ReportSummary),nextCursor:snapshots.size>20?rows.at(-1)!.id:null};
}
export async function listClientReportVersions(db:Firestore,reportId:string):Promise<ReportVersionSummary[]>{const versions=await getDocs(query(collection(db,"clientReports",reportId,"versions"),orderBy("revision","desc")));return versions.docs.filter(s=>s.data().status!=="writing").map(s=>versionSummary(reportId,s.id,s.data()));}
