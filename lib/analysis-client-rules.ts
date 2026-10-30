import type {
  AnalysisClientRule,
  AnalysisClientQualifiers,
  AnalysisPeriodicity,
  AnalysisType,
} from "./analysis-schedule-types.ts";
import { buildAnalysisClientRuleId } from "./analysis-client-matching.ts";
import { normalizeText } from "./reconciliation.ts";

type RuleSeed = [title: string, pageId: string, aliases?: string[]];

const SEEDS: RuleSeed[] = [
  ["DEMO31 - EFLUENTE", "demo31-efluente", ["DEMO31"]],
  ["ASS RES DEMO09 - EFLUENTE", "1969315793ecca7e74bfa5115fe63d4d", ["Associação Residencial Demo09 Jaguariúna"]],
  ["ASSOCIACAO DOS MORADORES DO RESIDENCIAL JARDIM DAS CACHOEIRAS - ÁGUA", "6d70cc3bf3437dc847c5635da8bddf2e"],
  ["ASSOCIACAO DOS MORADORES DO RESIDENCIAL JARDIM DAS CACHOEIRAS - ÁGUA SEMESTRAL", "937e6a15afac793efee056512191893b"],
  ["ASSOCIAÇÃO DOS PROPRIETÁRIOS DE LOTES DO LOTEAMENTO JARDIM RESIDENCIAL DEMO15 - ÁGUA", "6888e038ca6b171f9a923cc8dc6ad289", ["Associação JD Residencial Demo15"]],
  ["ASSOCIAÇÃO DOS PROPRIETÁRIOS DE LOTES DO LOTEAMENTO JARDIM RESIDENCIAL DEMO15 - ÁGUA SEMESTRAL", "10719ecc327892bef6c11d83a69813cf", ["Associação JD Residencial Demo15"]],
  ["ASSOCIAÇÃO DOS PROPRIETÁRIOS DE LOTES DO LOTEAMENTO JARDIM RESIDENCIAL DEMO15 - EFLUENTE", "c6578502bd41e0f70cdc104a722eed69", ["Associação JD Residencial Demo15"]],
  ["ASSOCIAÇÃO DOS PROPRIETÁRIOS DO LOTEAMENTO RESIDENCIAL DEMO16 ECO PARK - ÁGUA", "84b64f90280a0178baa7e35172a6375b"],
  ["ASSOCIAÇÃO DOS PROPRIETÁRIOS DO LOTEAMENTO RESIDENCIAL DEMO16 ECO PARK - ÁGUA MENSAL", "46a0b63aedb1d45f5094f50b570f2685"],
  ["ASSOCIAÇÃO DOS PROPRIETÁRIOS DO LOTEAMENTO RESIDENCIAL DEMO16 ECO PARK - ÁGUA SEMESTRAL", "cc401f2e7d8f56f5a92548f277de9aea"],
  ["ASSOCIAÇÃO DOS PROPRIETÁRIOS DO LOTEAMENTO RESIDENCIAL DEMO16 ECO PARK - EFLUENTE", "438421cec17cc9a48574fb9521c4148f"],
  ["CASA UNIDADE FICTICIA - ÁGUA", "640f01c660d2e4bfd413874568100cb1"],
  ["DEMO23 IND. E COM. DE PISOS LTDA. - POLIDORA", "961abe7856e4d33391eb8fdb006b29b0", ["Demo23 Indústria e Comércio de Pisos"]],
  ["DEMO23 IND. E COM. DE PISOS LTDA. - ÁGUA", "7a573e78844c661ddc64834f92259871", ["Demo23 Indústria e Comércio de Pisos"]],
  ["CERAMICA ATLAS LTDA - ÁGUA", "a08bc3428574a0cb931461231e2e60c3"],
  ["CERAMICA DEMO24 LTDA - ÁGUA", "dc738fa50c725ad0bfcb026419d82a8a"],
  ["CERAMICA DEMO24 LTDA - POLIDORA", "c1998288a5d59d0abb381520a54819de"],
  ["CERAMICA DEMO05 LTDA - ÁGUA", "247826d0f1499b2781ee6c59517fa438"],
  ["FAZENDA FICTICIA LTDA - ÁGUA", "e5a8d65336c668bda10b03398e3b29d3"],
  ["FW DEMO19 DEMO19 - ÁGUA", "14f395e70cfab57fdabf89da601fb6c1", ["FW Demo19"]],
  ["DEMO20 SAO PAULO INDUSTRIA E COMERCIO DE INGREDIENTES - ÁGUA", "855f38b4ed80ea9c3694b2f7607f5bcf", ["Demo20 São Paulo"]],
  ["DEMO20 SAO PAULO INDUSTRIA E COMERCIO DE INGREDIENTES - ÁGUA SEMESTRAL", "eeb7050a2d48e1c728440cfac081750d", ["Demo20 São Paulo"]],
  ["DEMO20 SAO PAULO INDUSTRIA E COMERCIO DE INGREDIENTES - EXTRA", "e498d317eca279f588f38f35b046c674", ["Demo20 São Paulo"]],
  ["DEMO14 IPE AVICULTURA LTDA - ÁGUA", "d285653abd4d75cae30ad0c7e4a8141b", ["Demo14 Demo32 Demo14 Ipê"]],
  ["HOSPITAL - EFLUENTE", "9bcb57f97d94347486444bcd8caf9d64"],
  ["DEMO13 LUBRIFICANTES S.A. - EFLUENTE BIOLOGICO", "acbf581e8d2676e086b67ed390e34736", ["Demo13 Lubrificantes Biológico"]],
  ["DEMO13 LUBRIFICANTES S.A. - EFLUENTE ETDI", "4821583765317cf80cd1284ad1339157", ["Demo13 Lubrificantes ETDI"]],
  ["DEMO25 INDÚSTRIA E COMÉRCIO DE PISOS LTDA - FILIAL. - ÁGUA", "34d1d85b6f170302b7795436843c33da", ["Demo25 Indústria e Comércio de Pisos"]],
  ["DEMO25 INDÚSTRIA E COMÉRCIO DE PISOS LTDA - FILIAL. - POLIDORA", "bfc08fc7ac1d988921e10afec7d7e946", ["Demo25 Indústria e Comércio de Pisos"]],
  ["INDÚSTRIA CERÂMICA DEMO26 LTDA - ÁGUA", "8ed4a11a52bdd6e8f94ee076133abc82"],
  ["INDÚSTRIA CERÂMICA DEMO26 LTDA - POLIDORA", "91689d26639952509463592860ae1474"],
  ["DEMO21 INDUSTRIA E COMERCIO DE EMBALAGENS LTDA. - ÁGUA", "e4e60a532d4b1738634e9d423d3e35e0"],
  ["Pessoa Ficticia DEMO05 - ÁGUA", "1436daa83cdec8dc4120dca699abd730"],
  ["LATICINIO DEMO02 GRUPO FICTICIO INDUSTRIA E COMERCIO LTDA - EFLUENTE", "11ed3fee078379184f3d753ac2aed9b7"],
  ["DEMO03 INDUSTRIA E COMÉRCIO LTDA - EFLUENTE", "14e1c43d2f6103de97cd4b3e027c6113"],
  ["LIMER STAMP - EFLUENTE", "bfcff476815cc43906831d7d6f107352"],
  ["Lindoia - Efluente", "d6e25d4a7bb0b41b8404d2e00593d4ad"],
  ["MASSIMO DEMO07 BEVERAGE BRASIL - ÁGUA", "ae83f5b4b16852e28a5dc5c43792b8cc"],
  ["MASSIMO DEMO07 BEVERAGE BRASIL - ÁGUA SEMESTRAL", "8a24774442d864eb695f41831eb6d8bd"],
  ["MINERADORA AGUA FICTICIA LTDA - ÁGUA", "cb0fa9d566d7be450ff485f4c81b06d1"],
  ["DEMO27 INDÚSTRIA E COMÉRCIO DE PORCELANATO LTDA - ÁGUA", "e1e7a418d729960bd2debd22a4866ee1"],
  ["DEMO27 INDÚSTRIA E COMÉRCIO DE PORCELANATO LTDA - POLIDORA", "f5243b02124e6f6782798ef55c73a3d7"],
  ["DEMO11 EMPREENDIMENTOS LTDA - ÁGUA", "81c142366463deb5afbde2e3a344c8da"],
  ["PORTO SECO ARMAZENAGEM LTDA - ÁGUA", "d15432f043891ea58b025920664e72cc"],
  ["DEMO22 - ÁGUA", "cd3ff9ac7f3c25e17b217e17abe5d523"],
  ["DEMO22 - ÁGUA", "e3cac7733f66c3e5967774d80696b7fa"],
  ["DEMO22 - EFLUENTE", "88a596007bf174b1a7ae7636037bc8d2"],
  ["DEMO22 - EFLUENTE", "bb0df8fcd1c64956adf055723694fd37"],
  ["RG Log", "6675da494000aaf11fe56ab1fd005f32"],
  ["DEMO29 - ÁGUA", "fa720d4af308895bee50ea8ff7aa7f86", ["Ruy R da Demo29 Produtos Cerâmicos"]],
  ["DEMO28 DO BRASIL PARTICIPACOES LTDA. - ÁGUA", "c8e63b67cd902a838b966cd57865047e", ["Demo28 do Brasil Participações LTDA - Ouro Fino", "Demo28 do Brasil Participações LTDA"]],
  ["DEMO28 DO BRASIL PARTICIPACOES LTDA. - ÁGUA SEMESTRAL", "3600586e32bbf342ba65e82e2cb37d7e", ["Demo28 do Brasil Participações LTDA - Ouro Fino", "Demo28 do Brasil Participações LTDA"]],
];

