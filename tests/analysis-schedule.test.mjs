import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisSampleDocumentId,
  buildPendingAnalysisReport,
  buildAnalysisSchedulePreview,
  collectionDateCompetence,
  findAnalysisCompetenceConflicts,
  generateWhatsAppPendingText,
  generateNotionScheduleText,
  groupAnalysisScheduleSamples,
  inferDominantCompetence,
  partitionSamplesByCollectionMonth,
} from "../lib/analysis-schedule.ts";
import { buildPendingAnalysisPdf } from "../app/pending-analysis-report-export.ts";

function sample(overrides = {}) {
  return {
    sampleNumber: "13021-1/2026.0",
    code: "139256",
    proposal: "PC977/2026",
    identification: "ETDI - Bruto (Mensal)",
    sampleType: "Água Residual",
    company: "Demo13 Lubrificantes S/A - Ouro Fino",
    collectionDate: "06/07/2026 13:08",
    publicationDate: "",
    opinion: "",
    sampleStatus: "Em Análise",
    analyses: ["DBO₅"],
    sourceFiles: ["samples.xlsx"],
    sourceRows: 4,
    ...overrides,
  };
}

function stored(source, overrides = {}) {
  return {
    ...source,
    id: analysisSampleDocumentId(source.sampleNumber),
    sampleKey: source.sampleNumber.replace(/\.\d+$/, ""),
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    lastSeenAt: "2026-08-01T10:00:00.000Z",
    lastUploadId: "upload-anterior",
    updatedByUid: "user-1",
    ...overrides,
  };
}

test("reimportação atualiza publicação sem duplicar a amostra", () => {
  const original = sample();
  const published = sample({
    publicationDate: "31/07/2026 09:10",
    opinion: "Não Conforme",
    sampleStatus: "Publicada",
    sourceFiles: ["samples-atualizado.xlsx"],
  });
  const preview = buildAnalysisSchedulePreview([stored(original)], [published], "2026-07");

  assert.equal(preview.inserted.length, 0);
  assert.equal(preview.updated.length, 1);
  assert.equal(preview.unchanged.length, 0);
  assert.equal(preview.mergedSamples.length, 1);
  assert.equal(preview.mergedSamples[0].publicationDate, "31/07/2026 09:10");
});

test("exportação parcial não remove amostras antigas", () => {
  const first = sample();
  const second = sample({
    sampleNumber: "13023-1/2026.0",
    identification: "ETDI - Tratado (Mensal)",
  });
  const preview = buildAnalysisSchedulePreview([stored(first), stored(second)], [second], "2026-07");

  assert.equal(preview.mergedSamples.length, 2);
  assert.ok(preview.mergedSamples.some((entry) => entry.sampleNumber === first.sampleNumber));
});

test("separa amostras fora da competência e infere o mês predominante", () => {
  const july = sample();
  const august = sample({ sampleNumber: "14000-1/2026.0", collectionDate: "01/08/2026 08:00" });
  const preview = buildAnalysisSchedulePreview([], [july, august], "2026-07");

  assert.equal(preview.outsideCompetence.length, 1);
  assert.equal(inferDominantCompetence([july, july, august]), "2026-07");
});

test("define a competência somente pela data de coleta", () => {
  const collectedInJuly = sample({
    collectionDate: "31/07/2026 23:30",
    publicationDate: "05/08/2026 09:00",
  });

  assert.equal(collectionDateCompetence(collectedInJuly.collectionDate), "2026-07");
  assert.equal(inferDominantCompetence([collectedInJuly]), "2026-07");
});

test("divide automaticamente um arquivo com coletas de meses diferentes", () => {
  const july = sample();
  const august = sample({ sampleNumber: "14000-1/2026.0", collectionDate: "01/08/2026 08:00" });
  const partition = partitionSamplesByCollectionMonth([august, july]);

  assert.deepEqual(partition.months.map((item) => item.competence), ["2026-07", "2026-08"]);
  assert.equal(partition.months[0].samples[0].sampleNumber, july.sampleNumber);
  assert.equal(partition.months[1].samples[0].sampleNumber, august.sampleNumber);
  assert.equal(partition.invalidSamples.length, 0);
});

