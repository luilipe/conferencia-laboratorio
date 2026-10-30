import type { ReportClientId, ReportClientSettings, IdentityCatalog, IdentitySeed, FixedModelText } from "./types.ts";
import { REPORT_PRESETS, getReportPreset } from "./presets.ts";
import { parseIdentityCatalog, mergeIdentitySeed, emptyReportIdentity } from "./identity.ts";
import rawCatalog from "./default-catalog.json" with { type: "json" };

export const DEFAULT_CATALOG: IdentityCatalog = parseIdentityCatalog(JSON.stringify(rawCatalog));

export interface ClientInfo {
  id: ReportClientId;
  name: string;
  shortName: string;
  category: "A" | "B" | "C" | "D" | "E" | "F";
  stations: { id: string; label: string; systemType: string }[];
}

export const CLIENT_LIST: ClientInfo[] = [
  // --- Modelo A: ETE Industrial ---
  {
    id: "demo01",
    name: "Demo01 Química Ltda.",
    shortName: "Demo01 Química",
    category: "A",
    stations: [
      { id: "ete", label: "ETE — Estação de Tratamento de Efluentes Industriais", systemType: "ETE Industrial" },
    ],
  },
  {
    id: "demo02",
    name: "Fazenda e Laticínio Demo02 Grupo ficticio",
    shortName: "Demo02 Grupo ficticio",
    category: "A",
    stations: [
      { id: "ete", label: "ETE — Tratamento de Efluentes de Laticínio", systemType: "ETE Industrial / Laticínio" },
    ],
  },
  {
    id: "demo03",
    name: "DEMO03 Indústria e Comércio",
    shortName: "DEMO03",
    category: "A",
    stations: [
      { id: "ete", label: "ETE — Efluente Industrial", systemType: "ETE Industrial" },
    ],
  },
  {
    id: "demo04",
    name: "Limer Stamp Estamparia",
    shortName: "Limer Stamp",
    category: "A",
    stations: [
      { id: "ete", label: "ETE — Despejos Industriais", systemType: "ETE Industrial" },
    ],
  },
  {
    id: "demo05",
    name: "Cerâmica Demo05 Ltda.",
    shortName: "Cerâmica Demo05",
    category: "A",
    stations: [
      { id: "ete", label: "ETE — Efluentes Industriais Cerâmicos", systemType: "ETE Industrial" },
    ],
  },
  {
    id: "demo06",
    name: "Pessoa Ficticia Demo05",
    shortName: "Pessoa Ficticia Demo05",
    category: "A",
    stations: [
      { id: "ete", label: "ETE — Tratamento Industrial", systemType: "ETE Industrial" },
    ],
  },
  {
    id: "demo07",
    name: "Massimo Demo07 Beverage Brasil",
    shortName: "Massimo Demo07",
    category: "A",
    stations: [
      { id: "ete", label: "ETE — Efluentes do Processo Industrial", systemType: "ETE Industrial" },
    ],
  },

  // --- Modelo B: ETE Sanitária / Biológico ---
  {
    id: "demo08",
    name: "Hospital 2N",
    shortName: "Hospital 2N",
    category: "B",
    stations: [
      { id: "ete", label: "ETE — Estação de Tratamento Biológico Sanitário", systemType: "ETE Sanitária / Biológico" },
    ],
  },
  {
    id: "demo09",
    name: "Associação Residencial Demo09",
    shortName: "Demo09",
    category: "B",
    stations: [
      { id: "ete", label: "ETE — Tratamento de Efluentes Sanitários", systemType: "ETE Sanitária" },
    ],
  },
  {
    id: "demo10",
    name: "Porto Seco Centro-Oeste",
    shortName: "Porto Seco",
    category: "B",
    stations: [
      { id: "ete", label: "ETE — ETE Sanitária e Pluvial", systemType: "ETE Sanitária" },
    ],
  },
  {
    id: "demo11",
    name: "Demo11 Transportes",
    shortName: "Demo11",
    category: "B",
    stations: [
      { id: "ete", label: "ETE — Tratamento de Efluente e Caixa Separadora", systemType: "ETE Sanitária / Oleosa" },
    ],
  },
  {
    id: "demo12",
    name: "RG Log Logística",
    shortName: "RG Log",
    category: "B",
    stations: [
      { id: "ete", label: "ETE — Estação Sanitária e Caixa Separadora", systemType: "ETE Sanitária" },
    ],
  },

  // --- Modelo C: ETDI (Despejos Industriais Químicos) & Modelo B ---
  {
    id: "demo13",
    name: "DEMO13 Lubrificantes S.A.",
    shortName: "DEMO13",
    category: "C",
    stations: [
      { id: "etdi", label: "ETDI — Estação de Tratamento de Despejos Industriais", systemType: "ETDI Industrial" },
      { id: "biologico", label: "Biológico — ETE Sanitária", systemType: "ETE Sanitária / Biológico" },
    ],
  },

  // --- Modelo D: Água tratada e subterrânea ---
  {
    id: "demo14",
    name: "Demo14 Ipê",
    shortName: "Demo14 Ipê",
    category: "D",
    stations: [
      { id: "eta", label: "ETA — Monitoramento de Poço e Água Tratada", systemType: "Água Tratada e Subterrânea" },
    ],
  },
  {
    id: "demo15",
    name: "Condomínio Alto de Demo15",
    shortName: "Alto de Demo15",
    category: "D",
    stations: [
      { id: "poco", label: "Poço Tubular Profundo — Água Subterrânea", systemType: "Água Subterrânea / Poço" },
    ],
  },
  {
    id: "demo16",
    name: "Demo16 Eco Park",
    shortName: "Demo16 Eco Park",
    category: "D",
    stations: [
      { id: "poco", label: "Poço e Sistema de Cloração de Água", systemType: "Água Tratada e Subterrânea" },
    ],
  },
  {
    id: "demo17",
    name: "Residencial Jardim das Cachoeiras",
    shortName: "Jardim das Cachoeiras",
    category: "D",
    stations: [
      { id: "poco", label: "Poço Tubular — Água Subterrânea e Consumo", systemType: "Água Subterrânea" },
    ],
  },
  {
    id: "demo18",
    name: "Cerâmica Atlas Ltda.",
    shortName: "Cerâmica Atlas",
    category: "D",
    stations: [
      { id: "poco", label: "Captação Subterrânea e Reservatório", systemType: "Água Tratada e Subterrânea" },
    ],
  },
  {
    id: "demo19",
    name: "FW Demo19 Indústria",
    shortName: "FW Demo19",
    category: "D",
    stations: [
      { id: "poco", label: "Poço Artesiano e Água de Processo", systemType: "Água Tratada e Subterrânea" },
    ],
  },
  {
    id: "demo20",
    name: "Demo20 Alimentos",
    shortName: "Demo20",
    category: "D",
    stations: [
      { id: "poco", label: "Água de Consumo e Captação Subterrânea", systemType: "Água de Consumo / Poço" },
      { id: "legionella", label: "Programa Especial — Monitoramento Legionella", systemType: "Monitoramento Especial" },
    ],
  },
  {
    id: "demo21",
    name: "Demo21 Isolamentos",
    shortName: "Demo21",
    category: "D",
    stations: [
      { id: "poco", label: "Poço Tubular e Saída do Tratamento", systemType: "Água Subterrânea" },
    ],
  },
  {
    id: "demo22",
    name: "DEMO22 Indústria",
    shortName: "DEMO22",
    category: "D",
    stations: [
      { id: "poco", label: "Captação Subterrânea — Poço", systemType: "Água Subterrânea" },
    ],
  },

  // --- Modelo E: Efluente de polidora ---
  {
    id: "demo23",
    name: "DEMO23 Cerâmica",
    shortName: "DEMO23",
    category: "E",
    stations: [
      { id: "polidora", label: "Polidora — Tratamento de Efluente Industrial", systemType: "Efluente de Polidora" },
    ],
  },
  {
    id: "demo24",
    name: "Cerâmica Demo24 Ltda.",
    shortName: "Cerâmica Demo24",
    category: "E",
    stations: [
      { id: "combined", label: "Esmaltação e Polidora — Tratamento Físico-Químico", systemType: "Industrial Físico-Químico" },
      { id: "poco", label: "Poço — Água Subterrânea", systemType: "Água Subterrânea" },
    ],
  },
  {
    id: "demo25",
    name: "DEMO25 Cerâmica",
    shortName: "DEMO25",
    category: "E",
    stations: [
      { id: "polidora", label: "Polidora — Tratamento e Recirculação", systemType: "Efluente de Polidora" },
    ],
  },
  {
    id: "demo26",
    name: "Demo26 Cerâmica",
    shortName: "Demo26",
    category: "E",
    stations: [
      { id: "polidora", label: "Polidora — Efluente Industrial", systemType: "Efluente de Polidora" },
    ],
  },
  {
    id: "demo27",
    name: "Demo27",
    shortName: "Demo27",
    category: "E",
    stations: [
      { id: "polidora", label: "Polidora — Sistema de Decantação e Clarificação", systemType: "Efluente de Polidora" },
    ],
  },
];

