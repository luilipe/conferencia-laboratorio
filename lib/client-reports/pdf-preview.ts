import type {ReportDocument,ReportVersionSummary} from './types.ts';
export function reportPdfPreviewKey(document:Pick<ReportDocument,'id'|'mode'>|null,version:Pick<ReportVersionSummary,'versionId'|'sha256'>|null,dirty:boolean):string{return JSON.stringify([document?.id,version?.versionId,version?.sha256,document?.mode,dirty]);}