test("isola amostras sem data de coleta válida", () => {
  const invalid = sample({ collectionDate: "" });
  const partition = partitionSamplesByCollectionMonth([invalid]);

  assert.equal(partition.months.length, 0);
  assert.deepEqual(partition.invalidSamples, [invalid]);
});

test("detecta quando uma amostra mudaria de competência histórica", () => {
  const moved = sample({ collectionDate: "01/08/2026 08:00" });
  const partition = partitionSamplesByCollectionMonth([moved]);
  const conflicts = findAnalysisCompetenceConflicts(
    partition,
    new Map([[moved.sampleNumber.replace(/\.\d+$/, ""), "2026-07"]]),
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].existingCompetence, "2026-07");
  assert.equal(conflicts[0].detectedCompetence, "2026-08");
});

test("agrupa por cliente e só libera quando todas as amostras estão publicadas", () => {
  const groups = groupAnalysisScheduleSamples([
    stored(sample({ publicationDate: "31/07/2026 09:10", sampleStatus: "Publicada" }), { lastUploadId: "novo" }),
    stored(sample({ sampleNumber: "13023-1/2026.0", identification: "ETDI - Tratado (Mensal)" }), { lastUploadId: "novo" }),
  ]);
  const demo13 = groups.find((group) => group.clientTitle.includes("DEMO13") && group.clientTitle.includes("ETDI"));

  assert.ok(demo13);
  assert.equal(demo13.publicationStatus, "Parcialmente publicado");
  assert.equal(demo13.publicationDate, "");
  assert.equal(demo13.sampleNumbers.length, 2);
});

test("texto do Notion pode conter somente a última importação", () => {
  const groups = groupAnalysisScheduleSamples([
    stored(sample({ publicationDate: "31/07/2026 09:10", sampleStatus: "Publicada" }), { lastUploadId: "novo" }),
  ]);
  const payload = generateNotionScheduleText({
    competence: "2026-07",
    groups,
    mode: "last-import",
    lastUploadId: "novo",
  });

  assert.match(payload.text, /DEMO13 LUBRIFICANTES/i);
  assert.match(payload.text, /31\/07\/2026/);
  assert.doesNotMatch(payload.text, /Página:|https:\/\/app\.notion\.com/i);
  assert.equal(payload.blockedGroups.length, 0);
});

test("relatório de pendências contém somente amostras sem publicação", () => {
  const report = buildPendingAnalysisReport({
    competence: "2026-07",
    generatedBy: "Revisor",
    generatedAt: new Date("2026-08-06T12:00:00.000Z"),
    samples: [
      stored(sample()),
      stored(sample({ sampleNumber: "13023-1/2026.0", publicationDate: "31/07/2026 09:10", sampleStatus: "Publicada" })),
    ],
  });

  assert.equal(report.total, 1);
  assert.deepEqual(Object.keys(report.rows[0]), ["sampleNumber", "client", "collectionDate", "identification", "situation"]);
  assert.equal(report.rows[0].sampleNumber, "13021-1/2026.0");
  assert.equal(report.rows[0].collectionDate, "06/07/2026");
  assert.equal(report.rows[0].situation, "Em Análise");
});

test("TXT para WhatsApp não inclui previsão e mantém a formatação de cobrança", () => {
  const report = buildPendingAnalysisReport({
    competence: "2026-07",
    generatedBy: "Revisor",
    samples: [stored(sample())],
  });
  const text = generateWhatsAppPendingText(report);

  assert.match(text, /\*PENDÊNCIAS DE LAUDOS/i);
  assert.match(text, /Cliente:/);
  assert.match(text, /Coleta: 06\/07\/2026/);
  assert.match(text, /Situação: Em Análise/);
  assert.doesNotMatch(text, /previsão/i);
});

test("gera um PDF válido com a relação de pendências", async () => {
  const report = buildPendingAnalysisReport({
    competence: "2026-07",
    generatedBy: "Revisor",
    samples: Array.from({ length: 18 }, (_, index) => stored(sample({
      sampleNumber: `${13021 + index}-1/2026.0`,
      identification: index % 2 ? "Saída do Tratamento" : "Ponto de Consumo",
    }))),
  });
  const pdf = await buildPendingAnalysisPdf(report);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));

  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(bytes.length > 4000);
});
