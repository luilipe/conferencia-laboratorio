import type {ReportDocument,ReportChart,ClientReportDraft} from './types.ts';
import {scopeReportPeriod} from './period.ts';
import {hasLabComparison} from './lab-history.ts';
import {exportReportXlsxComparison} from './export-xlsx-comparison.ts';
import * as legacy from './export-v1.ts';
import {exportReportDocxV2,exportReportPdfV2} from './export-v2.ts';
import {renderReportChartV2} from './chart-renderer.ts';
import {reportChartTable as tableV2} from './charts.ts';
import {exportReportDocxV4} from './export-v4.ts';
export {reportFileName} from './export-v1.ts';
export async function exportReportXlsx(draft:ClientReportDraft,mode:'draft'|'finalized'='draft'):Promise<Blob>{
 if(!['1','2'].includes(draft.presetVersion))throw new Error('Esta versão do modelo não está disponível.');
 if(hasLabComparison(draft))return exportReportXlsxComparison(draft,mode);
 return legacy.exportReportXlsx(draft.presetVersion==='2'?scopeReportPeriod(draft):draft,mode);
}
function renderer(content:ReportDocument){if(!['1','2','3','4'].includes(content.rendererVersion))throw new Error('Esta versão do renderizador não está disponível.');return content.rendererVersion;}
export function renderReportChart(chart:ReportChart,rendererVersion:'1'|'2'='1'):string {return rendererVersion==='2'?renderReportChartV2(chart):legacy.renderReportChart(chart);}
export function reportChartTable(chart:ReportChart){return chart.kind?tableV2(chart):legacy.reportChartTable(chart);}
export async function exportReportDocx(content:ReportDocument):Promise<Blob>{return renderer(content)==='4'?exportReportDocxV4(content):renderer(content)!=='1'?exportReportDocxV2(content):legacy.exportReportDocx(content);}
export async function exportReportPdf(content:ReportDocument,fonts?:{regular:string;bold:string;math:string}):Promise<Blob>{if(renderer(content)==='4')throw new Error('Salve a versão e use a exportação PDF do relatório moderno.');return renderer(content)!=='1'?exportReportPdfV2(content,fonts):legacy.exportReportPdf(content,fonts);}
