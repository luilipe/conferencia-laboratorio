import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIndividualReportOrientations,
  normalizeGuidanceText,
  resolveIndividualReportOrientations,
} from "../lib/compliance-guidance.ts";

const report = {
  title: "Relatório individual",
  text: "",
  sections: [
    {
      id: "chlorine",
      marker: "red",
      heading: "Saída do tratamento",
      parameterKey: "free_residual_chlorine",
      parameterName: "Cloro residual livre",
      result: "< 0,15 mg/L",
      situation: "Fora do padrão.",
      classification: "non_compliant",
      sampleNumber: "1",
      sourceFile: "laudo.pdf",
    },
    {
      id: "legacy",
      marker: "red",
      heading: "Registro histórico",
      result: "Presença",
      situation: "Fora do padrão.",
      classification: "non_compliant",
      sampleNumber: "2",
      sourceFile: "antigo.pdf",
    },
  ],
};

const catalog = [{
  parameterKey: "free_residual_chlorine",
  parameterName: "Cloro residual livre",
  text: " Aumentar a dosagem de cloro. ",
  active: true,
  updatedByUid: "admin",
  updatedByName: "Admin",
  updatedByEmail: "admin@example.com",
  updatedAt: null,
}];

test("resolve orientação padrão por parameterKey e mantém histórico sem chave vazio", () => {
  assert.deepEqual(resolveIndividualReportOrientations(report, catalog), {
    chlorine: "Aumentar a dosagem de cloro.",
    legacy: "",
  });
});

test("ajuste salvo vazio prevalece sobre orientação do catálogo", () => {
  const settings = {
    orientations: [{ sectionId: "chlorine", parameterKey: "free_residual_chlorine", text: "" }],
    savedByUid: "user",
    savedByName: "User",
    savedByEmail: "user@example.com",
    savedAt: null,
  };
  assert.equal(resolveIndividualReportOrientations(report, catalog, settings).chlorine, "");
});

test("gera retrato para todas as seções e normaliza os textos", () => {
  assert.deepEqual(buildIndividualReportOrientations(report, {
    chlorine: "  Repetir a medição.  ",
    legacy: "",
  }), [
    { sectionId: "chlorine", parameterKey: "free_residual_chlorine", text: "Repetir a medição." },
    { sectionId: "legacy", parameterKey: "", text: "" },
  ]);
});

test("limita orientação a 500 caracteres", () => {
  assert.equal(normalizeGuidanceText("a".repeat(550)).length, 500);
});
