import type {
  AnalysisClientResolution,
  AnalysisClientRule,
  AnalysisPeriodicity,
  AnalysisType,
} from "./analysis-schedule-types.ts";
import { normalizeText } from "./reconciliation.ts";
import type { CollectionSample } from "./types.ts";

const CANONICAL_IGNORED_TOKENS = new Set([
  "a", "da", "das", "de", "do", "dos", "e", "em",
  "ltda", "sa", "s", "ouro", "fino", "tecnologias", "ambientais",
  "agua", "efluente", "polidora", "extra", "mensal", "semestral",
  "sem", "periodicidade", "etdi", "biologico",
]);

const GENERIC_MATCH_TOKENS = new Set([
  "brasil", "participacoes", "participacao", "industria", "industrial",
  "comercio", "empresa", "filial", "grupo", "associacao", "residencial",
]);

export function canonicalCompanyName(value: string): string {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !CANONICAL_IGNORED_TOKENS.has(token))
    .join(" ");
}

export function buildAnalysisClientRuleId(title: string): string {
  return normalizeText(title)
    .replace(/\s+/g, "-") || "regra-cliente";
}

export function resolveAnalysisClientRule(
  sample: CollectionSample,
  type: AnalysisType,
  periodicity: AnalysisPeriodicity,
  rules: AnalysisClientRule[],
): AnalysisClientResolution {
  const candidates = rules.filter((rule) =>
    rule.active && rule.analysisType === type && rule.periodicity === periodicity,
  );
  const sourceCanonical = canonicalCompanyName(sample.company);

  const canonicalMatches = candidates.filter((rule) =>
    ruleCompanyKeys(rule).some((value) => canonicalCompanyName(value) === sourceCanonical),
  );
  if (canonicalMatches.length) {
    return resolveExactCandidates(canonicalMatches, sample, "canonical-company");
  }

  const normalizedCompany = normalizeText(sample.company);
  const aliasMatches = candidates.filter((rule) =>
    rule.aliases.some((alias) => normalizeText(alias) === normalizedCompany),
  );
  if (aliasMatches.length) {
    return resolveExactCandidates(aliasMatches, sample, "exact-alias");
  }

  const suggestions = candidates
    .map((rule) => ({ rule, confidence: suggestionScore(sourceCanonical, rule) }))
    .filter((entry) => entry.confidence >= 0.5)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);

  if (suggestions.length) {
    return {
      status: "suggested",
      method: "fuzzy-suggestion",
      rule: null,
      confidence: suggestions[0].confidence,
      candidates: suggestions.map((entry) => ({
        ruleId: entry.rule.id,
        title: entry.rule.title,
        confidence: entry.confidence,
      })),
      warnings: ["Há uma sugestão de cliente, mas ela precisa ser confirmada no catálogo."],
    };
  }

  return {
    status: "unmatched",
    method: "none",
    rule: null,
    confidence: 0,
    candidates: [],
    warnings: ["Cliente sem correspondência confirmada no catálogo do Notion."],
  };
}

function resolveExactCandidates(
  candidates: AnalysisClientRule[],
  sample: CollectionSample,
  method: "canonical-company" | "exact-alias",
): AnalysisClientResolution {
  const qualified = candidates.filter((rule) => qualifiersMatch(rule, sample));
  const rulesWithQualifiers = candidates.filter((rule) => hasQualifiers(rule));

  if (qualified.length === 1 && (candidates.length === 1 || rulesWithQualifiers.length > 0)) {
    return matchedResolution(
      qualified[0],
      candidates.length > 1 || hasQualifiers(qualified[0]) ? "qualified-rule" : method,
    );
  }

  if (candidates.length === 1 && !hasQualifiers(candidates[0])) {
    return matchedResolution(candidates[0], method);
  }

  const ambiguous = qualified.length > 1 ? qualified : candidates;
  return {
    status: "ambiguous",
    method: "none",
    rule: null,
    confidence: 0,
    candidates: ambiguous.map((rule) => ({ ruleId: rule.id, title: rule.title, confidence: 1 })),
    warnings: ["Mais de uma regra pode corresponder a este cliente; revise o catálogo."],
  };
}

function matchedResolution(
  rule: AnalysisClientRule,
  method: "canonical-company" | "exact-alias" | "qualified-rule",
): AnalysisClientResolution {
  return {
    status: "matched",
    method,
    rule,
    confidence: 1,
    candidates: [{ ruleId: rule.id, title: rule.title, confidence: 1 }],
    warnings: [],
  };
}

function ruleCompanyKeys(rule: AnalysisClientRule): string[] {
  return [...rule.companyKeys, ...rule.aliases, rule.title].filter(Boolean);
}

function hasQualifiers(rule: AnalysisClientRule): boolean {
  return Boolean(
    rule.qualifiers.identificationIncludes?.length
      || rule.qualifiers.identificationExcludes?.length
      || rule.qualifiers.sampleTypeIncludes?.length,
  );
}

function qualifiersMatch(rule: AnalysisClientRule, sample: CollectionSample): boolean {
  if (!hasQualifiers(rule)) return true;
  const identification = normalizeText(`${sample.identification} ${sample.analyses.join(" ")}`);
  const sampleType = normalizeText(sample.sampleType);
  const includes = rule.qualifiers.identificationIncludes?.map(normalizeText) ?? [];
  const excludes = rule.qualifiers.identificationExcludes?.map(normalizeText) ?? [];
  const typeIncludes = rule.qualifiers.sampleTypeIncludes?.map(normalizeText) ?? [];
  return includes.every((value) => identification.includes(value))
    && excludes.every((value) => !identification.includes(value))
    && typeIncludes.every((value) => sampleType.includes(value));
}

function suggestionScore(sourceCanonical: string, rule: AnalysisClientRule): number {
  const sourceTokens = distinctiveTokens(sourceCanonical);
  if (!sourceTokens.size) return 0;
  let best = 0;
  for (const value of ruleCompanyKeys(rule)) {
    const candidateTokens = distinctiveTokens(canonicalCompanyName(value));
    if (!candidateTokens.size) continue;
    const common = [...sourceTokens].filter((token) => candidateTokens.has(token)).length;
    if (common < 2) continue;
    const union = new Set([...sourceTokens, ...candidateTokens]).size;
    best = Math.max(best, common / Math.max(union, 1));
  }
  return Number(best.toFixed(4));
}

function distinctiveTokens(value: string): Set<string> {
  return new Set(value.split(" ").filter((token) =>
    token.length > 1 && !GENERIC_MATCH_TOKENS.has(token),
  ));
}
