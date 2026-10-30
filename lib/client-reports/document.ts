import type {ClientReportDraft,ReportPreset} from './types.ts';
import {buildReportDocument as buildV2} from './document-v2.ts';
import {buildReportDocumentV3} from './document-v3.ts';
import {buildReportDocumentV4} from './document-v4.ts';
export const REPORT_RENDERER_VERSION='3';
export function buildReportDocument(draft:ClientReportDraft,preset:ReportPreset,mode:'draft'|'finalized'){
 return draft.documentRendererVersion==='4'?buildReportDocumentV4(draft,preset,mode):draft.documentRendererVersion==='3'?buildReportDocumentV3(draft,preset,mode):buildV2(draft,preset,mode);
}
