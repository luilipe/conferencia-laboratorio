import test from "node:test";
import assert from "node:assert/strict";
import { complianceItemsToLabBatch } from "../lib/client-reports/import-compliance.ts";

function createMockSettings() {
  return {
    clientId: "demo13",
    updatedByUid: "admin",
    enabledPresetVersions: ["etdi@v1"],
    references: [],
    identities: {
      etdi: {
        clientDisplayName: "DEMO13 LUBRIFICANTES S.A.",
        facilityName: "Unidade de Lubrificantes",
        requesterName: "DEMO13",
        taxId: "00.015.691/4426-00",
        address: "Av. Brasil, 100",
        responsibleName: "Resp",
        responsibleRegistration: "CRQ 123",
      },
    },
    mappings: [
      {
        labId: "compliance",
        companyAlias: "demo13",
        identification: "Saída do Efluente Tratado",
        stationId: "etdi",
        pointId: "tratado",
      },
      {
        labId: "compliance",
        companyAlias: "demo13",
        identification: "Entrada do Efluente Bruto",
        stationId: "etdi",
        pointId: "bruto",
      },
    ],
  };
}

test("complianceItemsToLabBatch: maps points strictly and preserves operators and raw values", () => {
  const settings = createMockSettings();
  const run = {
    id: "run-100",
    identity: { cnpj: "00.015.691/4426-00", clientName: "DEMO13" },
    periodLabel: "10/2026",
    files: [{ name: "laudo-out-2026.pdf", sha256: "abc123sha", size: 1024, pages: 2, documentType: "laboratory_report" }],
  };

  const items = [
    {
      id: "item-1",
      sampleNumber: "A001",
      sampleType: "Efluente",
      pointLabel: "Saída do Efluente Tratado",
      pointType: "treatment",
      collectionDate: "2026-10-14",
      parameterKey: "dbo",
      parameterName: "DBO 5",
      resultRaw: "< 5.0",
      operator: "<",
      value: 5.0,
      unit: "mg/L",
      lq: "5.0",
      ld: "2.0",
      sourceFile: "laudo-out-2026.pdf",
      sourcePage: 1,
      laboratoryConclusion: "meets",
      laboratoryConclusionRaw: "Em conformidade",
    },
    {
      id: "item-2",
      sampleNumber: "A001",
      sampleType: "Efluente",
      pointLabel: "Saída do Efluente Tratado",
      pointType: "treatment",
      collectionDate: "2026-10-14",
      parameterKey: "ph",
      parameterName: "pH",
      resultRaw: "7,35",
      operator: "=",
      value: 7.35,
      unit: "",
      lq: "",
      ld: "",
      sourceFile: "laudo-out-2026.pdf",
      sourcePage: 1,
      laboratoryConclusion: "meets",
      laboratoryConclusionRaw: "Em conformidade",
    },
  ];

  const batch = complianceItemsToLabBatch(items, run, settings, "2026-10");

  assert.equal(batch.sources.length, 1);
  assert.equal(batch.sources[0].id, "compliance:run-100");
  assert.equal(batch.sources[0].sha256, "abc123sha");
  assert.equal(batch.lab.length, 2);

  const dbo = batch.lab.find((r) => r.parameter === "DBO");
  assert.ok(dbo, "DBO parameter was normalized");
  assert.equal(dbo.pointId, "tratado");
  assert.equal(dbo.stationId, "etdi");
  assert.equal(dbo.value.operator, "<");
  assert.equal(dbo.value.value, 5.0);
  assert.equal(dbo.value.raw, "< 5.0");
  assert.equal(dbo.date, "2026-10-14");

  const ph = batch.lab.find((r) => r.parameter === "pH");
  assert.ok(ph);
  assert.equal(ph.value.operator, "=");
  assert.equal(ph.value.value, 7.35);

  const blockers = batch.issues.filter((i) => i.severity === "blocker");
  assert.equal(blockers.length, 0, "No blockers on clean match");
});

