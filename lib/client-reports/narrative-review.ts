import type {ClientReportDraft,NarrativeContext,NarrativeSuggestion,ReportAiOrigin} from './types.ts';
import {buildNarrativeContext,narrativeContextHash} from './narrative-context.ts';
import {getReportPreset} from './presets.ts';
import {conclusionDataKey} from './conclusion.ts';
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const numbers=(s:string):string[]=>s.match(/[-+]?\d[\d.,]*/g)??[];
const terms=(s:string):string[]=>s.match(/\b(?:DBO|DQO|SS30|SS60|SST|SSF|SSV|pH|Cloro|Condutividade|Alcalinidade|Fluoreto|Turbidez)\b/g)??[];
function quantities(text:string){
 const result:{parameter:string|undefined;operator:string;number:string;unit:string}[]=[],allTerms=terms(text);
 const pattern=/(?:(<=|>=|≤|≥|<|>|=)\s*)?([-+]?\d[\d.,]*)\s*(NMP\/100\s*mL|UFC\/mL|mg\/L|kg\/L|[µμ]g\/L|g\/L|mL\/L|[µμ]S\/cm|mS\/cm|m³|m3|°C|NTU|uT|kg|g|L|%)(?![\p{L}/])/gu;
 for(const m of text.matchAll(pattern))result.push({parameter:terms(text.slice(0,m.index)).at(-1)??(allTerms.length===1?allTerms[0]:undefined),operator:(m[1]??'=').replace('≤','<=').replace('≥','>='),number:m[2].replace(/[.,]$/,''),unit:m[3].replace(/\s/g,'').replace('μ','µ')});
 if(allTerms.includes('pH')&&!result.some(q=>q.parameter==='pH')){const m=text.match(/\bpH\s*[:=]?\s*(<=|>=|≤|≥|<|>|=)?\s*([-+]?\d[\d.,]*)/)??text.match(/:\s*(<=|>=|≤|≥|<|>|=)?\s*([-+]?\d[\d.,]*)\.?$/);if(m)result.push({parameter:'pH',operator:(m[1]??'=').replace('≤','<=').replace('≥','>='),number:m[2].replace(/[.,]$/,''),unit:''});}
 return result;
}
export function validateNarrativeSuggestion(value:unknown,context:NarrativeContext):NarrativeSuggestion{
 const s=value as NarrativeSuggestion;
 const text=(v:unknown,max=4000):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/<(?:script|iframe|img)|https?:\/\//i.test(v);
 if(!s||!text(s.conclusion)||!Array.isArray(s.summary)||s.summary.length>4||!Array.isArray(s.actions)||s.actions.length>10||!Array.isArray(s.limitations)||s.limitations.length>20||s.limitations.some(l=>!text(l))||!Array.isArray(s.claims)||!s.claims.length||s.claims.length>20)throw new Error('A sugestão não tem a estrutura esperada.');
 const known=new Map(context.evidence.map(e=>[e.id,e]));
 const supported=(item:{text:string;evidenceIds:string[]})=>{
  if(!text(item.text)||!Array.isArray(item.evidenceIds)||!item.evidenceIds.length||item.evidenceIds.some(id=>typeof id!=='string'||!known.has(id)))throw new Error('Afirmação sem evidência válida deste relatório.');
  const evidence=item.evidenceIds.map(id=>known.get(id)!.text).join(' '),allowed=new Set(numbers(evidence));
  if(numbers(item.text).some(n=>!allowed.has(n)))throw new Error('A sugestão introduziu um número não sustentado pela evidência.');
  if(terms(item.text).some(t=>!terms(evidence).includes(t)))throw new Error('Parâmetro da afirmação não corresponde à evidência.');
  const sourceQuantities=item.evidenceIds.flatMap(id=>quantities(known.get(id)!.text)),claimQuantities=quantities(item.text);
  if(claimQuantities.some(q=>!sourceQuantities.some(a=>(!q.parameter||a.parameter===q.parameter)&&a.number===q.number&&a.unit===q.unit&&a.operator===q.operator))||!claimQuantities.length&&numbers(item.text).length>0&&sourceQuantities.length>0)throw new Error('Resultado, unidade ou operador não corresponde à tupla da evidência.');
  if(/garant(?:e|ia|ir)|plenamente conforme|água (?:segura|potável)|ausência de (?:riscos|ocorrências)|sem (?:riscos|ocorrências)|operação (?:contínua|ininterrupta)/i.test(item.text))throw new Error('Afirmação ampla exige redação e avaliação técnica manual.');
 };
 for(const claim of s.claims)supported(claim);
 if(clean(s.conclusion)!==clean(s.claims.map(c=>c.text).join('\n\n')))throw new Error('A conclusão deve ser composta somente pelas afirmações fundamentadas.');
 const ids=new Set<string>();for(const finding of s.summary){if(!finding||!text(finding.id,100)||ids.has(finding.id))throw new Error('Resumo inválido.');ids.add(finding.id);supported(finding);}
 for(const action of s.actions){if(!action||!text(action.id,100)||!text(action.findingId,100)||!text(action.proposal,1000)||action.responsible!==null||action.dueDate!==null||action.status!=='proposed'||(!ids.has(action.findingId)&&!known.has(action.findingId)))throw new Error('Ação deve ser proposta, sem responsável ou prazo presumidos.');supported({text:action.proposal,evidenceIds:action.evidenceIds});}
 for(const limitation of s.limitations)if(!context.evidence.some(e=>e.kind==='gap'&&clean(e.text)===clean(limitation)))throw new Error('Limitação deve reproduzir uma lacuna documentada.');
 return structuredClone(s);
}
export async function applyNarrativeSuggestion(draft:ClientReportDraft,suggestion:NarrativeSuggestion,origin:ReportAiOrigin):Promise<ClientReportDraft>{
 const context=buildNarrativeContext(draft,getReportPreset(draft.clientId,draft.stationId,draft.presetVersion));
 if(await narrativeContextHash(context)!==origin.contextHash)throw new Error('O contexto foi alterado. Gere uma nova sugestão antes de aplicar.');
 const accepted=validateNarrativeSuggestion(suggestion,context),next=structuredClone(draft);
 next.narratives.conclusion=accepted.conclusion;next.editorial={version:'1',summary:accepted.summary,actions:accepted.actions,limitations:accepted.limitations,scope:draft.editorial?.scope??'A avaliação se limita aos dados e registros documentados nesta competência.'};next.aiOrigin=origin;next.conclusionState={dataKey:conclusionDataKey(next),reviewed:false,stale:false};return next;
}
