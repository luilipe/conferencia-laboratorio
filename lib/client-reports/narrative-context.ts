import type {ClientReportDraft,ReportPreset,NarrativeContext,NarrativeEvidence} from './types.ts';
import {effectiveReportData,confirmedCampaignRemoval} from './calculations.ts';
import {labCollectionPeriod,labHistoryMonths} from './lab-history.ts';
import {formatReportValue,convertReportValue,exactValue} from './values.ts';
export function buildNarrativeContext(draft:ClientReportDraft,preset:ReportPreset):NarrativeContext{
 const data=effectiveReportData(draft),evidence:NarrativeEvidence[]=[];
 const point=(id:string|null)=>preset.points.find(p=>p.id===id)?.label??'Ponto a confirmar';
 const rows=data.lab.filter(r=>r.stationId===draft.stationId&&labCollectionPeriod(r)===draft.period);
 for(const r of rows)evidence.push({id:r.id,kind:'result',text:`${r.parameter}; ${point(r.pointId)}; coleta ${r.date||draft.period+' (dia não informado)'}: ${formatReportValue(r.value)}.`,sourceIds:[r.source.sourceId]});
 const months=labHistoryMonths(draft.period,draft.selection.labComparison?.previousMonths??0);
 const history=data.lab.filter(r=>r.stationId===draft.stationId&&labCollectionPeriod(r)!==draft.period&&months.includes(labCollectionPeriod(r)??'')&&rows.some(c=>c.pointId===r.pointId&&c.parameter===r.parameter&&convertReportValue(r.value,c.value.unit).status!=='invalid'));
 for(const r of history)evidence.push({id:`history:${r.id}`,kind:'result',text:`Histórico selecionado (${labCollectionPeriod(r)}); ${r.parameter}; ${point(r.pointId)}: ${formatReportValue(r.value)}. A comparação isolada não comprova tendência ou causa.`,sourceIds:[r.source.sourceId]});
 for(const r of data.operations.filter(r=>r.stationId===draft.stationId&&r.date.slice(0,7)===draft.period))evidence.push({id:r.id,kind:'result',text:`${r.parameter}; ${point(r.pointId)}; ${r.date} ${r.time??r.shift??''}: ${formatReportValue(r.value)}.`,sourceIds:[r.source.sourceId]});
 for(const r of data.journal.filter(r=>r.date.slice(0,7)===draft.period))evidence.push({id:r.id,kind:'event',text:`${r.date}: ${r.text}. Estado registrado: ${r.plantState}.`,sourceIds:[r.source.sourceId]});
 for(const parameter of preset.parameters)if(![...rows,...data.operations.filter(r=>r.date.slice(0,7)===draft.period&&r.stationId===draft.stationId)].some(r=>r.parameter===parameter&&r.value.status==='measured'))evidence.push({id:`gap:${parameter}`,kind:'gap',text:`${parameter}: informações insuficientes na competência.`,sourceIds:[]});
 for(const pair of draft.selection.efficiencyPairs){const a=rows.find(r=>r.id===pair.inletId),b=rows.find(r=>r.id===pair.outletId);
  const n=confirmedCampaignRemoval(a,b,pair.parameter,draft.period,draft.stationId);
  evidence.push(n===null?{id:`gap:efficiency:${pair.inletId}:${pair.outletId}`,kind:'gap',text:`${pair.parameter}: eficiência não calculada por falta de pareamento ou valores compatíveis.`,sourceIds:[]}:{id:`efficiency:${a!.id}:${b!.id}`,kind:'calculation',text:`${pair.parameter}: remoção calculada de ${n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}% no par confirmado da coleta ${a!.date}.`,sourceIds:[a!.id,b!.id]});
 }
 for(const ref of draft.references.filter(r=>r.approvedByUid&&r.source&&r.application&&(r.min!==null||r.max!==null))){
  evidence.push({id:ref.id,kind:'reference',text:`${ref.parameter}; ponto ${point(ref.pointId)}; referência ${ref.source}, versão ${ref.version}; mínimo ${ref.min??'não definido'}, máximo ${ref.max??'não definido'} ${ref.unit}; aplicação: ${ref.application}.`,sourceIds:[]});
  for(const r of rows.filter(r=>r.parameter===ref.parameter&&r.pointId===ref.pointId)){const value=convertReportValue(r.value,ref.unit);if(!exactValue(value))continue;const outside=ref.min!==null&&value.value<ref.min||ref.max!==null&&value.value>ref.max;evidence.push({id:`comparison:${r.id}:${ref.id}`,kind:'calculation',text:`${r.parameter} em ${point(r.pointId)}: resultado ${outside?'fora':'dentro'} dos limites da referência ${ref.source} (${ref.version}) para esta amostra.`,sourceIds:[r.id,ref.id]});}
 }
 if(!rows.length&&!evidence.some(e=>e.kind==='result'))evidence.push({id:'gap:results',kind:'gap',text:'Não há resultados atuais suficientes para interpretação técnica.',sourceIds:[]});
 if(!data.journal.some(r=>r.date.slice(0,7)===draft.period))evidence.push({id:'gap:journal',kind:'gap',text:'Sem diário disponível para avaliar continuidade operacional ou ausência de ocorrências.',sourceIds:[]});
 const inputKey=JSON.stringify([[...rows,...history].map(r=>[r.id,r.parameter,r.pointId,r.date,r.value,r.source,r.campaignId]),data.operations.filter(r=>r.stationId===draft.stationId&&r.date.slice(0,7)===draft.period).map(r=>[r.id,r.value,r.source]),draft.selection,draft.references,draft.editorialModel]);
 return {clientId:draft.clientId,stationId:draft.stationId,period:draft.period,evidence,instructionsVersion:'1',inputKey};
}
export async function narrativeContextHash(context:NarrativeContext):Promise<string>{const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;const bytes=new TextEncoder().encode(JSON.stringify(canonical(context)));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
