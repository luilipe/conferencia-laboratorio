import assert from "node:assert/strict";
import test from "node:test";
import { buildComplianceRun, complianceMonthKey, parseComplianceDocuments } from "../lib/compliance.ts";
import { LEGAL_RULES } from "../lib/compliance-rules.ts";
import { buildMonthlyExecutiveReport } from "../lib/monthly-compliance-report.ts";

function file(name, documentType, pages) {
  return {
    file: { name, size: 1000, sha256: name, pages: pages.length, documentType },
    pages: pages.map((lines, index) => ({ pageNumber: index + 1, lines, text: lines.join("\n") })),
  };
}

function labPage({ sample, point, cnpj = "00.057.488/9108-00", client = "Cerâmica Demo30 LTDA - Ouro Fino", collectionDate = "10/01/2026 09:30", measurements = [], conclusion = [] }) {
  return [
    "Relatório de Análises",
    `Cliente: ${client} CNPJ/CPF: ${cnpj}`,
    `Nº Amostra: ${sample} - ${point}`,
    "Tipo de Amostra: Água subterrânea tratada",
    `Data Coleta: ${collectionDate}`,
    "Resultados Analíticos",
    ...measurements,
    ...conclusion,
  ];
}

const monthly = [
  "Controle Mensal de SAC",
  "Instituição Responsável: CERAMICA DEMO30",
  "Nome SAC: UNIDADEFICTICIA",
  "Código SAC: C354670000041",
  "Município: SANTA GERTRUDES",
  "UF: SP",
  "Mês: Janeiro",
  "01/01/2026",
  "Cloro Residual Livre",
  "Número de amostras analisadas 1 1",
  "Percentil 95 0,15 0,15",
  "Número de dados > 5,0 mg/L 0 0",
  "Número de dados >= 0,2 mg/L e <= 5,0 mg/L 1 1",
  "Número de dados < 0,2 mg/L 0 0",
];

test("identifica cliente e instalação, consolida páginas e aplica as regras", () => {
  const documents = [
    file("12452.pdf", "laboratory_report", [labPage({
      sample: "12452-1/2026.0",
      point: "Saída do Poço - Instalacaoficticia",
      measurements: ["pH", "pH 8,90", "Turbidez", "< 1,50 NTU", "Escherichia coli", "Ausência em 100 mL"],
    })]),
    file("12453.pdf", "laboratory_report", [
      labPage({
        sample: "12453-1/2026.0",
        point: "Saída do Tratamento - Instalacaoficticia",
        measurements: ["Cloro Residual Livre", "< 0,15 mg/L", "Cor Aparente", "< 5 CU", "Turbidez", "< 1,50 NTU", "Escherichia coli", "Ausência em 100 mL"],
        conclusion: ["A presente amostra, em relação aos parâmetros analisados, NÃO ATENDE aos padrões estabelecidos pela legislação vigente", "humano e seu padrão de potabilidade no(s) parâmetro(s) Cloro Residual Livre."],
      }),
      labPage({
        sample: "12453-1/2026.0",
        point: "Saída do Tratamento - Instalacaoficticia",
        measurements: ["Fluoreto", "< 0,10 mg/L", "Bactérias Heterotróficas", "109 UFC/mL"],
      }),
    ]),
    file("12459.pdf", "laboratory_report", [labPage({
      sample: "12459-1/2026.0",
      point: "Ponto de Consumo - Instalacaoficticia",
      measurements: ["Cloro Residual Livre", "< 0.15 mg/L", "Escherichia coli", "Ausência em 100 mL"],
      conclusion: ["A presente amostra, em relação aos parâmetros analisados, NÃO ATENDE aos padrões estabelecidos pela legislação vigente", "humano e seu padrão de potabilidade no(s) parâmetro(s) Cloro Residual Livre."],
    })]),
    file("mensal-unidadeficticia.pdf", "sisagua_monthly", [monthly]),
  ];

  const parsed = parseComplianceDocuments(documents);
  const run = buildComplianceRun(parsed);

  assert.equal(parsed.identity.cnpj, "00.057.488/9108-00");
  assert.equal(parsed.identity.facilityName, "UNIDADEFICTICIA");
  assert.equal(parsed.identity.sisaguaCode, "C354670000041");
  assert.equal(parsed.identity.confidence, "high");
  assert.equal(parsed.results.filter((item) => item.sampleNumber === "12453-1/2026.0" && item.parameterKey === "fluoride").length, 1);
  assert.equal(run.items.filter((item) => item.parameterKey === "free_residual_chlorine" && item.classification === "non_compliant").length, 2);
  assert.equal(run.summary.inconsistent, 2);
  assert.equal(run.summary.coverageNotProven, 2);
  assert.equal(run.periodLabel, "01/2026");
  assert.deepEqual(run.points.map((point) => point.label), [
    "Saída do Poço - Instalacaoficticia",
    "Saída do Tratamento - Instalacaoficticia",
    "Ponto de Consumo - Instalacaoficticia",
  ]);
  assert.equal(run.points.find((point) => point.pointType === "treatment")?.samples, 1);
  assert.ok(run.report);
  assert.equal(run.report.sections.length, 2);
  assert.match(run.report.text, /🔴 Ponto de coleta: Instalacaoficticia – Saída do tratamento/i);
  assert.match(run.report.text, /Cloro Residual Livre\nResultado: < 0,15 mg\/L/i);
  assert.match(run.report.text, /Padrão mínimo: 0,2 mg\/L/i);
  assert.match(run.report.text, /Resultado: < 0,15 mg\/L/i);
  assert.match(run.report.text, /NÃO ATENDE — o resultado encontra-se abaixo do padrão mínimo estabelecido para o parâmetro Cloro Residual Livre/i);
});

