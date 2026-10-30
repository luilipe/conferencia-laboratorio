import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalCompanyName,
  resolveAnalysisClientRule,
} from "../lib/analysis-client-matching.ts";
import { DEFAULT_ANALYSIS_CLIENT_RULES } from "../lib/analysis-client-rules.ts";
import {
  buildAutomaticAnalysisClientRule,
  buildAnalysisNotionProvisioningDrafts,
  generateNotionScheduleText,
  groupAnalysisScheduleSamples,
} from "../lib/analysis-schedule.ts";

function sample(overrides = {}) {
  return {
    sampleNumber: "15718-1/2026.0",
    code: "148842",
    proposal: "PC977/2026",
    identification: "Saída do Poço 02",
    sampleType: "Água Subterrânea",
    company: "Demo28 do Brasil Participações LTDA - Ouro Fino",
    collectionDate: "04/08/2026 15:47",
    publicationDate: "14/08/2026 17:35",
    opinion: "Conforme",
    sampleStatus: "Publicada",
    analyses: ["Turbidez"],
    sourceFiles: ["samples-20_08_2026.xlsx"],
    sourceRows: 4,
    ...overrides,
  };
}

test("normaliza Demo28 do sample e o título do catálogo para a mesma empresa", () => {
  assert.equal(
    canonicalCompanyName("Demo28 do Brasil Participações LTDA - Ouro Fino"),
    canonicalCompanyName("DEMO28 DO BRASIL PARTICIPACOES LTDA. - ÁGUA"),
  );
});

test("resolve Demo28 mensal pela regra correta", () => {
  const resolution = resolveAnalysisClientRule(sample(), "Água", "Mensal", DEFAULT_ANALYSIS_CLIENT_RULES);
  assert.equal(resolution.status, "matched");
  assert.match(resolution.rule?.title ?? "", /^DEMO28/i);
  assert.doesNotMatch(resolution.rule?.title ?? "", /MASSIMO/i);
});

test("não associa Demo28 à Massimo quando Demo28 não está no catálogo", () => {
  const massimoOnly = DEFAULT_ANALYSIS_CLIENT_RULES.filter((rule) => rule.title.includes("MASSIMO"));
  const resolution = resolveAnalysisClientRule(sample(), "Água", "Mensal", massimoOnly);
  assert.equal(resolution.status, "unmatched");
  assert.equal(resolution.rule, null);
});

test("correspondência aproximada vira sugestão e nunca confirmação", () => {
  const massimoOnly = DEFAULT_ANALYSIS_CLIENT_RULES.filter((rule) =>
    rule.title === "MASSIMO DEMO07 BEVERAGE BRASIL - ÁGUA",
  );
  const resolution = resolveAnalysisClientRule(sample({
    company: "Massimo Demo07 Brasil - Ouro Fino",
  }), "Água", "Mensal", massimoOnly);
  assert.equal(resolution.status, "suggested");
  assert.equal(resolution.rule, null);
  assert.equal(resolution.candidates[0]?.title, "MASSIMO DEMO07 BEVERAGE BRASIL - ÁGUA");
});

test("regras duplicadas do DEMO22 permanecem ambíguas sem qualificador", () => {
  const resolution = resolveAnalysisClientRule(sample({ company: "DEMO22 - Ouro Fino" }), "Água", "Mensal", DEFAULT_ANALYSIS_CLIENT_RULES);
  assert.equal(resolution.status, "ambiguous");
  assert.equal(resolution.rule, null);
  assert.equal(resolution.candidates.length, 2);
});

test("agrupa as seis amostras Demo28 com liberação consolidada em 17/08", () => {
  const samples = [
    sample(),
    sample({ sampleNumber: "15719-1/2026.0", identification: "Saída do Poço 07" }),
    sample({ sampleNumber: "15720-1/2026.0", identification: "Saída do Tratamento 02", publicationDate: "17/08/2026 10:48" }),
    sample({ sampleNumber: "15721-1/2026.0", identification: "Saída do Tratamento 07", publicationDate: "17/08/2026 10:49" }),
    sample({ sampleNumber: "15722-1/2026.0", identification: "Torneira Pública", publicationDate: "17/08/2026 10:49" }),
    sample({ sampleNumber: "15723-1/2026.0", identification: "Refeitório", publicationDate: "17/08/2026 10:49" }),
  ];
  const [group] = groupAnalysisScheduleSamples(samples);
  assert.match(group.clientTitle, /^DEMO28/i);
  assert.equal(group.sampleNumbers.length, 6);
  assert.deepEqual(group.collectionDates, ["04/08/2026"]);
  assert.equal(group.publicationDate, "17/08/2026");
  assert.equal(group.publicationStatus, "Publicado");
  assert.equal(group.safeForNotion, true);
});

