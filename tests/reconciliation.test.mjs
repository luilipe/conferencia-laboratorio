import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeText,
  reconcileSamples,
  sampleBaseKey,
  sampleKey,
} from "../lib/reconciliation.ts";

const metadata = {
  measurementNumber: "FAT1362-2026",
  sentDate: "",
  orderDate: "",
  contractor: "",
  pages: 2,
  reportedTotal: 460,
  extractedTotal: 460,
};

function collection(sampleNumber, overrides = {}) {
  return {
    sampleNumber,
    code: "",
    proposal: "",
    identification: "Ponto Norte",
    sampleType: "Água tratada",
    company: "Empresa de Saneamento",
    collectionDate: "01/07/2026",
    sampleStatus: "Concluída",
    analyses: ["Cloro residual"],
    sourceFiles: ["lote-1.xlsx"],
    sourceRows: 1,
    ...overrides,
  };
}

function billing(sampleNumber, overrides = {}) {
  return {
    sampleNumber,
    account: "Empresa de Saneamento",
    identification: "Ponto Norte",
    sampleType: "Água tratada",
    price: 100,
    page: 1,
    ...overrides,
  };
}

test("normaliza chaves, acentos e ignora a revisão final", () => {
  assert.equal(normalizeText("  Água—Tratada  "), "agua tratada");
  assert.equal(sampleKey(" 10351-1/2026.0 "), "10351-1/2026");
  assert.equal(sampleKey("9870-1/2026.4"), "9870-1/2026");
  assert.equal(sampleBaseKey("10351-1/2026.4"), "10351-1/2026");
  assert.notEqual(sampleKey("10351-1/2026.0"), sampleKey("10351-2/2026.1"));
  assert.notEqual(sampleKey("10351-1/2026.0"), sampleKey("10351-1/2025.1"));
});

test("classifica correspondência, ausências e dados divergentes ignorando revisões", () => {
  const result = reconcileSamples(
    [
      billing("100-1/2026.0"),
      billing("101-1/2026.1"),
      billing("102-1/2026.0"),
      billing("103-1/2026.0", { identification: "Ponto Sul" }),
    ],
    [
      collection("100-1/2026.0"),
      collection("101-1/2026.0"),
      collection("103-1/2026.0"),
      collection("104-1/2026.0"),
    ],
    metadata,
  );

  assert.equal(result.summary.matchedOk, 2);
  assert.equal(result.summary.revisionMismatches, 0);
  assert.equal(result.summary.billingWithoutCollection, 1);
  assert.equal(result.summary.collectionWithoutBilling, 1);
  assert.equal(result.summary.dataMismatches, 1);
  assert.equal(result.summary.divergentItems, 3);
  assert.equal(result.summary.pendingReviews, 3);
  assert.equal(result.summary.valueUnderReview, 200);
  assert.equal(result.items[1].classification, "ok");
  assert.equal(result.items[1].pdfSampleNumber, "101-1/2026.1");
  assert.equal(result.items[1].excelSampleNumber, "101-1/2026.0");
  assert.match(result.items[1].note, /versão final após o ponto foi ignorada/i);
});

test("marca todas as ocorrências repetidas no PDF como duplicadas", () => {
  const result = reconcileSamples(
    [billing("200-1/2026.2"), billing("200-1/2026.4")],
    [collection("200-1/2026.0")],
    metadata,
  );
  assert.equal(result.summary.duplicateBilling, 2);
  assert.equal(result.items[0].classification, "duplicate_billing");
  assert.equal(result.items[1].classification, "duplicate_billing");
});
