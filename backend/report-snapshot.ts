import type {ReportServiceRequest,StoredReportSnapshot,ReportVersionSummary,SerializedSnapshot} from '../lib/client-reports/types.ts';
import {deserializeReportSnapshot,assertSnapshotRenderer} from '../lib/client-reports/snapshot.ts';
import {adminDb} from './report-access.ts';
export function validateReportServiceRequest(value:unknown):ReportServiceRequest{
 const r=value as ReportServiceRequest;
 if(!r||Object.keys(r).some(k=>!['reportId','versionId','expectedSha256'].includes(k))||!['reportId','versionId'].every(k=>typeof r[k as keyof ReportServiceRequest]==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(r[k as keyof ReportServiceRequest]))||!/^[a-f0-9]{64}$/.test(r.expectedSha256))throw new Error('Identificação ou hash da versão inválidos.');return r;
}
export async function readReportSnapshot(value:ReportServiceRequest):Promise<StoredReportSnapshot>{
 const request=validateReportServiceRequest(value),db=adminDb(),ref=db.doc(`clientReports/${request.reportId}/versions/${request.versionId}`),v=await ref.get(),meta=v.data();
 if(!meta||!['draft','finalized'].includes(meta.status)||meta.sha256!==request.expectedSha256)throw new Error('Versão ausente, incompleta ou alterada.');
 if(meta.chunkCount>10000||meta.totalBytes>50*1024*1024)throw new Error('Relatório acima do limite de processamento.');
 const parts=await ref.collection('chunks').get();if(parts.size!==meta.chunkCount)throw new Error('Snapshot incompleto.');
 const {draft,document}=await deserializeReportSnapshot({chunks:parts.docs.map(d=>d.data()) as SerializedSnapshot['chunks'],sha256:meta.sha256,totalBytes:meta.totalBytes});
 assertSnapshotRenderer({draft,document},meta.rendererVersion);
 if(draft.id!==request.reportId||draft.revision!==meta.revision||document.rendererVersion!==meta.rendererVersion||draft.clientId!==meta.clientId||draft.stationId!==meta.stationId||draft.period!==meta.period||meta.reportId!==request.reportId||meta.versionId!==request.versionId||(draft.documentRendererVersion==='4')!==(meta.rendererVersion==='4'))throw new Error('Identidade ou renderizador divergente no snapshot.');
 document.mode=meta.status==='finalized'?'finalized':'draft';return {draft,document,version:{...meta,createdAt:meta.createdAt.toDate().toISOString(),reviewedAt:meta.reviewedAt?.toDate().toISOString()} as ReportVersionSummary};
}