test("complianceItemsToLabBatch: flags divergent CNPJ as blocker and blocks associating by resemblance", () => {
  const settings = createMockSettings();
  const run = {
    id: "run-divergent",
    identity: { cnpj: "00.019.297/3471-00", clientName: "Outra Empresa S.A." },
    periodLabel: "10/2026",
    files: [],
  };

  const items = [
    {
      id: "item-1",
      sampleNumber: "B001",
      sampleType: "Efluente",
      pointLabel: "Saída do Efluente Tratado",
      pointType: "treatment",
      collectionDate: "2026-10-14",
      parameterKey: "dbo",
      parameterName: "DBO",
      resultRaw: "10",
      operator: "=",
      value: 10,
      unit: "mg/L",
      lq: "",
      ld: "",
      sourceFile: "outra.pdf",
      sourcePage: 1,
      laboratoryConclusion: "meets",
      laboratoryConclusionRaw: "",
    },
  ];

  const batch = complianceItemsToLabBatch(items, run, settings, "2026-10");
  const cnpjIssue = batch.issues.find((i) => i.code === "compliance-cnpj-divergent");
  assert.ok(cnpjIssue, "Divergent CNPJ issue was emitted");
  assert.equal(cnpjIssue.severity, "blocker");
});

test("complianceItemsToLabBatch: unmapped points are not guessed and emit blocker", () => {
  const settings = createMockSettings();
  const run = {
    id: "run-unmapped",
    identity: { cnpj: "00.015.691/4426-00" },
    files: [],
  };

  const items = [
    {
      id: "item-unknown-point",
      sampleNumber: "C001",
      sampleType: "Efluente",
      pointLabel: "Ponto Misterioso Sem De-Para",
      pointType: "treatment",
      collectionDate: "2026-10-15",
      parameterKey: "dqo",
      parameterName: "DQO",
      resultRaw: "45",
      operator: "=",
      value: 45,
      unit: "mg/L",
      lq: "",
      ld: "",
      sourceFile: "laudo.pdf",
      sourcePage: 1,
      laboratoryConclusion: "meets",
      laboratoryConclusionRaw: "",
    },
  ];

  const batch = complianceItemsToLabBatch(items, run, settings, "2026-10");
  assert.equal(batch.lab[0].pointId, null);
  const unmapped = batch.issues.find((i) => i.code === "point-unmapped");
  assert.ok(unmapped, "Point unmapped issue emitted");
  assert.equal(unmapped.severity, "blocker");
});

test("complianceItemsToLabBatch: collection date defines competence, warns outside period", () => {
  const settings = createMockSettings();
  const run = {
    id: "run-outside",
    identity: { cnpj: "00.015.691/4426-00" },
    files: [],
  };

  const items = [
    {
      id: "item-prev-month",
      sampleNumber: "D001",
      sampleType: "Efluente",
      pointLabel: "Saída do Efluente Tratado",
      pointType: "treatment",
      collectionDate: "2026-08-20", // Competence requested is 2026-10
      parameterKey: "dbo",
      parameterName: "DBO",
      resultRaw: "12",
      operator: "=",
      value: 12,
      unit: "mg/L",
      lq: "",
      ld: "",
      sourceFile: "laudo.pdf",
      sourcePage: 1,
      laboratoryConclusion: "meets",
      laboratoryConclusionRaw: "",
    },
  ];

  const batch = complianceItemsToLabBatch(items, run, settings, "2026-10");
  const outside = batch.issues.find((i) => i.code === "outside-period");
  assert.ok(outside, "Warns when collection date is outside competence period");
  assert.equal(outside.severity, "warning");
});

test("complianceItemsToLabBatch: idempotent deduplication", () => {
  const settings = createMockSettings();
  const run = {
    id: "run-dup",
    identity: { cnpj: "00.015.691/4426-00" },
    files: [],
  };

  const item = {
    id: "item-same",
    sampleNumber: "E001",
    sampleType: "Efluente",
    pointLabel: "Saída do Efluente Tratado",
    pointType: "treatment",
    collectionDate: "2026-10-10",
    parameterKey: "dbo",
    parameterName: "DBO",
    resultRaw: "20",
    operator: "=",
    value: 20,
    unit: "mg/L",
    lq: "",
    ld: "",
    sourceFile: "laudo.pdf",
    sourcePage: 1,
    laboratoryConclusion: "meets",
    laboratoryConclusionRaw: "",
  };

  // Duplicate item in same list
  const batch = complianceItemsToLabBatch([item, item], run, settings, "2026-10");
  assert.equal(batch.lab.length, 1, "Duplicate item in same run was deduplicated");
});
