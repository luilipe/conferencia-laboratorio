import type {LabResult,ClientReportDraft,ReportPreset,ReportIssue,LabComparison,ReportTable} from './types.ts';
import {reportDate,displayReportDate,reportIssue,formatReportValue,normalizeParameter,isUnitlessReportParameter} from './values.ts';
import {selectLatestLabRevisions} from './import-lab.ts';
import {effectiveReportData} from './calculations.ts';
import {getReportPreset} from './presets.ts';

export const DEMO13_LAB_PARAMETERS=['Fluoreto','Sulfato','Sulfeto','Sólidos Sedimentáveis','Óleos & Graxas (Substâncias Solúveis em Hexano)','Óleos Minerais','Óleos Vegetais/Gorduras Animais','Cianeto Total','Cianeto Livre','Fenóis Totais (Índice de Fenóis)','DBO','DQO','Arsênio','Cádmio','Chumbo','Cobre Total','Cobre Dissolvido','Mercúrio','Prata','Selênio','Cromo Total','Cromo Trivalente','Cromo Hexavalente','Zinco','Estanho','Níquel','Ferro Dissolvido','Bário','Boro','Manganês Total','Manganês Dissolvido','Benzeno','Clorofórmio','Dicloroetenos','Estireno','Etilbenzeno','Tetracloreto de Carbono','Tricloroeteno','Tolueno','Xilenos (Total)','pH (campo)','Óleos e Graxas','Nitrogênio Amoniacal','Temperatura da Amostra','Temperatura Ambiente'];
export function hasLabComparison(draft:ClientReportDraft){return draft.presetVersion==='2'&&draft.selection.labComparison?.version===1;}
export function defaultLabComparison(clientId:ClientReportDraft['clientId']):NonNullable<ClientReportDraft['selection']['labComparison']>{return {version:1,previousMonths:clientId==='demo13'?2:clientId==='demo02'?1:0};}
export function labCollectionPeriod(r:LabResult):string|null{
 if(r.datePrecision==='month')return r.date===''&&/^\d{4}-(0[1-9]|1[0-2])$/.test(r.collectionPeriod??'')?r.collectionPeriod!:null;
 return reportDate(r.date)===r.date&&r.date?r.date.slice(0,7):null;
}
export function labCollectionLabel(r:LabResult):string{return r.datePrecision==='month'&&labCollectionPeriod(r)?`${r.collectionPeriod!.split('-').reverse().join('/')} — dia não informado`:displayReportDate(r.date);}
export function labHistoryMonths(period:string,previousMonths:0|1|2|3):string[]{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||Number(period.slice(0,4))<1900||![0,1,2,3].includes(previousMonths))throw Error('Competência ou quantidade de meses inválida.');
 const [year,month]=period.split('-').map(Number);return Array.from({length:previousMonths+1},(_,i)=>{const d=new Date(Date.UTC(year,month-1-previousMonths+i,1));return d.toISOString().slice(0,7);});
}
export function applyLabHistorySelection(draft:ClientReportDraft):ClientReportDraft{
 if(!hasLabComparison(draft))return draft;
 const months=labHistoryMonths(draft.period,draft.selection.labComparison!.previousMonths),excluded=new Set([...draft.selection.excludedRecordIds,...draft.corrections.map(c=>c.originalId)]);
 const latest=selectLatestLabRevisions(draft.data.lab.filter(r=>r.stationId===draft.stationId)).active;
 const next=structuredClone(draft);next.selection.selectedLabIds=latest.filter(r=>!excluded.has(r.id)&&months.includes(labCollectionPeriod(r)??'')).map(r=>r.id);return next;
}
export function modelResultIssues(draft:ClientReportDraft):ReportIssue[]{
 if(!hasLabComparison(draft))return [];
 const rows=effectiveReportData(draft).lab,issues:ReportIssue[]=[];
 const requiresLab=getReportPreset(draft.clientId,draft.stationId,draft.presetVersion).requiredSections.includes('laboratory')||draft.fixedText?.monthlySections?.includes('laboratory');
 if(requiresLab&&!rows.some(r=>labCollectionPeriod(r)===draft.period))issues.push(reportIssue('current-lab-missing','Sem resultado laboratorial da competência. Histórico não substitui a fonte atual.'));
 for(const r of rows)if(r.datePrecision==='month')issues.push(reportIssue('model-day-missing',`${labCollectionLabel(r)}: confirmar dia de coleta; sem pareamento de eficiência.`,[r.id],labCollectionPeriod(r)===draft.period?'blocker':'warning'));
 const excluded=new Set([...draft.selection.excludedRecordIds,...draft.corrections.map(c=>c.originalId)]),selected=new Set(rows.map(r=>r.id));
 const available=selectLatestLabRevisions(draft.data.lab.filter(r=>r.stationId===draft.stationId)).active.filter(r=>!excluded.has(r.id));
 const groups=new Map<string,LabResult[]>();
 for(const r of available.filter(r=>r.modelAlternativeGroup&&!r.sampleNumber)){
  const key=JSON.stringify([r.modelAlternativeGroup,r.stationId,r.pointId,r.date||r.collectionPeriod,r.parameter,r.value.unit]);groups.set(key,[...(groups.get(key)??[]),r]);
 }
 for(const records of groups.values()){
  const active=records.filter(r=>selected.has(r.id));if(!active.length)continue;
  const different=(a:LabResult,b:LabResult)=>JSON.stringify([a.value.value,a.value.operator,a.value.qualitative,a.value.status])!==JSON.stringify([b.value.value,b.value.operator,b.value.qualitative,b.value.status]);
  if(active.some(a=>active.some(b=>different(a,b))))issues.push(reportIssue('model-source-conflict','Origens alternativas dos modelos divergem. Confira as fontes e selecione/exclua explicitamente com motivo; nenhuma origem prevalece automaticamente.',active.map(r=>r.id)));
  const unaudited=records.filter(r=>!selected.has(r.id)&&active.some(a=>different(a,r))&&(!draft.acknowledgements[`exclude:${r.id}`]?.reason.trim()||!draft.acknowledgements[`exclude:${r.id}`]?.actorUid.trim()));
  if(unaudited.length)issues.push(reportIssue('model-source-decision-required','Alternativa divergente desmarcada: registre exclusão com autor e motivo para resolver a escolha da origem.',unaudited.map(r=>r.id)));
 }
 return issues;
}
function groupLabel(r:LabResult,draft:ClientReportDraft,preset:ReportPreset){
 if(!r.pointId||!preset.points.some(p=>p.id===r.pointId)||!r.value.unit&&!isUnitlessReportParameter(r.parameter))return 'Ponto ou unidade a confirmar';
 const point=preset.points.find(p=>p.id===r.pointId)!.label;
 if(draft.clientId==='demo13'||draft.clientId==='demo02')return `${r.pointId==='bruto'?'Entrada / Equalizado':r.pointId==='tratado'?'Saída / Tratado':point}`;
 if(draft.clientId==='demo01'){
  const p=r.parameter;const group=['DBO','DQO'].includes(p)?'DBO e DQO':/clorad|arom[aá]t/i.test(p)?'Clorados e aromáticos':/sediment/i.test(p)?'Sólidos sedimentáveis':/[óo]leo|graxa/i.test(p)?'Óleos e graxas':'Sólidos suspensos';return `${group} — ${point}`;
 }
 if(draft.clientId==='demo14')return `${/coli|bact|heterotr/i.test(r.parameter)?'Microbiologia':'Físico-química'} — ${point}`;
 return point;
}
export function buildLabComparison(draft:ClientReportDraft,preset:ReportPreset):LabComparison{
 const months=labHistoryMonths(draft.period,draft.selection.labComparison?.previousMonths??0);
 const records=effectiveReportData(draft).lab.filter(r=>months.includes(labCollectionPeriod(r)??''));
 const groups=new Map<string,LabResult[]>();for(const r of records){const label=groupLabel(r,draft,preset);groups.set(label,[...(groups.get(label)??[]),r]);}
 if(draft.clientId==='demo13')for(const label of ['Entrada / Equalizado','Saída / Tratado'])if(!groups.has(label))groups.set(label,[]);
 if(!groups.size)groups.set('Resultados laboratoriais',[]);
 const tables:ReportTable[]=[],keys=new Map(draft.data.lab.map((r,i)=>[r.id,`[R${i+1}]`]));
 for(const [label,rows] of groups){
  const slots:{key:string;label:string;records:LabResult[]}[]=[];
  for(const month of months){const monthly=rows.filter(r=>labCollectionPeriod(r)===month).sort((a,b)=>a.date.localeCompare(b.date)||(a.time??'').localeCompare(b.time??'')||a.sampleBase.localeCompare(b.sampleBase));
   const collections=new Map<string,LabResult[]>();for(const r of monthly){let key=JSON.stringify([r.date||r.collectionPeriod,r.time,r.pointId,r.labId,r.sampleBase,r.source.sourceId]);
    // A duplicate parameter in the same sample is an alternative, never an implicit mean.
    if(collections.get(key)?.some(n=>n.parameter===r.parameter&&n.value.unit===r.value.unit))key+=`/${r.id}`;
    collections.set(key,[...(collections.get(key)??[]),r]);
   }
   if(!collections.size)slots.push({key:month,label:month.split('-').reverse().join('/'),records:[]});
   let i=0;for(const [key,values] of collections){const first=values[0];slots.push({key,label:`${labCollectionLabel(first)}${first.time?' '+first.time:''} · coleta ${++i}${first.sampleNumber?' · '+first.sampleNumber:' · laudo não informado'}`,records:values});}
  }
  const parameters=new Map<string,{parameter:string;unit:string;pointId:string|null}>();for(const r of rows)parameters.set(JSON.stringify([r.parameter,r.value.unit,r.pointId]),{parameter:r.parameter,unit:r.value.unit,pointId:r.pointId});
  if(draft.clientId==='demo13'&&['Entrada / Equalizado','Saída / Tratado'].includes(label))for(const parameter of DEMO13_LAB_PARAMETERS)if(!rows.some(r=>normalizeParameter(r.parameter)===normalizeParameter(parameter)))parameters.set(parameter,{parameter,unit:'',pointId:label==='Entrada / Equalizado'?'bruto':'tratado'});
  for(let start=0;start<slots.length;start+=4){const page=slots.slice(start,start+4);tables.push({id:`comparison-${tables.length+1}`,title:`${label}${start?' — continuação '+(start/4+1):''}`,columns:['Parâmetro / ponto','Unidade',...page.map(s=>s.label)],rows:[...parameters.values()].map(r=>[`${r.parameter}${label==='Ponto ou unidade a confirmar'?' / '+(r.pointId??'ponto não informado'):''}`,r.unit||'Não informada',...page.map(s=>{const found=s.records.find(n=>n.parameter===r.parameter&&n.value.unit===r.unit&&n.pointId===r.pointId);return found?formatReportValue(found.value,'source')+' '+keys.get(found.id):'Sem resultado na fonte';})]),sourceIds:page.flatMap(s=>s.records.map(r=>r.id))});}
 }
 const origins:ReportTable={id:'comparison-origins',title:'Origens do comparativo — resultados transcritos dos modelos; conferência pendente',columns:['Chave na matriz / ID','Coleta / precisão','Ponto / parâmetro','Arquivo / SHA-256','Localização / laudo','Referência declarada (não homologada)'],rows:records.map(r=>{const s=draft.data.sources.find(s=>s.id===r.source.sourceId);return [`${keys.get(r.id)}\n${r.id}`,`${labCollectionLabel(r)} (${r.datePrecision??'day'})`,`${r.pointId??'Ponto a confirmar'} / ${r.parameter}`,`${s?.name??r.source.sourceId}\n${s?.sha256??''}`,`${r.source.sheet??''} ${r.source.cell??''}\n${r.sampleNumber||'Laudo não informado'}`,r.declaredReference??'Não informada'];}),sourceIds:records.map(r=>r.id)};
 return {months,currentIds:records.filter(r=>labCollectionPeriod(r)===draft.period).map(r=>r.id),historicalIds:records.filter(r=>labCollectionPeriod(r)!==draft.period).map(r=>r.id),tables,origins,issues:modelResultIssues(draft)};
}