const duplicateIds = new Map<string, number>();

export const DEFAULT_ANALYSIS_CLIENT_RULES: AnalysisClientRule[] = SEEDS.map(
  ([title, pageId, aliases = []]) => {
    const baseId = buildAnalysisClientRuleId(title);
    const occurrence = (duplicateIds.get(baseId) ?? 0) + 1;
    duplicateIds.set(baseId, occurrence);
    return {
    id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
    title,
    notionUrl: `https://example.com/demo/${pageId}`,
    aliases,
    companyKeys: [title],
    analysisType: analysisTypeFromTitle(title),
    periodicity: periodicityFromTitle(title),
    qualifiers: qualifiersFromTitle(title),
    active: true,
  };
  },
);

export const ANALYSIS_CLIENT_RULES = DEFAULT_ANALYSIS_CLIENT_RULES;

export function mergeAnalysisClientRules(
  defaults: AnalysisClientRule[],
  remote: AnalysisClientRule[],
): AnalysisClientRule[] {
  if (!remote.length) return defaults;
  const merged = new Map(defaults.map((rule) => [ruleIdentity(rule), rule]));
  for (const rule of remote) merged.set(ruleIdentity(rule), rule);
  return [...merged.values()].sort((left, right) =>
    left.title.localeCompare(right.title, "pt-BR")
    || left.periodicity.localeCompare(right.periodicity, "pt-BR"),
  );
}

function ruleIdentity(rule: AnalysisClientRule): string {
  return `${normalizeText(rule.title)}:${rule.analysisType}:${rule.periodicity}`;
}

function analysisTypeFromTitle(title: string): AnalysisType {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("polidora")) return "Polidora";
  if (normalized.includes("extra")) return "Extra";
  if (normalized.includes("efluente")) return "Efluente";
  return "Água";
}

function periodicityFromTitle(title: string): AnalysisPeriodicity {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("semestral")) return "Semestral";
  if (normalized.includes("sem periodicidade")) return "Sem periodicidade";
  return "Mensal";
}

function qualifiersFromTitle(title: string): AnalysisClientQualifiers {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("demo13") && normalized.includes("etdi")) {
    return { identificationIncludes: ["ETDI"] };
  }
  if (normalized.includes("demo13") && normalized.includes("biologico")) {
    return { identificationIncludes: ["Biológico"], identificationExcludes: ["ETDI"] };
  }
  return {};
}
