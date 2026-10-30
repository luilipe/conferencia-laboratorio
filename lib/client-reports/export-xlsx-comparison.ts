import type {ClientReportDraft} from './types.ts';
import {exportReportXlsx as legacyXlsx} from './export-v1.ts';
import {scopeReportPeriod} from './period.ts';
import {getReportPreset} from './presets.ts';
import {buildLabComparison,labCollectionPeriod} from './lab-history.ts';
import {effectiveReportData} from './calculations.ts';

export async function exportReportXlsxComparison(draft:ClientReportDraft,mode:'draft'|'finalized'):Promise<Blob>{
 const XLSX=await import('xlsx'),base=await legacyXlsx(scopeReportPeriod(draft),mode),book=XLSX.read(await base.arrayBuffer(),{type:'array'});
 const comparison=buildLabComparison(draft,getReportPreset(draft.clientId,draft.stationId,draft.presetVersion));
 const rows:string[][]=[['Comparação mensal',...comparison.months],['Resultados transcritos dos modelos — conferência pendente']];
 for(const table of comparison.tables)rows.push([], [table.title],table.columns,...table.rows);
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Comparativo');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([comparison.origins.columns,...comparison.origins.rows]),'Origens comparativo');
 const results=book.Sheets.Resultados,grid=XLSX.utils.sheet_to_json<unknown[]>(results,{header:1}),headerIndex=grid.findIndex(row=>row[0]==='ID'),width=grid[headerIndex].length;
 XLSX.utils.sheet_add_aoa(results,[['Precisão da coleta','Competência da coleta','Referência declarada (não homologada)']],{origin:{r:headerIndex,c:width}});
 const records=new Map(effectiveReportData(draft).lab.map(r=>[r.id,r]));
 grid.forEach((row,i)=>{const record=records.get(String(row[0]));if(record)XLSX.utils.sheet_add_aoa(results,[[record.datePrecision??'day',labCollectionPeriod(record)??'',record.declaredReference??'']],{origin:{r:i,c:width}});});
 return new Blob([XLSX.write(book,{type:'array',bookType:'xlsx'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
