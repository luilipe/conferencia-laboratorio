import type {ClientReportDraft} from './types.ts';
import {hasLabComparison} from './lab-history.ts';
import {reportDate} from './values.ts';
import {effectiveReportData} from './calculations.ts';

/** Scope monthly event data identically for all v2 formats; lab history remains explicit. */
export function scopeReportPeriod(draft:ClientReportDraft):ClientReportDraft {
 const scoped=structuredClone(draft),data=effectiveReportData(draft);
 const current=(r:{date:string})=>r.date.slice(0,7)===draft.period;
 scoped.data={...data,operations:data.operations.filter(current),meters:data.meters.filter(current),supplies:data.supplies.filter(current),journal:data.journal.filter(current)};
 scoped.selection.efficiencyPairs=draft.selection.efficiencyPairs.filter(pair=>{
  const inlet=data.lab.find(r=>r.id===pair.inletId),outlet=data.lab.find(r=>r.id===pair.outletId);
  return !!inlet&&!!outlet&&current(inlet)&&current(outlet)&&(!hasLabComparison(draft)||!!reportDate(inlet.date)&&!!reportDate(outlet.date)&&!!inlet.pointId&&!!outlet.pointId);
 });
 return scoped;
}
