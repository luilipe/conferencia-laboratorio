import { normalizeText } from "./reconciliation.ts";
import type {
  ComplianceFrequency,
  CompliancePointType,
  LegalRule,
} from "./compliance-types";

export const COMPLIANCE_RULE_SET_VERSION = "br-prc5-anexo-xx-888-2472-v1";
export const PORTARIA_URL =
  "https://bvsms.saude.gov.br/bvs/saudelegis/gm/2021/prt0888_24_05_2021_rep.html";

const TREATED_POINTS: CompliancePointType[] = ["treatment", "consumption"];

type RuleOptions = {
  aliases?: string[];
  category?: LegalRule["category"];
  appliesTo?: CompliancePointType[];
  frequency?: ComplianceFrequency;
  reference?: string;
  note?: string;
};

function maxRule(
  parameterKey: string,
  parameterName: string,
  maximum: number,
  unit: string,
  options: RuleOptions = {},
): LegalRule {
  return {
    id: `${COMPLIANCE_RULE_SET_VERSION}:${parameterKey}`,
    parameterKey,
    parameterName,
    aliases: options.aliases ?? [parameterName],
    category: options.category ?? "inorganic",
    operator: "max",
    minimum: null,
    maximum,
    unit,
    appliesTo: options.appliesTo ?? TREATED_POINTS,
    frequency: options.frequency ?? "semiannual",
    legalReference: options.reference ?? "Anexo 9 do Anexo XX da PRC GM/MS nº 5/2017",
    legalSourceUrl: PORTARIA_URL,
    note: options.note ?? "Valor máximo permitido pela norma de potabilidade.",
  };
}

function informationalRule(
  parameterKey: string,
  parameterName: string,
  aliases: string[],
  frequency: ComplianceFrequency,
): LegalRule {
  return {
    id: `${COMPLIANCE_RULE_SET_VERSION}:${parameterKey}`,
    parameterKey,
    parameterName,
    aliases,
    category: "operational",
    operator: "informational",
    minimum: null,
    maximum: null,
    unit: "",
    appliesTo: ["source", "treatment", "consumption"],
    frequency,
    legalReference: "Anexo 15 do Anexo XX da PRC GM/MS nº 5/2017",
    legalSourceUrl: PORTARIA_URL,
    note: "Parâmetro de monitoramento sem VMP numérico geral aplicável neste contexto.",
  };
}

