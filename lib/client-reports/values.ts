import type { ReportValue, ReportIssue, ImportBatch } from "./types.ts";

export function normalizeUnit(unit: string): string {
  const u = unit.trim().replace(/μ/g, "µ").replace(/º/g, "°");
  const aliases: Record<string, string> = { "ug/L": "µg/L", "mg/l": "mg/L", "ml/l": "mL/L", "m3": "m³", "l": "L", "litros": "L", "ph": "", "adimensional": "" };
  return aliases[u] ?? u;
}
export function normalizeParameter(parameter: string): string {
  const p = parameter.trim().replace(/\s+/g, " ");
  if (/^DBO(?:\s*5|\s*₅)?$/i.test(p)) return "DBO";
  if (/^DQO$/i.test(p)) return "DQO";
  if (/^ph$/i.test(p)) return "pH";
  if (/^temperatura$/i.test(p)) return "Temperatura";
  if (/^SS\s*30/i.test(p)) return "SS30";
  if (/^SS\s*60/i.test(p)) return "SS60";
  return p;
}
export function isUnitlessReportParameter(parameter:string):boolean{return /^pH(?:\s|$)/i.test(parameter)||["Larvas","Espuma","Materiais Flutuantes"].includes(parameter);}
export function parseReportValue(raw: unknown, unit = "", options?: { decimalMode: "pt-BR" | "dot"; allowThousands: boolean }): ReportValue {
  const text = raw == null ? "" : String(raw);
  const result: ReportValue = { raw: text, value: null, operator: null, qualitative: null, unit: normalizeUnit(unit), originalUnit: unit, status: "missing" };
  const t = text.trim();
  if (!t || /^[-–—]$/.test(t)) return result;
  if (/^(?:n\/?a|não aplicável)$/i.test(t)) return { ...result, status: "not_applicable" };
  if (/^(?:aus[eê]ncia|ausente|presen[cç]a|presente|a|p|n|s)$/i.test(t)) return { ...result, qualitative: t, status: "measured" };
  if (typeof raw === "number") return Number.isFinite(raw) ? { ...result, value: raw, operator: "=", status: "measured" } : { ...result, status: "invalid" };
  const match = t.replace(/≤/g, "<=").replace(/≥/g, ">=").match(/^(<=|>=|<|>|=)?\s*([+-]?[\d.,]+)$/);
  if (!match) return { ...result, status: "invalid" };
  let numeric = match[2];
  const mode = options?.decimalMode ?? "pt-BR";
  if (mode === "pt-BR") {
    if (numeric.includes(".")) {
      if (!options?.allowThousands || !/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(numeric)) return { ...result, status: "invalid" };
      numeric = numeric.replace(/\./g, "");
    }
    if (!/^[+-]?\d+(?:,\d+)?$/.test(numeric)) return { ...result, status: "invalid" };
    numeric = numeric.replace(",", ".");
  } else {
    if (numeric.includes(",")) {
      if (!options?.allowThousands || !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numeric)) return { ...result, status: "invalid" };
      numeric = numeric.replace(/,/g, "");
    }
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(numeric)) return { ...result, status: "invalid" };
  }
  const value = Number(numeric);
  return Number.isFinite(value) ? { ...result, value, operator: (match[1] || "=") as ReportValue["operator"], status: "measured" } : { ...result, status: "invalid" };
}
export function convertReportValue(value: ReportValue, targetUnit: string): ReportValue {
  const target = normalizeUnit(targetUnit);
  if (target === value.unit) return { ...value };
  const factors: Record<string, number> = { "µg/L:mg/L": .001, "mg/L:µg/L": 1000, "g:kg": .001, "kg:g": 1000, "L:m³": .001, "m³:L": 1000 };
  const factor = factors[`${value.unit}:${target}`];
  if (!factor || value.value === null) return { ...value, status: "invalid" };
  return { ...value, value: value.value * factor, unit: target };
}
export function formatReportNumber(value: number | null, digits = 2): string {
  return value === null ? "—" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
export function formatReportValue(value: ReportValue, precision?: 'source'): string {
  if (value.status !== "measured") return value.raw || "—";
  const number=precision==='source'&&value.value!==null?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:20}).format(value.value):formatReportNumber(value.value);
  const content = value.qualitative ?? `${value.operator && value.operator !== "=" ? value.operator + " " : ""}${number}`;
  return `${content}${value.unit ? " " + value.unit : ""}`;
}
export function reportDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 61 && raw < 2958466) return new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000).toISOString().slice(0, 10);
  if (raw instanceof Date) return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
  const s = String(raw ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:$|[ T])/);
  if (!iso && !br) return null;
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(br![3]), Number(br![2]), Number(br![1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
export function displayReportDate(date: string): string { return date ? date.split("-").reverse().join("/") : "Data pendente"; }
export function reportTime(raw: unknown): string | null {
  if (typeof raw === "number" && raw >= 0 && raw < 1) { const m = Math.round(raw * 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2,"0")}:${String(m % 60).padStart(2,"0")}`; }
  const match = String(raw ?? "").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1].padStart(2,"0")}:${match[2]}` : null;
}
export function reportIssue(code: string, message: string, recordIds: string[] = [], severity: "blocker" | "warning" = "blocker"): ReportIssue {
  return { id: `${code}:${recordIds.join(":") || message}`, code, message, recordIds, severity, acknowledgedByUid: null, acknowledgement: null };
}
export function emptyReportBatch(): ImportBatch { return { sources: [], lab: [], operations: [], meters: [], supplies: [], journal: [], issues: [] }; }
export function exactValue(value: ReportValue): value is ReportValue & { value: number } { return value.status === "measured" && value.operator === "=" && value.value !== null && Number.isFinite(value.value); }
