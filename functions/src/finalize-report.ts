import {FieldValue} from 'firebase-admin/firestore';
import type {ReportClientSettings,ReportServiceRequest,ReportVersionSummary} from '../../lib/client-reports/types.ts';
import {adminDb,assertReportAccess} from '../../backend/report-access.ts';
import {readReportSnapshot,validateReportServiceRequest} from '../../backend/report-snapshot.ts';
import {conclusionDataKey} from '../../lib/client-reports/conclusion.ts';
import {resolveReportPreset} from '../../lib/client-reports/presets.ts';
import {validateClientReport,canFinalizeReport} from '../../lib/client-reports/validation.ts';
import {assertTechnicalApprover} from './report-ai-core.ts';
import {canonicalReportJson} from '../../lib/client-reports/snapshot.ts';
export async function finalizeReportV4(uid:string,value:ReportServiceRequest & {acceptedWarnings:{issueId:string;reason:string}[]}):Promise<ReportVersionSummary>{
 const {acceptedWarnings,...ids}=value,request=validateReportServiceRequest(ids);const actor=await assertReportAccess(uid),stored=await readReportSnapshot(request),db=adminDb();
 if(stored.document.rendererVersion!=='4'||stored.version.status!=='draft')throw new Error('Finalize somente um rascunho moderno salvo.');
 const config=db.doc(`clientReportClients/${stored.draft.clientId}`),configDoc=await config.get(),settings=configDoc.data() as ReportClientSettings;
 if(!settings)throw new Error('Cadastro técnico indisponível.');assertTechnicalApprover(uid,settings);
 if(!Array.isArray(acceptedWarnings)||acceptedWarnings.length>10000||acceptedWarnings.some(w=>!w||typeof w.issueId!=='string'||typeof w.reason!=='string'||!w.reason.trim()||w.reason.length>4000))throw new Error('Justificativas de revisão inválidas.');
 if(!stored.draft.conclusionState?.reviewed||stored.draft.conclusionState.dataKey!==conclusionDataKey(stored.draft))throw new Error('Revise a conclusão, o resumo e os encaminhamentos desta versão.');
 if(canonicalReportJson(stored.draft.editorialModel)!==canonicalReportJson(settings.editorialModels?.[stored.draft.stationId]))throw new Error('O texto editorial não corresponde ao cadastro aprovado.');
 if(stored.draft.references.some(r=>!settings.references.some(a=>canonicalReportJson(a)===canonicalReportJson(r))))throw new Error('Referências divergentes do cadastro técnico.');
 const reviewed=structuredClone(stored.draft);reviewed.acknowledgements=Object.fromEntries(acceptedWarnings.map(w=>[w.issueId,{actorUid:uid,reason:w.reason}]));
 const preset=resolveReportPreset(settings,reviewed.clientId,reviewed.stationId,reviewed.presetVersion,'4');if(!canFinalizeReport(validateClientReport(reviewed,preset)))throw new Error('Resolva os impedimentos e justifique os avisos antes de finalizar.');
 const root=db.doc(`clientReports/${request.reportId}`),version=root.collection('versions').doc(request.versionId),approval=root.collection('approvals').doc(request.versionId),review={actorUid:uid,actorName:actor.displayName,acceptedWarnings};
 await db.runTransaction(async tx=>{const [r,v,c]=await Promise.all([tx.get(root),tx.get(version),tx.get(config)]);if(!c.updateTime?.isEqual(configDoc.updateTime!)||r.data()?.currentVersionId!==request.versionId||r.data()?.revision!==reviewed.revision||v.data()?.sha256!==request.expectedSha256||v.data()?.status!=='draft')throw new Error('Conflito: versão ou cadastro alterados durante a revisão.');tx.update(version,{status:'finalized',review,reviewedAt:FieldValue.serverTimestamp()});tx.update(root,{status:'finalized',updatedAt:FieldValue.serverTimestamp()});tx.create(approval,{actorUid:uid,actorName:actor.displayName,sha256:request.expectedSha256,versionId:request.versionId,reviewedAt:FieldValue.serverTimestamp()});});
 return {...stored.version,status:'finalized',review,reviewedAt:new Date().toISOString()};
}
