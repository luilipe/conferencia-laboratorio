import type {ClientReportDraft,ReportClientId,ReportClientSettings,EditorialModel,ReportEditorial,NarrativeContext} from './types.ts';
export const EDITORIAL_SCOPE='A avaliação considera os resultados e registros identificados neste relatório, referentes à competência indicada. As interpretações se limitam aos parâmetros, pontos e períodos documentados.';
const focus: Partial<Record<ReportClientId, string>> = {
  demo13: 'Resultados de entrada e saída, campanhas e desempenho do tratamento.',
  demo24: 'Controle dos processos de Esmaltação e Polidora e insumos documentados.',
  'demo08': 'Resultados por ponto de controle e acompanhamento operacional.',
  demo09: 'Resultados analíticos, controle operacional e eficiências documentadas.',
  demo14: 'Resultados da água nos pontos amostrados e volumes comprovados.',
  demo02: 'Acompanhamento dos reatores, tratamento final e insumos documentados.',
  demo01: 'Resultados analíticos, controle operacional, ocorrências e volumes comprovados.',
};

export function getEditorialProposal(clientId: ReportClientId, stationId: string): EditorialModel {
  const clientFocus = focus[clientId] ?? 'Acompanhamento analítico da unidade e conformidade com limites aplicáveis.';
  return {
    version: '1',
    sourceHash: '',
    sections: [
      { id: 'presentation', title: 'Apresentação', paragraphs: ['Este relatório apresenta os resultados do acompanhamento da unidade e da competência identificadas na capa, com os principais achados, pontos de atenção e encaminhamentos.'] },
      { id: 'objective', title: 'Objetivo do acompanhamento', paragraphs: [clientFocus, 'Apoiar a avaliação técnica e a definição de melhorias. Comparações com critérios aplicáveis são identificadas junto aos parâmetros avaliados.'] },
    ],
  };
}
export function getEditorialSectionOrder(clientId:ReportClientId,stationId:string):string[]{
 void stationId;
 void clientId;
 return [
  'executive-summary',
  'station-description',
  'presentation',
  'technical-introduction',
  'objective',
  'identity',
  'methodology',
  'laboratory',
  'charts',
  'efficiency',
  'operations',
  'journal',
  'statistics',
  'meters',
  'supplies',
  'observations',
  'conclusion',
  'actions',
  'bibliography',
  'references'
 ];
}
export function applyEditorialModel(draft:ClientReportDraft,settings:ReportClientSettings):ClientReportDraft{
 const model=settings.clientId===draft.clientId?settings.editorialModels?.[draft.stationId]:undefined;
 if(!model?.approvedByUid?.trim()||!model.approvedAt||!/^[a-f0-9]{64}$/.test(model.sourceHash))return structuredClone(draft);
 const next=structuredClone(draft);next.editorialModel=structuredClone(model);return next;
}
export function initialReportEditorial(context:NarrativeContext):ReportEditorial{
 const facts=context.evidence.filter(e=>e.kind==='calculation'),gaps=context.evidence.filter(e=>e.kind==='gap');
 const results=context.evidence.filter(e=>e.kind==='result'&&!e.id.startsWith('history:')).sort((a,b)=>Number(/tratado|saída/i.test(b.text))-Number(/tratado|saída/i.test(a.text)));
 const unique=new Map<string,typeof results[number]>();for(const r of results){const key=r.text.split(';').slice(0,2).join(';');if(!unique.has(key))unique.set(key,r);}
 return {version:'1',scope:EDITORIAL_SCOPE,summary:[...facts,...unique.values()].slice(0,4).map(e=>({id:e.id,text:e.text,evidenceIds:[e.id]})),actions:[],limitations:gaps.map(e=>e.text)};
}