const BASIC_RULES: LegalRule[] = [
  informationalRule("ph", "pH", ["pH", "Potencial hidrogeniônico"], "monthly"),
  {
    ...maxRule("turbidity", "Turbidez", 5, "uT", {
      aliases: ["Turbidez"],
      category: "organoleptic",
      frequency: "monthly",
      reference: "Anexos 2, 11 e 15 do Anexo XX da PRC GM/MS nº 5/2017",
      note: "VMP geral de 5 uT. Limites de processo mais restritivos dependem do tratamento e do ponto.",
    }),
  },
  maxRule("apparent_color", "Cor aparente", 15, "uH", {
    aliases: ["Cor Aparente", "Cor"],
    category: "organoleptic",
    frequency: "monthly",
    reference: "Anexos 11 e 15 do Anexo XX da PRC GM/MS nº 5/2017",
  }),
  {
    id: `${COMPLIANCE_RULE_SET_VERSION}:free_residual_chlorine`,
    parameterKey: "free_residual_chlorine",
    parameterName: "Cloro residual livre",
    aliases: ["Cloro Residual Livre", "Residual de cloro livre"],
    category: "operational",
    operator: "range",
    minimum: 0.2,
    maximum: 5,
    unit: "mg/L",
    appliesTo: TREATED_POINTS,
    frequency: "daily",
    legalReference: "Arts. 32 e 39 e Anexos 9 e 15 do Anexo XX da PRC GM/MS nº 5/2017",
    legalSourceUrl: PORTARIA_URL,
    note: "Deve permanecer entre 0,2 e 5,0 mg/L nos pontos de água tratada aplicáveis.",
  },
  {
    id: `${COMPLIANCE_RULE_SET_VERSION}:e_coli`,
    parameterKey: "e_coli",
    parameterName: "Escherichia coli",
    aliases: ["Determinação Escherichia coli", "Escherichia coli", "E. coli", "E.Coli"],
    category: "microbiological",
    operator: "absence",
    minimum: null,
    maximum: null,
    unit: "100 mL",
    appliesTo: ["source", "consumption"],
    frequency: "monthly",
    legalReference: "Arts. 27 e 31, Anexos 1 e 15 do Anexo XX da PRC GM/MS nº 5/2017",
    legalSourceUrl: PORTARIA_URL,
    note: "Ausência em 100 mL. No manancial subterrâneo, o resultado também orienta as exigências de tratamento.",
  },
  {
    id: `${COMPLIANCE_RULE_SET_VERSION}:total_coliforms`,
    parameterKey: "total_coliforms",
    parameterName: "Coliformes totais",
    aliases: ["Determinação de Coliformes Totais", "Coliformes Totais", "Coliformes totais"],
    category: "microbiological",
    operator: "absence",
    minimum: null,
    maximum: null,
    unit: "100 mL",
    appliesTo: ["treatment", "consumption"],
    frequency: "monthly",
    legalReference: "Anexos 1 e 15 do Anexo XX da PRC GM/MS nº 5/2017",
    legalSourceUrl: PORTARIA_URL,
    note: "Na saída do tratamento exige-se ausência. No ponto de consumo, a conclusão mensal depende do conjunto de amostras e da população atendida.",
  },
  informationalRule(
    "heterotrophic_bacteria",
    "Bactérias heterotróficas",
    ["Bactérias Heterotróficas", "Contagem de bactérias heterotróficas"],
    "semiannual",
  ),
];

const INORGANIC_RULES: LegalRule[] = [
  ["antimony", "Antimônio", 0.006],
  ["arsenic", "Arsênio", 0.01],
  ["barium", "Bário", 0.7],
  ["cadmium", "Cádmio", 0.003],
  ["lead", "Chumbo", 0.01],
  ["copper", "Cobre", 2],
  ["chromium", "Cromo", 0.05],
  ["fluoride", "Fluoreto", 1.5],
  ["total_mercury", "Mercúrio total", 0.001],
  ["nickel", "Níquel", 0.07],
  ["nitrate", "Nitrato (como N)", 10],
  ["nitrite", "Nitrito (como N)", 1],
  ["selenium", "Selênio", 0.04],
  ["uranium", "Urânio", 0.03],
].map(([key, name, limit]) =>
  maxRule(String(key), String(name), Number(limit), "mg/L", {
    aliases: [String(name), String(name).replace(" (como N)", "")],
  }),
);

const ORGANIC_RULES: LegalRule[] = [
  ["dichloroethane_12", "1,2 Dicloroetano", 5],
  ["acrylamide", "Acrilamida", 0.5],
  ["benzene", "Benzeno", 5],
  ["benzo_a_pyrene", "Benzo[a]pireno", 0.4],
  ["vinyl_chloride", "Cloreto de vinila", 0.5],
  ["dehp", "Di(2-etilhexil) ftalato", 8],
  ["dichloromethane", "Diclorometano", 20],
  ["dioxane", "Dioxano", 48],
  ["epichlorohydrin", "Epicloridrina", 0.4],
  ["ethylbenzene", "Etilbenzeno", 300],
  ["pentachlorophenol", "Pentaclorofenol", 9],
  ["carbon_tetrachloride", "Tetracloreto de carbono", 4],
  ["tetrachloroethene", "Tetracloroeteno", 40],
  ["toluene", "Tolueno", 30],
  ["trichloroethene", "Tricloroeteno", 4],
  ["xylenes", "Xilenos", 500],
].map(([key, name, limit]) =>
  maxRule(String(key), String(name), Number(limit), "µg/L", { category: "organic" }),
);

