import type {ClientReportDraft, ReportClientSettings, ImportBatch} from './types.ts';
import {applyFixedModelText} from './fixed-text.ts';
import {buildDefaultMethodology} from './identity.ts';
import {mergeReportImport} from './editor.ts';
import {applyLabHistorySelection, labCollectionPeriod, labHistoryMonths} from './lab-history.ts';
import {selectLatestLabRevisions} from './import-lab.ts';
import {updateConclusionState} from './conclusion.ts';
import {effectiveReportData,calculateRemoval} from './calculations.ts';
import {reportDate} from './values.ts';

/** Pure preparation. Never imports narratives, meter baselines or events from another month. */
export function prepareMonthlyReport(draft:ClientReportDraft, settings:ReportClientSettings|null, batch:ImportBatch):ClientReportDraft {
 let next=structuredClone(draft);
 if(settings?.clientId===draft.clientId){
  if(draft.revision===0&&!draft.fixedText&&!draft.identity.facilityName&&!draft.narratives.methodology&&!draft.narratives.presentation&&!draft.data.sources.length){
   next.identity={...next.identity,...settings.identities[draft.stationId],issueDate:next.identity.issueDate};
   next.narratives={...next.narratives,...buildDefaultMethodology(settings,draft.stationId)};
   next=applyFixedModelText(next,settings);
   next.selection.optionalChartIds??=settings.enabledOptionalCharts?.[`${draft.stationId}@2`]??[];
   next.selection.labComparison=settings.labComparisonPreferences?.[draft.stationId]??next.selection.labComparison;
  }
 }
 const months=labHistoryMonths(draft.period,next.selection.labComparison?.previousMonths??0);
 const lab=batch.lab.map(r=>{
  if(r.stationId&&r.pointId)return r;
  const matches=settings?.clientId===draft.clientId?settings.mappings.filter(m=>m.labId===r.labId&&m.companyAlias===r.company&&m.identification===r.identification):[];
  return matches?.length===1?{...r,stationId:matches[0].stationId,pointId:matches[0].pointId}:r;
 }).filter(r=>(!r.stationId||r.stationId===draft.stationId)&&(!labCollectionPeriod(r)||months.includes(labCollectionPeriod(r)!)));
 const monthly=<T extends {date:string}>(rows:T[])=>rows.filter(r=>!reportDate(r.date)||r.date.slice(0,7)===draft.period);
 const station=<T extends {stationId:string}>(rows:T[])=>rows.filter(r=>r.stationId===draft.stationId);
 const scoped={...batch,lab,operations:monthly(station(batch.operations)),supplies:monthly(station(batch.supplies)),meters:monthly(batch.meters),journal:monthly(batch.journal)};
 const ids=new Set([...scoped.lab,...scoped.operations,...scoped.supplies,...scoped.meters,...scoped.journal].map(r=>r.id));
 scoped.issues=batch.issues.filter(i=>!i.recordIds.length||i.recordIds.some(id=>ids.has(id)));
 const usedSources=new Set([...scoped.lab,...scoped.operations,...scoped.supplies,...scoped.meters,...scoped.journal].map(r=>r.source.sourceId));
 scoped.sources=batch.sources.filter(s=>usedSources.has(s.id));
 next=mergeReportImport(next,scoped);
 // Preserve explicit selection in an existing saved/edited draft. New imports add only eligible latest rows.
 const selected=applyLabHistorySelection(next).selection.selectedLabIds;
 const existing=new Set(draft.data.lab.map(r=>r.id));
 const incoming=new Set(next.data.lab.filter(r=>!existing.has(r.id)).map(r=>r.id));
 next.selection.selectedLabIds=[...new Set([...next.selection.selectedLabIds,...selected.filter(id=>incoming.has(id))])];
 const excluded=new Set([...next.selection.excludedRecordIds,...next.corrections.map(c=>c.originalId)]);
 const revisions=selectLatestLabRevisions(next.data.lab.filter(r=>r.stationId===next.stationId&&!excluded.has(r.id)));
 next.data.issues=[...new Map([...next.data.issues,...revisions.issues].map(i=>[i.id,i])).values()];
 const current=effectiveReportData(next).lab.filter(r=>labCollectionPeriod(r)===draft.period&&r.campaignId);
 for(const campaignId of new Set(current.map(r=>r.campaignId))){
  const rows=current.filter(r=>r.campaignId===campaignId);
  for(const parameter of ['DBO','DQO']){
   const inlets=rows.filter(r=>r.parameter===parameter&&['bruto','equalizado'].includes(r.pointId??'')),outlets=rows.filter(r=>r.parameter===parameter&&r.pointId==='tratado');
   if(inlets.length!==1||outlets.length!==1)continue;
   const [inlet]=inlets,[outlet]=outlets;
   if((incoming.has(inlet.id)||incoming.has(outlet.id))&&reportDate(inlet.date)&&inlet.date===outlet.date&&calculateRemoval(inlet.value,outlet.value)!==null&&!next.selection.efficiencyPairs.some(p=>p.inletId===inlet.id&&p.outletId===outlet.id))next.selection.efficiencyPairs.push({parameter,inletId:inlet.id,outletId:outlet.id,declaredId:null});
  }
 }
 return updateConclusionState(draft,next);
}