test("rejeita lote com mais de um CNPJ", () => {
  const documents = [
    file("a.pdf", "laboratory_report", [labPage({ sample: "1-1/2026.0", point: "Ponto de Consumo - A", measurements: ["Turbidez", "1,0 NTU"] })]),
    file("b.pdf", "laboratory_report", [labPage({ sample: "2-1/2026.0", point: "Ponto de Consumo - B", cnpj: "00.092.965/6951-00", measurements: ["Turbidez", "1,0 NTU"] })]),
  ];
  assert.throws(() => parseComplianceDocuments(documents), /mais de um CNPJ/i);
});

test("catálogo contém regras mensais e semestrais da potabilidade", () => {
  assert.ok(LEGAL_RULES.length > 80);
  assert.ok(LEGAL_RULES.some((rule) => rule.parameterKey === "free_residual_chlorine" && rule.frequency === "daily"));
  assert.ok(LEGAL_RULES.some((rule) => rule.parameterKey === "fluoride" && rule.frequency === "semiannual"));
});

test("resultado censurado só reprova quando o limite comprova a não conformidade", () => {
  const parsed = parseComplianceDocuments([
    file("censurado.pdf", "laboratory_report", [labPage({
      sample: "3-1/2026.0",
      point: "Ponto de Consumo - Instalacaoficticia",
      measurements: ["Turbidez", "<= 10,0 NTU"],
    })]),
  ]);
  const run = buildComplianceRun(parsed);
  assert.equal(run.items.find((item) => item.parameterKey === "turbidity")?.classification, "no_rule");
  assert.equal(run.report, null);
});

test("não gera relatório automático quando todos os valores estão dentro do padrão", () => {
  const parsed = parseComplianceDocuments([
    file("conforme.pdf", "laboratory_report", [labPage({
      sample: "30-1/2026.0",
      point: "Ponto de Consumo - Instalacaoficticia",
      measurements: ["Turbidez", "1,0 NTU", "Escherichia coli", "Ausência em 100 mL"],
    })]),
  ]);

  const run = buildComplianceRun(parsed);
  assert.equal(run.summary.nonCompliant, 0);
  assert.equal(run.report, null);
  assert.deepEqual(run.points.map((point) => point.label), ["Ponto de Consumo - Instalacaoficticia"]);
});

test("não confunde um ponto sem sufixo com o nome da instalação", () => {
  const parsed = parseComplianceDocuments([
    file("pontos-genericos.pdf", "laboratory_report", [
      labPage({
        sample: "31-1/2026.0",
        point: "Saída do Tratamento",
        measurements: ["Cloro Residual Livre", "0,50 mg/L"],
      }),
      labPage({
        sample: "32-1/2026.0",
        point: "Ponto de Consumo",
        measurements: ["Cloro Residual Livre", "0,50 mg/L"],
      }),
    ]),
  ]);

  const run = buildComplianceRun(parsed);
  assert.equal(run.identity.facilityName, "Instalação não identificada");
  assert.deepEqual(run.points.map((point) => point.label), ["Saída do Tratamento", "Ponto de Consumo"]);
  assert.equal(run.points.every((point) => point.status === "compliant"), true);
});

test("organiza o período em uma chave mensal ordenável", () => {
  assert.equal(complianceMonthKey("Janeiro/2026"), "2026-01");
  assert.equal(complianceMonthKey("07/2026"), "2026-07");
  assert.equal(complianceMonthKey("2026"), "periodo-nao-identificado");
});

