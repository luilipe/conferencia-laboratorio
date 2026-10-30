import type { ReportClientId, ReportPreset, ReportClientSettings, ClientReportDraft, FixedModelText } from "./types.ts";
import { emptyReportBatch } from "./values.ts";
import {getReportTemplate} from './templates.ts';
import {defaultLabComparison} from './lab-history.ts';

const base = { version: "1", enabled: false, requiredSections: ["presentation", "laboratory", "observations", "conclusion", "sources"], optionalSections: ["history", "operations", "meters", "supplies", "journal"], requiredSources: ["laboratory"] };
const points = (entries: [string, string][]) => entries.map(([id, label]) => ({ id, label }));
const inletOutlet = points([["bruto", "Bruto"], ["tratado", "Tratado"]]);
export const REPORT_PRESETS: ReportPreset[] = [
  { ...base, clientId: "demo13", stationId: "etdi", label: "DEMO13 — ETDI", points: inletOutlet, parameters: ["DBO", "DQO"] },
  { ...base, clientId: "demo13", stationId: "biologico", label: "DEMO13 — Biológico", points: inletOutlet, parameters: ["DBO", "DQO"] },
  { ...base, clientId: "demo24", stationId: "combined", label: "Demo24 — Esmaltação e Polidora", points: points([["esmaltacao", "Esmaltação"], ["polidora", "Polidora"]]), parameters: ["pH"], requiredSections: ["presentation", "operations", "supplies", "observations", "conclusion", "sources"], requiredSources: ["operations"] },
  { ...base, clientId: "demo08", stationId: "ete", label: "2N — Hospital", points: points([["elevatoria-3", "Elevatória 3"], ["decantador-1", "Decantador 01"], ["decantador-2", "Decantador 02"], ["equalizado", "Equalizado"], ["anaerobio", "Tanque Anaeróbio"], ["tratado", "Saída Tratado"]]), parameters: ["pH", "SS30", "SS60", "Cloro", "Condutividade"], requiredSections: ["presentation", "laboratory", "operations", "observations", "conclusion", "sources"] },
  { ...base, clientId: "demo09", stationId: "ete", label: "Demo09 — Efluente", points: points([["elevatoria", "Elevatória"], ["reator-1", "Reator 1"], ["reator-2", "Reator 2"], ["decantador", "Decantador"], ["lancamento", "Lançamento"], ["bruto", "Bruto"], ["tratado", "Tratado"]]), parameters: ["DBO", "DQO"], requiredSections: ["presentation", "laboratory", "operations", "efficiency", "observations", "conclusion", "sources"] },
  { ...base, clientId: "demo14", stationId: "eta", label: "Demo14 Ipê — ETA", points: points([["bruto", "Bruto"], ["tratado", "Tratado"]]), parameters: ["Cor", "Fluoreto", "Turbidez", "Cloro", "pH"], requiredSections: ["presentation", "laboratory", "meters", "observations", "conclusion", "sources"] },
  { ...base, clientId: "demo02", stationId: "ete", label: "Demo02 Grupo ficticio — ETE", points: points([["bruto", "Bruto"], ["reator-1", "Reator 1"], ["reator-2", "Reator 2"], ["tratado", "Tratado"]]), parameters: ["DBO", "DQO"], requiredSections: ["presentation", "laboratory", "operations", "supplies", "observations", "conclusion", "sources"] },
  { ...base, clientId: "demo01", stationId: "ete", label: "Demo01 Química — ETE", points: points([["equalizado", "Equalizado"], ["biologico", "Biológico"], ["sedipack", "Sedipack"], ["decantador", "Decantador"], ["tratado", "Tratado"]]), parameters: ["DBO", "DQO"], requiredSections: ["presentation", "laboratory", "operations", "meters", "supplies", "journal", "observations", "conclusion", "sources"] },
];
export function getReportPreset(clientId: ReportClientId, stationId: string, version = "2"): ReportPreset {
  if(version==='2')return getReportTemplate(clientId,stationId);
  const preset = REPORT_PRESETS.find(p => p.clientId === clientId && p.stationId === stationId && p.version === version);
  if (!preset) throw new Error("Modelo ou versão de relatório indisponível.");
  return structuredClone(preset);
}
export function resolveReportPreset(settings: ReportClientSettings | null, clientId: ReportClientId, stationId: string, version = "2", rendererVersion?:string, fixedText?:FixedModelText): ReportPreset {
  const preset = getReportPreset(clientId, stationId, version);
  preset.enabled = settings?.clientId === clientId && settings.enabledPresetVersions.includes(`${stationId}@${version}`);
  if(rendererVersion==='3')preset.enabled=preset.enabled&&!!settings?.references.some(r=>r.id===`renderer-approval:${stationId}:3`&&r.version==='3'&&r.approvedByUid&&r.source===settings.references.find(f=>f.id===`fixed-model:${stationId}`)?.version);
  if(rendererVersion==='3'&&fixedText)preset.enabled=preset.enabled&&settings?.references.find(r=>r.id===`fixed-model:${stationId}`)?.application===JSON.stringify(fixedText);
  if(rendererVersion==='4')preset.enabled=preset.enabled&&!!settings?.enabledRendererVersions?.[stationId]?.includes('4')&&!!settings.technicalApproverUid&&!!settings.editorialModels?.[stationId]?.approvedByUid;
  return preset;
}
export function createReportDraft(clientId: ReportClientId, stationId: string, period: string): ClientReportDraft {
  const preset = getReportPreset(clientId, stationId);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Informe a competência.");
  return { id: crypto.randomUUID(), clientId, stationId, period, presetVersion: preset.version, revision: 0, identity: { clientDisplayName: preset.label.split(" — ")[0], facilityName: "", requesterName: "", taxId: "", address: "", responsibleName: "", responsibleRegistration: "", issueDate: "" }, data: emptyReportBatch(), selection: { labComparison: defaultLabComparison(clientId), selectedLabIds: [], excludedRecordIds: [], efficiencyPairs: [], meterBaselines: {} }, narratives: { presentation: "", observations: "", conclusion: "" }, references: [], acknowledgements: {}, corrections: [] };
}
export function preferredReportRenderer(settings:ReportClientSettings|null,clientId:ReportClientId,stationId:string):'3'|'4'{return resolveReportPreset(settings,clientId,stationId,'2','4').enabled?'4':'3';}