function defaultFixedTextForSystem(clientName: string, systemType: string): FixedModelText {
  const sha = "0".repeat(64);
  return {
    source: { fileName: "cadastro-tecnico-ouro-fino", sha256: sha },
    sections: [
      {
        id: "presentation",
        title: "Apresentação",
        paragraphs: [
          `A empresa Ouro Fino Tecnologias Ambientais Ltda. apresenta para ${clientName} o relatório técnico de acompanhamento da unidade (${systemType}).`
        ]
      },
      {
        id: "technical-introduction",
        title: "Informações Técnicas e Descrição da Unidade",
        paragraphs: [
          `O presente documento consolida os dados operacionais e os ensaios laboratoriais desenvolvidos pela Ouro Fino Tecnologias Ambientais Ltda. para a unidade de ${systemType} da empresa ${clientName}.`,
          "O controle ambiental e operacional é realizado em estrita observância às normas técnicas e aos padrões de qualidade legalmente vigentes, visando a eficiência contínua do sistema e a sustentabilidade das operações."
        ]
      },
      {
        id: "objective",
        title: "Objetivo",
        paragraphs: [
          `Acompanhar o funcionamento da unidade de ${systemType}, avaliar o atendimento aos limites ambientais aplicáveis e orientar recomendações técnicas para a melhoria contínua do processo.`
        ]
      },
      {
        id: "methodology",
        title: "Metodologia e Controle Analítico",
        paragraphs: [
          "As amostragens e determinações analíticas seguem as metodologias consagradas do Standard Methods for the Examination of Water and Wastewater, garantindo rigor técnico, calibração periódica e rastreabilidade metrológica."
        ]
      }
    ],
    monthlyRequirements: {
      laboratory: "conditional",
      operations: "conditional",
      supplies: "conditional",
      meters: "conditional",
      journal: "conditional",
      efficiency: "conditional"
    }
  };
}