test("texto do Notion solicita a criação de clientes não cadastrados com todas as colunas", () => {
  const groups = groupAnalysisScheduleSamples([
    sample(),
    sample({ sampleNumber: "99999-1/2026.0", company: "Cliente não cadastrado" }),
  ]);
  const payload = generateNotionScheduleText({ competence: "2026-08", groups });
  assert.match(payload.text, /DEMO28/i);
  assert.match(payload.text, /Cliente: CLIENTE NÃO CADASTRADO - ÁGUA/i);
  assert.match(payload.text, /Tipo de nota: Nota Mensal/i);
  assert.match(payload.text, /Nota: marcar a caixa/i);
  assert.match(payload.text, /Coleta: 04\/08\/2026/i);
  assert.match(payload.text, /Envio ao Laboratório: deixar em branco/i);
  assert.match(payload.text, /Liberação do laudo: 14\/08\/2026/i);
  assert.match(payload.text, /Envio ao Cliente: deixar em branco/i);
  assert.match(payload.text, /Periodicidade: Mensal/i);
  assert.match(payload.text, /Tipo de análise: Água/i);
  assert.equal(payload.includedGroups.length, 1);
  assert.equal(payload.creationGroups.length, 1);
  assert.equal(payload.blockedGroups.length, 0);
});

test("texto do Notion mantém correspondências ambíguas fora da criação automática", () => {
  const groups = groupAnalysisScheduleSamples([
    sample({ company: "DEMO22 - Ouro Fino" }),
  ]);
  const payload = generateNotionScheduleText({ competence: "2026-08", groups });

  assert.equal(payload.includedGroups.length, 0);
  assert.equal(payload.creationGroups.length, 0);
  assert.equal(payload.blockedGroups.length, 1);
  assert.doesNotMatch(payload.text, /Cliente: DEMO22/i);
});

test("novo registro semestral usa os valores da tabela e não inventa datas", () => {
  const groups = groupAnalysisScheduleSamples([
    sample({
      company: "Nova empresa - Ouro Fino",
      identification: "Poço 01 - Semestral",
      publicationDate: "",
      sampleStatus: "Em Análise",
    }),
  ]);
  const payload = generateNotionScheduleText({ competence: "2026-08", groups });

  assert.match(payload.text, /Cliente: NOVA EMPRESA - ÁGUA SEMESTRAL/i);
  assert.match(payload.text, /Tipo de nota: Não tem no mês/i);
  assert.match(payload.text, /Liberação do laudo: deixar em branco/i);
  assert.match(payload.text, /Periodicidade: Semestral/i);
  assert.equal(payload.creationGroups.length, 1);
});

test("solicitação de Notion é determinística e consolida os dados do grupo não cadastrado", () => {
  const groups = groupAnalysisScheduleSamples([
    sample({ company: "Cliente Novo - Ouro Fino" }),
    sample({ sampleNumber: "99998-1/2026.0", company: "Cliente Novo - Ouro Fino" }),
  ]);
  const first = buildAnalysisNotionProvisioningDrafts("2026-08", groups);
  const second = buildAnalysisNotionProvisioningDrafts("2026-08", groups);

  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].catalogStatus, "pending");
  assert.deepEqual(first[0].sampleNumbers, ["15718-1/2026.0", "99998-1/2026.0"]);
  assert.match(first[0].proposedTitle, /CLIENTE NOVO - ÁGUA/i);
});

test("cliente sem candidato vira regra local automática sem intervenção humana", () => {
  const groups = groupAnalysisScheduleSamples([
    sample({ company: "Cliente Automático - Ouro Fino" }),
  ]);
  const [draft] = buildAnalysisNotionProvisioningDrafts("2026-08", groups);
  const rule = buildAutomaticAnalysisClientRule(draft);

  assert.equal(rule.id, draft.proposedRuleId);
  assert.equal(rule.title, "CLIENTE AUTOMÁTICO - ÁGUA");
  assert.deepEqual(rule.aliases, ["Cliente Automático - Ouro Fino"]);
  assert.deepEqual(rule.companyKeys, ["cliente automatico"]);
  assert.equal(rule.analysisType, "Água");
  assert.equal(rule.periodicity, "Mensal");
  assert.equal(rule.active, true);

  const regrouped = groupAnalysisScheduleSamples([
    sample({ company: "Cliente Automático - Ouro Fino" }),
  ], [rule]);
  assert.equal(regrouped[0].resolutionStatus, "matched");
  assert.equal(regrouped[0].safeForNotion, true);
});

test("automação preserva configuração especializada de uma regra existente", () => {
  const groups = groupAnalysisScheduleSamples([
    sample({ company: "Cliente Automático - Ouro Fino" }),
  ]);
  const [draft] = buildAnalysisNotionProvisioningDrafts("2026-08", groups);
  const existing = {
    id: draft.proposedRuleId,
    title: "Título revisado",
    notionUrl: "https://notion.example/registro",
    aliases: ["Nome anterior"],
    companyKeys: ["nome anterior"],
    analysisType: "Água",
    periodicity: "Mensal",
    qualifiers: { identificationIncludes: ["poço"] },
    active: false,
  };
  const rule = buildAutomaticAnalysisClientRule(draft, existing);

  assert.equal(rule.title, "Título revisado");
  assert.equal(rule.notionUrl, "https://notion.example/registro");
  assert.deepEqual(rule.qualifiers, { identificationIncludes: ["poço"] });
  assert.equal(rule.active, false);
  assert.deepEqual(rule.aliases, ["Nome anterior", "Cliente Automático - Ouro Fino"]);
});

