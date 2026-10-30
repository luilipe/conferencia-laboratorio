import type { ClientReportDraft, ReportPreset, ReportIssue, ReportValue } from "./types.ts";
import { reportIssue, exactValue, convertReportValue, reportDate, isUnitlessReportParameter } from "./values.ts";
import { effectiveReportData, calculateRemoval, calculateMeterIntervals,confirmedCampaignRemoval } from "./calculations.ts";
import { selectLatestLabRevisions } from "./import-lab.ts";
import {hasLabComparison,labCollectionPeriod,labHistoryMonths,modelResultIssues} from './lab-history.ts';
import { validateManualBatch } from "./manual.ts";
import {conclusionDataKey} from './conclusion.ts';

export function validateClientReport(draft:ClientReportDraft,preset:ReportPreset):ReportIssue[]{
  const comparison=hasLabComparison(draft),effective=effectiveReportData(draft),monthly=(r:{date:string})=>r.date.slice(0,7)===draft.period;
  const data=comparison?{...effective,operations:effective.operations.filter(monthly),supplies:effective.supplies.filter(monthly),meters:effective.meters.filter(monthly),journal:effective.journal.filter(monthly)}:effective;
  const issues:ReportIssue[]=[],excluded=new Set([...draft.selection.excludedRecordIds,...draft.corrections.map(c=>c.originalId)]);
  const all=[...draft.data.lab,...draft.data.operations,...draft.data.meters,...draft.data.supplies,...draft.data.journal];
  const relevant=(id:string)=>{const r=all.find(x=>x.id===id);return !excluded.has(id)&&(!r||!("stationId" in r)||!r.stationId||r.stationId===draft.stationId);};
  const recalculated=["point-unmapped","unit-missing","operation-invalid","lab-conflict","revision-incomplete","outside-period","manual-source-incomplete"];
  issues.push(...draft.data.issues.filter(i=>!recalculated.includes(i.code)&&(i.code==="record-conflict"?i.recordIds.filter(relevant).length>1:!i.recordIds.length||i.recordIds.some(relevant))));
  if(!preset.enabled)issues.push(reportIssue("preset-disabled","Modelo disponível como rascunho. Administrador deve homologar e habilitar esta versão."));
  if((draft.conclusionState||['3','4'].includes(draft.documentRendererVersion??''))&&(!draft.conclusionState?.reviewed||draft.conclusionState.dataKey!==conclusionDataKey(draft)))issues.push(reportIssue('conclusion-review-required','Revise a conclusão com os resultados atuais e confirme a revisão na etapa Conclusão.'));
  if(['3','4'].includes(draft.documentRendererVersion??'')&&!draft.fixedText)issues.push(reportIssue('fixed-model-missing','Cadastro inicial pendente: administrador deve carregar os textos originais deste cliente/estação. Não é preenchimento mensal.'));
  if(draft.documentRendererVersion==='4'){
    if(!draft.editorialModel?.approvedByUid)issues.push(reportIssue('editorial-model-missing','Aprove os textos editoriais desta estação no cadastro técnico.'));
    if(!draft.editorial?.scope.trim()||draft.editorial.summary.some(s=>!s.text.trim())||draft.editorial.actions.some(a=>!a.proposal.trim()))issues.push(reportIssue('editorial-incomplete','Revise o escopo, os achados e os encaminhamentos antes de emitir.'));
  }
  if(preset.clientId!==draft.clientId||preset.stationId!==draft.stationId||preset.version!==draft.presetVersion)issues.push(reportIssue("preset-mismatch","Modelo não corresponde ao cliente/estação/versão."));
  if(draft.presetVersion==='2'&&(!draft.narratives.methodology?.trim()||!draft.narratives.methodologySource?.trim()))issues.push(reportIssue('methodology-missing','Revise a descrição da unidade/metodologia e informe a fonte antes de finalizar.'));
  if(!draft.identity.clientDisplayName.trim()||!draft.identity.facilityName.trim()||!draft.identity.responsibleName.trim()||!draft.identity.responsibleRegistration.trim()||!reportDate(draft.identity.issueDate))issues.push(reportIssue("identity-incomplete","Complete unidade, responsável, registro técnico e data de emissão."));
  for(const [key,label] of [["presentation","apresentação"],["conclusion","conclusão"]] as const)if(!draft.narratives[key].trim())issues.push(reportIssue("narrative-missing",`Revise e preencha a ${label}.`));
  const sectionLabels:Record<string,string>={laboratory:'resultados laboratoriais',operations:'medições operacionais',meters:'hidrômetros',supplies:'insumos',journal:'diário',efficiency:'eficiência com campanha comprovada'};
  let required:string[];
  if(['3','4'].includes(draft.documentRendererVersion??'')){
    if(draft.fixedText?.monthlyRequirements){
      const set=new Set(preset.requiredSections);
      for(const [sec,req] of Object.entries(draft.fixedText.monthlyRequirements)){
        if(req==='required')set.add(sec);
        else if(req==='conditional')set.delete(sec);
      }
      required=[...set];
    } else {
      required=[...new Set([...preset.requiredSections,...draft.fixedText?.monthlySections??[]])];
    }
  } else {
    required=preset.requiredSections;
  }
  for(const section of required){const count:Record<string,number>={laboratory:data.lab.filter(r=>labCollectionPeriod(r)===draft.period).length,operations:data.operations.length,meters:data.meters.length,supplies:data.supplies.length,journal:data.journal.length};if(['3','4'].includes(draft.documentRendererVersion??''))count.efficiency=draft.selection.efficiencyPairs.filter(p=>confirmedCampaignRemoval(data.lab.find(r=>r.id===p.inletId),data.lab.find(r=>r.id===p.outletId),p.parameter,draft.period,draft.stationId)!==null).length;if(section in count&&!count[section])issues.push(reportIssue("section-missing",['3','4'].includes(draft.documentRendererVersion??'')?`Importe a fonte da competência para ${sectionLabels[section]??section}; seção obrigatória sem registros.`:`Seção obrigatória sem registros: ${section}.`));}
  const current=data.lab.filter(r=>(comparison?labCollectionPeriod(r):r.date.slice(0,7))===draft.period);
  issues.push(...modelResultIssues(draft));
  // An undated record must remain actionable even when automatic month selection omitted it.
  if(['3','4'].includes(draft.documentRendererVersion??''))for(const r of all.filter(r=>relevant(r.id)))if(!reportDate(r.date)&&!('labId' in r&&labCollectionPeriod(r)))issues.push(reportIssue('date-invalid','Confirme a data na origem ou exclua o registro com justificativa.',[r.id]));
  for(const parameter of preset.parameters)if(![...current,...data.operations].some(r=>r.parameter===parameter&&r.value.status==="measured"))issues.push(reportIssue("parameter-missing",`Parâmetro obrigatório sem medição válida: ${parameter}.`,[],(current.length>0||data.operations.length>0)?"warning":"blocker"));
  const pointIds=new Set(preset.points.map(p=>p.id));
  for(const r of (comparison&&!['3','4'].includes(draft.documentRendererVersion??'')?data.lab:draft.data.lab).filter(r=>!excluded.has(r.id)&&(!r.stationId||r.stationId===draft.stationId)))if(!r.stationId||!r.pointId||!pointIds.has(r.pointId))issues.push(reportIssue("point-unmapped",`Confirme estação/ponto da amostra ${r.sampleNumber}.`,[r.id]));
  const check=(r:{id:string;date:string},value:ReportValue,parameter:string)=>{
    if(!reportDate(r.date)&&!(comparison&&"datePrecision" in r&&r.datePrecision==="month"&&labCollectionPeriod(r as import("./types.ts").LabResult)))issues.push(reportIssue("date-invalid","Data ausente ou inválida.",[r.id]));
    if(!value.unit&&!isUnitlessReportParameter(parameter))issues.push(reportIssue("unit-missing",`Unidade não informada para ${parameter}.`,[r.id]));
    if(value.status==="invalid"||value.status==="missing")issues.push(reportIssue("value-unavailable",`Valor ${value.status==="invalid"?"inválido/ambíguo":"ausente"}: ${parameter}.`,[r.id],preset.parameters.includes(parameter)?"blocker":"warning"));
  };
  for(const r of [...data.lab,...data.operations]){check(r,r.value,r.parameter);if(!r.pointId||!pointIds.has(r.pointId))issues.push(reportIssue("point-unmapped","Ponto não reconhecido neste modelo.",[r.id]));if((comparison&&"labId" in r?labCollectionPeriod(r):r.date.slice(0,7))!==draft.period&&!(['3','4'].includes(draft.documentRendererVersion??'')&&"labId" in r&&labHistoryMonths(draft.period,draft.selection.labComparison?.previousMonths??0).includes(labCollectionPeriod(r)??'')))issues.push(reportIssue("outside-period","Registro fora do mês selecionado; confirme uso histórico.",[r.id],"warning"));}
  for(const r of data.supplies)check(r,r.quantity,r.product);
  for(const r of data.meters)check(r,r.declaredIntervalVolume??r.cumulative,"Hidrômetro");
  for(const r of [...data.supplies,...data.meters,...data.journal])if(r.date.slice(0,7)!==draft.period)issues.push(reportIssue("outside-period","Registro fora do mês selecionado; confirme uso histórico.",[r.id],"warning"));
  for(const r of data.meters)if(r.declaredIntervalVolume&&(!reportDate(r.intervalStart)||!reportDate(r.intervalEnd)||r.intervalEnd!==r.date||r.intervalStart!>r.intervalEnd!||!exactValue(r.declaredIntervalVolume)||r.declaredIntervalVolume.value<0))issues.push(reportIssue("meter-interval-invalid","Volume informado exige valor não negativo e início/fim documentados, com fim na data da leitura.",[r.id]));
  const selected=new Set(draft.selection.selectedLabIds);
  const selectedRows=draft.data.lab.filter(r=>relevant(r.id)&&r.stationId===draft.stationId&&(comparison?selected.has(r.id):!selected.size||selected.has(r.id)));
  const revisionContext=draft.data.lab.filter(r=>relevant(r.id)&&selectedRows.some(s=>s.labId===r.labId&&s.sampleBase===r.sampleBase&&r.revision<=s.revision));
  issues.push(...selectLatestLabRevisions(revisionContext).issues);
  issues.push(...validateManualBatch(data));
  for(const pair of draft.selection.efficiencyPairs){
    const inlet=data.lab.find(r=>r.id===pair.inletId),outlet=data.lab.find(r=>r.id===pair.outletId),declared=data.lab.find(r=>r.id===pair.declaredId);
    if(['3','4'].includes(draft.documentRendererVersion??'')&&confirmedCampaignRemoval(inlet,outlet,pair.parameter,draft.period,draft.stationId)===null){issues.push(reportIssue('efficiency-pair-invalid','Eficiência exige campanha documentada comum à entrada e saída, pontos, período, parâmetro e unidades compatíveis.',[pair.inletId,pair.outletId]));continue;}
    if(!inlet||!outlet||inlet.parameter!==pair.parameter||outlet.parameter!==pair.parameter||comparison&&(!reportDate(inlet.date)||!reportDate(outlet.date)||inlet.date.slice(0,7)!==draft.period||outlet.date.slice(0,7)!==draft.period||!inlet.pointId||!outlet.pointId)||inlet.date!==outlet.date||inlet.pointId===outlet.pointId||calculateRemoval(inlet.value,outlet.value)===null){issues.push(reportIssue("efficiency-pair-invalid","Eficiência exige entrada positiva, saída exata, mesma data, parâmetro/unidades compatíveis e pontos distintos.",[pair.inletId,pair.outletId]));continue;}
    const removal=calculateRemoval(inlet.value,outlet.value)!;
    if(removal<0)issues.push(reportIssue("efficiency-negative","Eficiência calculada negativa; confira e registre o ocorrido.",[inlet.id,outlet.id],"warning"));
    if(pair.declaredId&&(!declared||declared.value.unit!=="%"||!exactValue(declared.value)))issues.push(reportIssue("efficiency-declared-invalid","Eficiência declarada precisa ser identificada em porcentagem, com valor exato.",[pair.declaredId]));
    else if(declared&&exactValue(declared.value)&&Math.abs(removal-declared.value.value)>.10)issues.push(reportIssue("efficiency-divergence",`Eficiência declarada (${declared.value.value.toFixed(2)}%) difere da calculada (${removal.toFixed(2)}%). Preserve ambas.`,[inlet.id,outlet.id,declared.id],"warning"));
  }
  for(const meterId of new Set(data.meters.map(m=>m.meterId)))issues.push(...calculateMeterIntervals(data.meters.filter(m=>m.meterId===meterId),draft.selection.meterBaselines[meterId]??null).issues);
  for(const reference of draft.references){
    if(!reference.approvedByUid||!reference.source.trim()||!reference.version.trim()||!reference.application.trim()){issues.push(reportIssue("reference-unapproved","Referência exige fonte, versão, aplicação e aprovação técnica.",[reference.id]));continue;}
    for(const r of [...data.lab,...data.operations].filter(r=>r.parameter===reference.parameter&&r.pointId===reference.pointId)){const value=convertReportValue(r.value,reference.unit);if(exactValue(value)&&((reference.min!==null&&value.value<reference.min)||(reference.max!==null&&value.value>reference.max)))issues.push(reportIssue("reference-exceeded",`Resultado fora da referência homologada: ${reference.parameter}.`,[r.id,reference.id],"warning"));}
  }
  if(draft.clientId==="demo01"&&data.journal.some(j=>j.plantState==="off")&&/cont[ií]nua|ininterrupta|sem parada/i.test(draft.narratives.conclusion))issues.push(reportIssue("operation-narrative-review","Diário registra ETE desligada. Concilie a afirmação de operação contínua na conclusão.",data.journal.filter(j=>j.plantState==="off").map(j=>j.id),"warning"));
  if(/(?:conformidade|conforme|atende|atendimento|padr[aã]o|padr[õo]es)(?:\s+\w+){0,3}\s+(?:legal|legais|legisla[çc][aã]o|decreto|resolu[çc][aã]o|artigo|conama|cetesb)/i.test(draft.narratives.conclusion)&&!draft.references.some(r=>!r.id.startsWith("fixed-model:")&&!r.id.startsWith("renderer-approval:"))){
    issues.push(reportIssue("conclusion-unsupported-legal-claim","A conclusão afirma conformidade legal ou regulamentar sem referências técnicas homologadas para esta unidade no cadastro.",[],"warning"));
  }
  if(/sem ocorr[eê]ncias?|aus[eê]ncia de ocorr[eê]ncias?/i.test(draft.narratives.conclusion)&&data.journal.length===0&&data.operations.length===0){
    issues.push(reportIssue("conclusion-unsupported-operation-claim","A conclusão afirma ausência de ocorrências sem documentação operacional ou diário comprovatório.",[],"warning"));
  }
  const unique=[...new Map(issues.map(i=>[i.id,i])).values()];
  return unique.map(i=>{const ack=draft.acknowledgements[i.id];return ack&&ack.actorUid.trim()&&ack.reason.trim()?{...i,acknowledgedByUid:ack.actorUid,acknowledgement:ack.reason}:i;});
}
export function canFinalizeReport(issues:ReportIssue[]):boolean{return !issues.some(i=>i.severity==="blocker"||!i.acknowledgedByUid||!i.acknowledgement?.trim());}