const PESTICIDE_RULES: LegalRule[] = [
  ["pesticide_24d", "2,4 D", 30],
  ["alachlor", "Alacloro", 20],
  ["aldicarb_total", "Aldicarbe + Aldicarbesulfona + Aldicarbesulfóxido", 10],
  ["aldrin_dieldrin", "Aldrin + Dieldrin", 0.03],
  ["ametryn", "Ametrina", 60],
  ["atrazine_total", "Atrazina + S-Clorotriazinas", 2],
  ["carbendazim", "Carbendazim", 120],
  ["carbofuran", "Carbofurano", 7],
  ["cyproconazole", "Ciproconazol", 30],
  ["chlordane", "Clordano", 0.2],
  ["chlorothalonil", "Clorotalonil", 45],
  ["chlorpyrifos_total", "Clorpirifós + Clorpirifós-Oxon", 30],
  ["ddt_total", "DDT + DDD + DDE", 1],
  ["difenoconazole", "Difenoconazol", 30],
  ["dimethoate_total", "Dimetoato + Ometoato", 1.2],
  ["diuron", "Diuron", 20],
  ["epoxiconazole", "Epoxiconazol", 60],
  ["fipronil", "Fipronil", 1.2],
  ["flutriafol", "Flutriafol", 30],
  ["glyphosate_ampa", "Glifosato + AMPA", 500],
  ["hydroxy_atrazine", "Hidroxi-Atrazina", 120],
  ["lindane", "Lindano (gama HCH)", 2],
  ["malathion", "Malationa", 60],
  ["mancozeb_etu", "Mancozebe + ETU", 8],
  ["methamidophos_acephate", "Metamidofós + Acefato", 7],
  ["metolachlor", "Metolacloro", 10],
  ["metribuzin", "Metribuzim", 25],
  ["molinate", "Molinato", 6],
  ["paraquat", "Paraquate", 13],
  ["picloram", "Picloram", 60],
  ["profenofos", "Profenofós", 0.3],
  ["propargite", "Propargito", 30],
  ["prothioconazole_total", "Protioconazol + Protioconazol-Destio", 3],
  ["simazine", "Simazina", 2],
  ["tebuconazole", "Tebuconazol", 180],
  ["terbufos", "Terbufós", 1.2],
  ["thiamethoxam", "Tiametoxam", 36],
  ["thiodicarb", "Tiodicarbe", 90],
  ["thiram", "Tiram", 6],
  ["trifluralin", "Trifluralina", 20],
].map(([key, name, limit]) =>
  maxRule(String(key), String(name), Number(limit), "µg/L", { category: "pesticide" }),
);

const DISINFECTION_RULES: LegalRule[] = [
  ["trichlorophenol_246", "2,4,6 Triclorofenol", 0.2],
  ["dichlorophenol_24", "2,4-Diclorofenol", 0.2],
  ["haloacetic_acids_total", "Ácidos haloacéticos total", 0.08],
  ["bromate", "Bromato", 0.01],
  ["chloramines_total", "Cloraminas total", 4],
  ["chlorate", "Clorato", 0.7],
  ["chlorite", "Clorito", 0.7],
  ["ndma", "N-Nitrosodimetilamina", 0.0001],
  ["trihalomethanes_total", "Trihalometanos total", 0.1],
].map(([key, name, limit]) =>
  maxRule(String(key), String(name), Number(limit), "mg/L", {
    category: "disinfection_byproduct",
    note: "Análise condicionada ao desinfetante ou oxidante utilizado.",
  }),
);

