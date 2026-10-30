import type {ClientReportDraft,ReportPreset} from './types.ts';
import {effectiveReportData,confirmedCampaignRemoval} from './calculations.ts';
import {labCollectionPeriod} from './lab-history.ts';
import {formatReportValue} from './values.ts';

/** Stable exact content key, not a security hash; the snapshot itself is SHA-256 protected. */
export function conclusionDataKey(draft:ClientReportDraft):string {
 const {issueDate,...stableIdentity}=draft.identity;
 void issueDate;
 return JSON.stringify([draft.clientId,draft.stationId,draft.period,draft.data,draft.selection,draft.references,draft.corrections,...(['3','4'].includes(draft.documentRendererVersion??'')?[draft.fixedText,stableIdentity,draft.narratives,draft.documentRendererVersion]:[]),...(draft.documentRendererVersion==='4'?[draft.editorial,draft.editorialModel,draft.narratives.conclusion]:[])]);
}
export function updateConclusionState(before:ClientReportDraft,next:ClientReportDraft):ClientReportDraft {
 if(!before.conclusionState)return next;
 const changed=conclusionDataKey(before)!==conclusionDataKey(next);
 return {...next,conclusionState:{...(next.conclusionState??before.conclusionState),reviewed:changed||before.narratives.conclusion!==next.narratives.conclusion?false:(next.conclusionState??before.conclusionState).reviewed,stale:changed||(next.conclusionState??before.conclusionState).stale||false}};
}
export function suggestReportConclusion(draft:ClientReportDraft,preset:ReportPreset):string {
 const effective=effectiveReportData(draft),current=effective.lab.filter(r=>labCollectionPeriod(r)===draft.period);
 const point=(id:string|null)=>preset.points.find(p=>p.id===id)?.label??'ponto a confirmar';
 const lines=[`Na competência ${draft.period.split('-').reverse().join('/')}, ${preset.label} apresenta ${current.length} resultado(s) laboratorial(is) selecionado(s) da coleta do mês.`];
 const missingParameters:string[]=[];
 for(const parameter of preset.parameters){
  const rows=current.filter(r=>r.parameter===parameter&&r.value.status==='measured');
  if(!rows.length){
   const operations=effective.operations.filter(r=>r.date.slice(0,7)===draft.period&&r.parameter===parameter&&r.value.status==='measured');
   if(operations.length){lines.push(`${parameter}: ${operations.length} medição(ões) operacional(is) no mês. ${operations.slice(0,3).map(r=>`${point(r.pointId)} em ${r.date.split('-').reverse().join('/')}: ${formatReportValue(r.value)}`).join('; ')}${operations.length>3?'; demais medições nas tabelas.':'.'}`);}else{lines.push(`${parameter}: informações insuficientes na fonte atual.`);missingParameters.push(parameter);}
   continue;
  }
  // Each campaign stays separate. No unweighted mean, historical number or limit is introduced.
  for(const r of rows)lines.push(`${parameter} em ${point(r.pointId)}, coleta ${r.date? r.date.split('-').reverse().join('/'):'sem dia informado'}: ${formatReportValue(r.value)}.`);
 }
 if(missingParameters.length>0&&preset.parameters.length>missingParameters.length){
  lines.push(`Ressalta-se que nesta competência as determinações restringiram-se aos parâmetros analíticos indicados, sem registros de ensaios para: ${missingParameters.join(', ')}.`);
 }
 let count=0;
 for(const pair of draft.selection.efficiencyPairs){
  const inlet=current.find(r=>r.id===pair.inletId),outlet=current.find(r=>r.id===pair.outletId);
  const removal=confirmedCampaignRemoval(inlet,outlet,pair.parameter,draft.period,draft.stationId);
  if(removal!==null){lines.push(`${pair.parameter}: remoção calculada de ${removal.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}% para o par de campanha confirmado.`);count++;}
 }
 if(!count)lines.push('Eficiência não calculada: dados ou pareamento de campanha insuficientes.');
 const approvedRefs=draft.references.filter(r=>!r.id.startsWith("fixed-model:")&&!r.id.startsWith("renderer-approval:"));
 if(approvedRefs.length>0){
  lines.push(`Parâmetros avaliados conforme as referências técnicas cadastradas para a instalação: ${approvedRefs.map(r=>`${r.parameter} (${r.source})`).join(', ')}.`);
 }else{
  lines.push('A avaliação de atendimento depende da revisão técnica e das referências aplicáveis.');
 }
 return lines.join('\n\n');
}
