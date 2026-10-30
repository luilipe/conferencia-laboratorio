import type {ClientReportDraft,ReportPreset,ReportDocument} from './types.ts';
import {buildReportDocument as buildV2} from './document-v2.ts';
import {buildLabComparison} from './lab-history.ts';
import {effectiveReportData,confirmedCampaignRemoval} from './calculations.ts';
import {validateClientReport} from './validation.ts';
/** Opt-in only. Saved v1/v2 snapshots retain their renderers and original content. */
export function buildReportDocumentV3(draft:ClientReportDraft,preset:ReportPreset,mode:'draft'|'finalized'):ReportDocument {
 let required:Set<string>;
 if(draft.fixedText?.monthlyRequirements){
  required=new Set(preset.requiredSections);
  for(const [sec,req] of Object.entries(draft.fixedText.monthlyRequirements)){
   if(req==='required')required.add(sec);
   else if(req==='conditional')required.delete(sec);
  }
 } else {
  required=new Set([...preset.requiredSections,...draft.fixedText?.monthlySections??[]]);
 }
 const renderDraft=structuredClone(draft),data=effectiveReportData(draft);
 renderDraft.selection.efficiencyPairs=draft.selection.efficiencyPairs.filter(p=>confirmedCampaignRemoval(data.lab.find(r=>r.id===p.inletId),data.lab.find(r=>r.id===p.outletId),p.parameter,draft.period,draft.stationId)!==null);
 const content=buildV2(renderDraft,{...preset,requiredSections:[...required]},mode);
 content.issues=validateClientReport(draft,preset);
 content.rendererVersion='3';
 if(draft.fixedText?.layout)content.modelLayout=structuredClone(draft.fixedText.layout);
 if(draft.fixedText?.laboratoryTables?.length){
  const lab=content.sections.find(s=>s.id==='laboratory')!,comparison=buildLabComparison(draft,preset);
  lab.orientation='portrait';lab.paragraphs=['Referências declaradas do modelo original, não homologadas para avaliação automática. As unidades dos resultados são preservadas em cada célula. —: sem resultado na fonte.'];
  lab.tables=draft.fixedText.laboratoryTables.flatMap(original=>{
   const tables=comparison.tables.filter(t=>t.title.startsWith(original.pointId==='bruto'?'Entrada / Equalizado':'Saída / Tratado'));
   return tables.map(t=>{
    const key=(v:string)=>v.trim().toLocaleLowerCase('pt-BR');
    const rows=original.rows.flatMap(row=>{
     const found=t.rows.filter(r=>key(r[0])===key(row[0]));
     return found.length?found.map(r=>[...row,...r.slice(2)]):[[...row,...t.columns.slice(2).map(()=> 'Sem resultado na fonte')]];
    });
    const extras=t.rows.filter(row=>!original.rows.some(r=>key(r[0])===key(row[0]))&&row.slice(2).some(cell=>cell!=='Sem resultado na fonte')).map(row=>[row[0],'—',...original.columns.slice(2).map(()=> '—'),...row.slice(2)]);
    return {...t,title:original.title,columns:[original.columns[0],'Unidade VMP',...original.columns.slice(2),...t.columns.slice(2).map(h=>h.split(' · ')[0])],rows:[...rows,...extras].map(row=>row.map(cell=>cell==='Sem resultado na fonte'?'—':cell))};
   });
  });
  const covered=new Set(lab.tables.map(t=>t.id));
  lab.tables.push(...comparison.tables.filter(t=>!covered.has(t.id)&&t.sourceIds.length>0));
 }
 content.sections=content.sections.filter(s=>!['sources','history'].includes(s.id)&&(s.id!=='observations'||draft.narratives.observations.trim())).map(s=>({...s,
  paragraphs:s.paragraphs.filter(p=>!p.startsWith('Resultados transcritos dos modelos')&&!p.startsWith('Fonte:')),
  tables:s.tables.map(t=>({...t,rows:t.rows.map(row=>row.map(cell=>cell.replace(/ \[R\d+\]/g,'')))}))
 }));
 const identity=content.sections.find(s=>s.id==='identity');
 if(identity){identity.title='Dados do Requerente e Equipe envolvida no Relatório';identity.tables=[
  {id:'requester',title:'Identificação do requerente',columns:['Requerente','Dados da unidade'],rows:[[draft.identity.requesterName||draft.identity.clientDisplayName,[draft.identity.facilityName,draft.identity.address,[draft.identity.city,draft.identity.state].filter(Boolean).join(' / '),draft.identity.postalCode?`CEP: ${draft.identity.postalCode}`:'',draft.identity.taxId?`CNPJ/MF: ${draft.identity.taxId}`:'',draft.identity.phone?`Telefone: ${draft.identity.phone}`:'',draft.identity.stateRegistration?`Inscrição estadual: ${draft.identity.stateRegistration}`:''].filter(Boolean).join('\n')]],sourceIds:[]},
  {id:'team',title:'Equipe envolvida no projeto',columns:['Responsável técnico','Registro'],rows:[[draft.identity.responsibleName,draft.identity.responsibleRegistration]],sourceIds:[]}
 ];}
 return content;
}