test("define o mês pela data de coleta mesmo quando o relatório mensal indica outro período", () => {
  const parsed = parseComplianceDocuments([
    file("coleta-julho.pdf", "laboratory_report", [labPage({
      sample: "20-1/2026.0",
      point: "Saída do Tratamento - Instalacaoficticia",
      collectionDate: "15/07/2026 08:30",
      measurements: ["Cloro Residual Livre", "0,50 mg/L"],
    })]),
    file("mensal-janeiro.pdf", "sisagua_monthly", [monthly]),
  ]);

  const run = buildComplianceRun(parsed);
  assert.equal(run.periodLabel, "07/2026");
  assert.equal(complianceMonthKey(run.periodLabel), "2026-07");
});

test("rejeita um lote com amostras coletadas em meses diferentes", () => {
  const parsed = parseComplianceDocuments([
    file("julho.pdf", "laboratory_report", [labPage({
      sample: "21-1/2026.0",
      point: "Saída do Tratamento - Instalacaoficticia",
      collectionDate: "31/07/2026 08:30",
      measurements: ["Cloro Residual Livre", "0,50 mg/L"],
    })]),
    file("agosto.pdf", "laboratory_report", [labPage({
      sample: "22-1/2026.0",
      point: "Ponto de Consumo - Instalacaoficticia",
      collectionDate: "01/08/2026 08:30",
      measurements: ["Cloro Residual Livre", "0,50 mg/L"],
    })]),
  ]);

  assert.throws(() => buildComplianceRun(parsed), /datas de coleta em meses diferentes/i);
});

test("usa a instalação presente em cada ponto no título do relatório", () => {
  const parsed = parseComplianceDocuments([
    file("poco-04.pdf", "laboratory_report", [labPage({
      sample: "4-1/2026.0",
      point: "Saída do Tratamento - Poço 04",
      measurements: ["Cloro Residual Livre", "< 0,15 mg/L"],
      conclusion: ["A presente amostra, em relação aos parâmetros analisados, NÃO ATENDE aos padrões estabelecidos", "humano e seu padrão de potabilidade no(s) parâmetro(s) Cloro Residual Livre."],
    })]),
  ]);
  const report = buildComplianceRun(parsed).report;
  assert.ok(report);
  assert.match(report.text, /🔴 Ponto de coleta: Poço 04 – Saída do tratamento/);
});

test("relatório mensal agrupa cliente, local, posição e somente parâmetros fora do padrão", () => {
  const conclusion = [
    "A presente amostra, em relação aos parâmetros analisados, NÃO ATENDE aos padrões estabelecidos",
    "humano e seu padrão de potabilidade no(s) parâmetro(s) Cloro Residual Livre.",
  ];
  const parsed = parseComplianceDocuments([
    file("unidadeficticia.pdf", "laboratory_report", [labPage({
      sample: "10-1/2026.0",
      point: "Saída do Tratamento - Instalacaoficticia",
      measurements: ["Cloro Residual Livre", "< 0,15 mg/L", "Turbidez", "1,0 NTU"],
      conclusion,
    })]),
    file("poco4.pdf", "laboratory_report", [labPage({
      sample: "11-1/2026.0",
      point: "Saída do Tratamento - Poço 04",
      measurements: ["Cloro Residual Livre", "< 0,15 mg/L"],
      conclusion,
    })]),
  ]);
  const run = buildComplianceRun(parsed);
  const entry = {
    id: "run-1",
    runId: "run-1",
    identity: run.identity,
    periodLabel: run.periodLabel,
    summary: run.summary,
    ruleSetVersion: run.ruleSetVersion,
    report: run.report,
    nonCompliances: run.items.filter((item) => item.classification === "non_compliant"),
    files: run.files,
    createdByName: "Teste",
    createdByEmail: "teste@example.com",
    createdAt: "2026-07-31T12:00:00.000Z",
  };
  const report = buildMonthlyExecutiveReport("2026-07", "Julho de 2026", [{
    client: { id: "demo30", clientName: run.identity.clientName, cnpj: run.identity.cnpj, facilityName: "Instalacaoficticia", updatedAt: null },
    entries: [entry, entry],
  }]);

  assert.equal(report.summary.affectedClients, 1);
  assert.equal(report.summary.affectedLocations, 2);
  assert.equal(report.summary.nonCompliances, 2);
  assert.equal(report.clients[0].name, "Cerâmica Demo30");
  assert.deepEqual(report.clients[0].locations.map((location) => location.name), ["Instalacaoficticia", "Poço 4"]);
  assert.equal(report.clients[0].locations[1].positions[0].name, "Saída do tratamento");
  assert.match(report.text, /CERÂMICA DEMO30[\s\S]*POÇO 4[\s\S]*Saída do tratamento[\s\S]*Cloro residual livre/);
  assert.doesNotMatch(report.text, /Turbidez|Sisagua|cobertura/i);
});