test("pedido persistente continua no texto após vínculo local e orienta base atual e modelo", () => {
  const groups = groupAnalysisScheduleSamples([
    sample({ company: "Cliente Persistente - Ouro Fino" }),
  ]);
  const [draft] = buildAnalysisNotionProvisioningDrafts("2026-08", groups);
  const request = {
    ...draft,
    ruleId: draft.proposedRuleId,
    catalogStatus: "linked",
    requestedAt: "2026-08-31T10:00:00.000Z",
    requestedByUid: "admin",
    requestedByName: "Administrador",
    updatedAt: "2026-08-31T10:00:00.000Z",
  };
  const payload = generateNotionScheduleText({
    competence: "2026-08",
    groups,
    provisioningRequests: [request],
    notionSettings: {
      templateDatabaseName: "Modelo mestre",
      templateDatabaseUrl: "https://notion.example/modelo",
      competenceDatabases: {
        "2026-08": { name: "Agosto 2026", url: "https://notion.example/agosto" },
      },
      promptVersion: 1,
    },
  });

  assert.match(payload.text, /BASE ATUAL \(Agosto 2026\)/i);
  assert.match(payload.text, /https:\/\/notion\.example\/agosto/i);
  assert.match(payload.text, /NO MODELO \(Modelo mestre\)/i);
  assert.match(payload.text, /https:\/\/notion\.example\/modelo/i);
  assert.equal(payload.text.match(/Cliente: CLIENTE PERSISTENTE - ÁGUA/gi)?.length, 2);
  assert.match(payload.text, /O modelo não deve receber datas operacionais/i);
  assert.doesNotMatch(payload.text.split("NOVOS REGISTROS — LOCALIZAR OU CRIAR NO MODELO")[1], /04\/08\/2026/);
  assert.equal(payload.provisioningRequests.length, 1);
});

test("regra local vinculada não faz o item aparecer como existente antes de ser localizado no mês", () => {
  const source = sample({ company: "Cliente Vinculado - Ouro Fino" });
  const unmatchedGroups = groupAnalysisScheduleSamples([source]);
  const [draft] = buildAnalysisNotionProvisioningDrafts("2026-08", unmatchedGroups);
  const rule = {
    id: draft.proposedRuleId,
    title: draft.proposedTitle,
    aliases: [source.company],
    companyKeys: [source.company],
    analysisType: draft.analysisType,
    periodicity: draft.periodicity,
    qualifiers: {},
    active: true,
  };
  const matchedGroups = groupAnalysisScheduleSamples([source], [rule]);
  const request = {
    ...draft,
    ruleId: rule.id,
    catalogStatus: "linked",
    requestedAt: "2026-08-31T10:00:00.000Z",
    requestedByUid: "admin",
    requestedByName: "Administrador",
    updatedAt: "2026-08-31T10:00:00.000Z",
  };
  const payload = generateNotionScheduleText({
    competence: "2026-08",
    groups: matchedGroups,
    provisioningRequests: [request],
  });
  const existingSection = payload.text.split("NOVOS REGISTROS — LOCALIZAR OU CRIAR NA BASE ATUAL")[0];

  assert.doesNotMatch(existingSection, /CLIENTE VINCULADO/i);
  assert.match(payload.text, /Cliente: CLIENTE VINCULADO - ÁGUA/i);
});

test("destino já confirmado não volta para a instrução de criação", () => {
  const groups = groupAnalysisScheduleSamples([
    sample({ company: "Cliente Confirmado - Ouro Fino" }),
  ]);
  const [draft] = buildAnalysisNotionProvisioningDrafts("2026-08", groups);
  const request = {
    ...draft,
    catalogStatus: "linked",
    currentTarget: { status: "found", notionUrl: "https://notion.example/atual" },
    templateTarget: { status: "created", notionUrl: "https://notion.example/modelo" },
    requestedAt: "2026-08-31T10:00:00.000Z",
    requestedByUid: "admin",
    requestedByName: "Administrador",
    updatedAt: "2026-08-31T10:00:00.000Z",
    completedAt: "2026-08-31T10:05:00.000Z",
    completedByUid: "admin",
  };
  const payload = generateNotionScheduleText({
    competence: "2026-08",
    groups,
    provisioningRequests: [request],
  });

  assert.doesNotMatch(payload.text, /Cliente: CLIENTE CONFIRMADO/i);
  assert.match(payload.text, /Nenhum novo registro precisa ser criado na base atual/i);
  assert.match(payload.text, /Nenhum novo registro precisa ser criado no modelo/i);
});
