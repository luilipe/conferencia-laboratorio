import type {ClientReportDraft,ReportPreset,ReportDocument,ReportSection,LabResult,ReportTable} from './types.ts';
import {buildReportDocument as buildV1} from './document-v1.ts';
import {getReportPreset} from './presets.ts';
import {effectiveReportData} from './calculations.ts';
import {formatReportValue,displayReportDate,normalizeParameter} from './values.ts';
import {validateClientReport} from './validation.ts';
import {buildReportCharts,reportChartTable} from './charts.ts';
import {IDENTITY_LABELS} from './identity.ts';
import {DEMO13_LAB_PARAMETERS as demo13Parameters,hasLabComparison,labCollectionPeriod,labCollectionLabel,buildLabComparison} from './lab-history.ts';
import {scopeReportPeriod} from './period.ts';
import {parseFixedModelText} from './fixed-text.ts';
export const REPORT_RENDERER_VERSION='2';
const added=(id:string,title:string,paragraphs:string[]):ReportSection=>({id,title,paragraphs,tables:[],charts:[],orientation:'portrait'});
// Reference parameter labels only; no result or legal limit is taken from a prior month.

export function buildReportDocument(draft:ClientReportDraft,preset:ReportPreset,mode:'draft'|'finalized'):ReportDocument{
 if(draft.presetVersion==='1')return buildV1(draft,preset.version==='1'?preset:getReportPreset(draft.clientId,draft.stationId,'1'),mode);
 if(draft.presetVersion!=='2'||preset.version!=='2')throw new Error('Modelo ou versão incompatível.');
 const comparison=hasLabComparison(draft),data=effectiveReportData(draft),current=data.lab.filter(r=>(comparison?labCollectionPeriod(r):r.date.slice(0,7))===draft.period);
 const scoped=scopeReportPeriod(draft);
 const doc=buildV1(scoped,preset,mode);doc.rendererVersion='2';doc.issues=validateClientReport(draft,preset);
 const identity=doc.sections.find(s=>s.id==='identity')!;identity.tables[0].rows.push(...Object.entries(IDENTITY_LABELS).filter(([k])=>['postalCode','city','state','phone','stateRegistration'].includes(k)&&draft.identity[k as keyof typeof draft.identity]).map(([k,label])=>[label,String(draft.identity[k as keyof typeof draft.identity])]));
 const table=(id:string,title:string,rows:LabResult[],expected:string[]=[]):ReportTable=>{
  const recordRows=rows.map(r=>[comparison?labCollectionLabel(r):displayReportDate(r.date),[r.time,preset.points.find(p=>p.id===r.pointId)?.label].filter(Boolean).join(' / '),r.parameter,formatReportValue(r.value),draft.references.filter(ref=>ref.parameter===r.parameter&&ref.pointId===r.pointId).map(ref=>`${ref.source} (${ref.version}) — ${ref.approvedByUid?'homologada':'pendente'}`).join('; ')||'Sem referência homologada',`${r.labId} / ${r.sampleNumber} · r${r.revision}`,r.id]);
  for(const parameter of expected)if(!rows.some(r=>normalizeParameter(r.parameter)===normalizeParameter(parameter)))recordRows.push(['—','—',parameter,'Fonte mensal pendente','Sem referência homologada','—','—']);
  return {id,title,columns:['Coleta','Horário / ponto','Parâmetro','Resultado e unidade','Referência técnica','Laboratório / laudo','Origem'],rows:recordRows,sourceIds:rows.map(r=>r.id)};
 };
 const labs=doc.sections.find(s=>s.id==='laboratory')!;labs.orientation='landscape';
 if(draft.clientId==='demo13')labs.tables=['bruto','tratado'].map(id=>table(`lab-${id}`,`Quadro completo ${id==='bruto'?'Entrada / Equalizado':'Saída / Tratado'}`,current.filter(r=>r.pointId===id),demo13Parameters));
 if(draft.clientId==='demo01'){
  const groups:[string,string,(r:LabResult)=>boolean][]=[['lab-organic','DBO e DQO — quatro pontos',r=>['DBO','DQO'].includes(r.parameter)],['lab-chlorinated','Clorados e aromáticos',r=>/clorad|arom[aá]t|cloroform|benzen|tolueno|xileno|dicloro|tricloro|tetracloro|estireno/i.test(r.parameter)],['lab-sedimentable','Sólidos sedimentáveis',r=>/sediment|^SS30$|^SS60$/i.test(r.parameter)],['lab-oils','Óleos e graxas',r=>/[óo]leo|graxa/i.test(r.parameter)],['lab-suspended','Sólidos suspensos totais / fixos / voláteis',r=>/suspens|^SST$|^SSF$|^SSV$/i.test(r.parameter)]];
  labs.tables=groups.map(([id,title,filter])=>table(id,title,current.filter(filter)));
  const other=current.filter(r=>!groups.some(([, ,f])=>f(r)));if(other.length)labs.tables.push(table('lab-other','Outros resultados selecionados',other));
 }
 if(draft.clientId==='demo14'){
  const groups:[string,string,RegExp][]=[['cor','Cor aparente',/cor/i],['fluoreto','Fluoreto',/fluoreto|floureto/i],['coli','Escherichia coli',/coli/i],['bacteria','Bactérias heterotróficas',/bact|heterotr/i],['cloro','Cloro residual livre',/cloro/i]];
  labs.tables=groups.map(([id,title,re])=>table(`lab-${id}`,title,current.filter(r=>re.test(r.parameter))));const other=current.filter(r=>!groups.some(([, ,re])=>re.test(r.parameter)));if(other.length)labs.tables.push(table('lab-physical','Outros resultados físico-químicos',other));
 }
 const history=doc.sections.find(s=>s.id==='history')!;history.tables=[table('history','Histórico explicitamente selecionado',data.lab.filter(r=>!r.date.startsWith(draft.period)))];
 if(comparison){const result=buildLabComparison(draft,preset);labs.tables=result.tables;if(result.currentIds.length)labs.paragraphs=labs.paragraphs.filter(p=>p!=='Sem resultados laboratoriais selecionados para esta competência.');labs.paragraphs.push('Resultados transcritos dos modelos — conferência pendente. Referências declaradas não homologadas; sem médias implícitas. As chaves [R…] ligam cada resultado ao quadro de origens e não são números de laudo.');history.orientation='landscape';history.paragraphs=[`Janela de meses consecutivos: ${result.months.join(' · ')}. Meses sem fonte permanecem vazios. As matrizes estão na seção de laboratório.`];history.tables=[result.origins];const outside=data.lab.filter(r=>!result.months.includes(labCollectionPeriod(r)??''));if(outside.length)history.tables.push(table('history-outside','Resultados selecionados fora da janela',outside));}
 const supplies=doc.sections.find(s=>s.id==='supplies')!;supplies.tables[0].title='Consumos, entregas e produção de lodo — eventos separados';
 doc.sections.push(added('objective','Objetivo',[`Apresentar e avaliar os dados da competência ${draft.period.split('-').reverse().join('/')} da unidade ${draft.identity.facilityName||'a confirmar'} — ${preset.label}. A avaliação técnica é revisada antes da emissão.`]),added('methodology','Metodologia e descrição da unidade',[draft.narratives.methodology||'Descrição da unidade e metodologia pendente de fonte e revisão.',`Fonte: ${draft.narratives.methodologySource||'pendente'}`]),added('bibliography','Bibliografia e referências',draft.references.map(r=>`${r.source} — versão ${r.version}. Aplicação: ${r.application}. ${r.approvedByUid?'Homologada':'Pendente de aprovação'}`)));
 const counts:Record<string,number>={laboratory:current.length,operations:scoped.data.operations.length,meters:scoped.data.meters.length,supplies:scoped.data.supplies.length,journal:scoped.data.journal.length,history:history.tables.reduce((n,t)=>n+t.rows.length,0),efficiency:draft.selection.efficiencyPairs.length,statistics:scoped.data.operations.length,bibliography:draft.references.length};
 for(const s of doc.sections){s.charts=buildReportCharts(draft,preset,s.id);for(const c of s.charts){const data=reportChartTable(c);s.tables.push({id:`chart-${c.id}`,title:`Dados de ${c.title}`,columns:data.columns,rows:data.rows,sourceIds:c.series.flatMap(s=>s.points.flatMap(p=>p.sourceIds??[]))});}if(s.id in counts&&!counts[s.id]&&preset.requiredSections.includes(s.id))s.paragraphs.push('Fonte mensal pendente — nenhum resultado foi preenchido com dados de outro mês.');}
 const fixed=draft.fixedText?parseFixedModelText(draft.fixedText):null,fixedIds=new Set(fixed?.sections.map(s=>s.id));
 for(const original of fixed?.sections??[]){let s=doc.sections.find(s=>s.id===original.id);if(!s){s=added(original.id,original.title,[]);doc.sections.push(s);}s.title=original.title;s.paragraphs=[...original.paragraphs,...s.paragraphs.filter(p=>p.startsWith('Fonte mensal pendente'))];}
 const sectionOrder=(preset.sectionOrder??[]).flatMap(id=>id==='presentation'&&fixedIds.has('technical-introduction')?[id,'technical-introduction']:[id]);
 doc.sections=sectionOrder.flatMap(id=>{const s=doc.sections.find(s=>s.id===id);return s&&(preset.requiredSections.includes(id)||fixedIds.has(id)||!(id in counts)||counts[id]>0||s.charts.length)?[s]:[];});
 return structuredClone(doc);
}