const CYANOTOXIN_RULES: LegalRule[] = [
  ["cylindrospermopsins", "Cilindrospermopsinas", 1],
  ["microcystins", "Microcistinas", 1],
  ["saxitoxins", "Saxitoxinas", 3],
].map(([key, name, limit]) =>
  maxRule(String(key), String(name), Number(limit), "µg/L", {
    category: "cyanotoxin",
    frequency: "conditional",
    reference: "Anexo 10 do Anexo XX da PRC GM/MS nº 5/2017",
  }),
);

const RADIOACTIVITY_RULES: LegalRule[] = [
  maxRule("gross_alpha", "Atividade alfa total", 0.5, "Bq/L", {
    aliases: ["Atividade alfa total", "Alfa total"],
    category: "radioactivity",
    reference: "Art. 37 do Anexo XX da PRC GM/MS nº 5/2017",
    note: "Nível de triagem; superação exige confirmação e avaliação conforme a CNEN.",
  }),
  maxRule("gross_beta", "Atividade beta total", 1, "Bq/L", {
    aliases: ["Atividade beta total", "Beta total"],
    category: "radioactivity",
    reference: "Art. 37 do Anexo XX da PRC GM/MS nº 5/2017",
    note: "Nível de triagem; deve ser considerada a contribuição do K-40.",
  }),
];

const ORGANOLEPTIC_RULES: LegalRule[] = [
  ["aluminum", "Alumínio", 0.2, "mg/L"],
  ["ammonia_n", "Amônia (como N)", 1.2, "mg/L"],
  ["chloride", "Cloreto", 250, "mg/L"],
  ["dichlorobenzene_12", "1,2 Diclorobenzeno", 0.001, "mg/L"],
  ["dichlorobenzene_14", "1,4 Diclorobenzeno", 0.0003, "mg/L"],
  ["total_hardness", "Dureza total", 300, "mg/L"],
  ["iron", "Ferro", 0.3, "mg/L"],
  ["manganese", "Manganês", 0.1, "mg/L"],
  ["monochlorobenzene", "Monoclorobenzeno", 0.02, "mg/L"],
  ["sodium", "Sódio", 200, "mg/L"],
  ["total_dissolved_solids", "Sólidos dissolvidos totais", 500, "mg/L"],
  ["sulfate", "Sulfato", 250, "mg/L"],
  ["hydrogen_sulfide", "Sulfeto de hidrogênio", 0.05, "mg/L"],
  ["zinc", "Zinco", 5, "mg/L"],
].map(([key, name, limit, unit]) =>
  maxRule(String(key), String(name), Number(limit), String(unit), {
    category: "organoleptic",
    reference: "Anexo 11 do Anexo XX da PRC GM/MS nº 5/2017",
    note:
      String(key) === "iron" || String(key) === "manganese"
        ? "VMP organoléptico; a exceção por complexação depende de comprovação técnica específica."
        : "Valor máximo do padrão organoléptico de potabilidade.",
  }),
);

export const LEGAL_RULES: LegalRule[] = [
  ...BASIC_RULES,
  ...INORGANIC_RULES,
  ...ORGANIC_RULES,
  ...PESTICIDE_RULES,
  ...DISINFECTION_RULES,
  ...CYANOTOXIN_RULES,
  ...RADIOACTIVITY_RULES,
  ...ORGANOLEPTIC_RULES,
];

const RULES_BY_KEY = new Map(LEGAL_RULES.map((rule) => [rule.parameterKey, rule]));

export function ruleByKey(parameterKey: string): LegalRule | null {
  return RULES_BY_KEY.get(parameterKey) ?? null;
}

export const PARAMETER_ALIASES = LEGAL_RULES.flatMap((rule) =>
  rule.aliases.map((alias) => ({
    parameterKey: rule.parameterKey,
    parameterName: rule.parameterName,
    alias,
    normalizedAlias: normalizeText(alias),
    qualitative: rule.operator === "absence",
  })),
).sort((left, right) => right.normalizedAlias.length - left.normalizedAlias.length);