export function getClientCatalogEntry(clientId: ReportClientId, stationId: string): IdentitySeed | undefined {
  return DEFAULT_CATALOG.entries.find((e) => e.clientId === clientId && e.stationId === stationId);
}

export function buildClientSettingsWithDefaults(
  existing: ReportClientSettings | null,
  clientId: ReportClientId,
  actorUid = "system-auto"
): ReportClientSettings {
  let settings: ReportClientSettings = existing ?? {
    clientId,
    identities: {},
    mappings: [],
    enabledPresetVersions: [],
    references: [],
    updatedByUid: actorUid,
  };

  if (!settings.technicalApproverUid) {
    settings.technicalApproverUid = actorUid;
  }
  if (!settings.enabledRendererVersions) {
    settings.enabledRendererVersions = {};
  }
  if (!settings.editorialModels) {
    settings.editorialModels = {};
  }

  // Find client info from list
  const clientInfo = CLIENT_LIST.find((c) => c.id === clientId) ?? {
    id: clientId,
    name: String(clientId).toUpperCase(),
    shortName: String(clientId).toUpperCase(),
    category: "A" as const,
    stations: [{ id: "ete", label: "Estação de Tratamento", systemType: "Tratamento de Efluentes" }],
  };

  for (const station of clientInfo.stations) {
    const stationId = station.id;
    const catalogEntry = getClientCatalogEntry(clientId, stationId);

    // 1. Identity setup
    if (catalogEntry) {
      const currentIdentity = settings.identities[stationId] ?? emptyReportIdentity();
      const incomingFields = Object.keys(catalogEntry.identity) as (keyof typeof catalogEntry.identity)[];
      const hasMissingFields = incomingFields.some(
        (f) => catalogEntry.identity[f] && !currentIdentity[f]?.trim()
      );
      const hasFixedModel = settings.references.some((r) => r.id === `fixed-model:${stationId}`);

      if (hasMissingFields || (!hasFixedModel && catalogEntry.fixedText)) {
        settings = mergeIdentitySeed(
          settings,
          catalogEntry,
          incomingFields.map((field) => ({
            field,
            apply: !currentIdentity[field]?.trim() && Boolean(catalogEntry.identity[field]),
          })),
          actorUid,
          new Date().toISOString(),
          true
        );
      }
    }

    // Complete identity fallbacks so reports are never blocked by missing defaults
    const idObj = settings.identities[stationId] ?? emptyReportIdentity();
    if (!idObj.clientDisplayName?.trim()) idObj.clientDisplayName = clientInfo.name;
    if (!idObj.facilityName?.trim()) idObj.facilityName = clientInfo.name;
    if (!idObj.requesterName?.trim()) idObj.requesterName = clientInfo.name;
    if (!idObj.responsibleName?.trim()) idObj.responsibleName = "Marco Rogério Gomes da Silva";
    if (!idObj.responsibleRegistration?.trim()) idObj.responsibleRegistration = "CRQ IV 04165292";
    if (!idObj.address?.trim()) idObj.address = "Endereço cadastrado na unidade";
    if (!idObj.state?.trim()) idObj.state = "SP";
    settings.identities[stationId] = idObj;

    // Fixed model text setup
    const hasFixedModel = settings.references.some((r) => r.id === `fixed-model:${stationId}`);
    if (!hasFixedModel) {
      const fixedText = catalogEntry?.fixedText ?? defaultFixedTextForSystem(clientInfo.name, station.systemType);
      settings.references.push({
        id: `fixed-model:${stationId}`,
        parameter: "Texto Fixo",
        pointId: stationId,
        unit: "texto",
        min: null,
        max: null,
        source: fixedText.source.fileName || "cadastro-tecnico-ouro-fino",
        version: (/^[a-f0-9]{64}$/.test(fixedText.source.sha256) ? fixedText.source.sha256 : "0".repeat(64)),
        application: JSON.stringify(fixedText),
        approvedByUid: actorUid,
      });
    }

    // 2. Ensure preset is enabled
    const presetV2Key = `${stationId}@2`;
    if (!settings.enabledPresetVersions.includes(presetV2Key)) {
      settings.enabledPresetVersions.push(presetV2Key);
    }

    // 3. Ensure V4 technical renderer is enabled
    const rendererMap = settings.enabledRendererVersions ?? {};
    settings.enabledRendererVersions = rendererMap;
    if (!rendererMap[stationId]) {
      rendererMap[stationId] = ["3", "4"];
    } else if (!rendererMap[stationId].includes("4")) {
      rendererMap[stationId].push("4");
    }

    // 4. Ensure editorial model is approved for station
    const editorialMap = settings.editorialModels ?? {};
    settings.editorialModels = editorialMap;
    if (!editorialMap[stationId]) {
      editorialMap[stationId] = {
        approvedByUid: actorUid,
        approvedAt: new Date().toISOString(),
        version: "1",
        sourceHash: "default-standard-v1",
        sections: [],
      };
    }
  }

  return settings;
}
