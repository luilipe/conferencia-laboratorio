import * as XLSX from 'xlsx';
import { createReportDraft } from '../../lib/client-reports/presets.ts';
import { parseReportValue } from '../../lib/client-reports/values.ts';
export const v = (raw,unit='mg/L') => parseReportValue(raw,unit);
export const source = {id:'synthetic',name:'Exemplo sintético',sha256:'a'.repeat(64),kind:'lab',size:100,importedAt:'2026-10-05T12:00:00Z',importedByUid:'reviewer-1',adapterVersion:'1'};
export const context = {clientId:'demo13',period:'2026-09',actorUid:'reviewer-1',importedAt:source.importedAt,stationId:'etdi'};
export function makeDraft(overrides={}) { const d=createReportDraft('demo13','etdi','2026-09'); d.presetVersion='1'; delete d.selection.labComparison; d.id='report-1'; d.identity={...d.identity,facilityName:'Unidade sintética',responsibleName:'Revisor de teste',responsibleRegistration:'REG-TESTE',issueDate:'2026-10-05'}; d.narratives={presentation:'Demonstração sintética.',observations:'Dados de teste.',conclusion:'Conclusão de demonstração; requer revisão humana.'}; return {...d,...overrides}; }
export const mrHeaders=['N° Amostra','Identificação','Empresa Solicitante','Data de Coleta','Data de Publicação','Identificação da Análise','Resultado da Análise','Unidade de Medida da Análise'];
export function createMrWorkbook(rows,headerOrder=mrHeaders){ const w=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([headerOrder,...rows.map(r=>headerOrder.map(h=>r[h]??null))]),'Samples');return w; }
export function workbook(rows,name='Dados') { const w=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),name);return w; }
export function lab(overrides={}) {return {id:'lab-1',labId:'MR',sampleBase:'sample-1',revision:1,sampleNumber:'sample-1.1',stationId:'etdi',pointId:'bruto',identification:'Bruto',company:'Sintético',date:'2026-09-01',time:null,publicationDate:null,parameter:'DBO',value:v(1254),source:{sourceId:source.id},...overrides};}
