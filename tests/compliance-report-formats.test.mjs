import assert from "node:assert/strict";
import test from "node:test";
import {
  formatIndividualEmailReport,
  formatIndividualWhatsAppReport,
  formatMonthlyEmailReport,
  formatMonthlyWhatsAppReport,
} from "../lib/compliance-report-formats.ts";

const identity = {
  clientName: "Cerâmica Demo30 LTDA - Ouro Fino",
  cnpj: "00.057.488/9108-00",
  responsibleInstitution: "Cerâmica Demo30",
  facilityName: "Unidadeficticia",
  sisaguaCode: "C354670000041",
  municipality: "Santa Gertrudes",
  state: "SP",
  sourceType: "groundwater",
  confidence: "high",
};

const individual = {
  identity,
  periodLabel: "Julho/2026",
  report: {
    title: "Relatório de conformidade",
    text: "texto legado sem cliente",
    sections: [{
      id: "chlorine",
      marker: "red",
      heading: "Unidadeficticia – Saída do tratamento",
      parameterKey: "free_residual_chlorine",
      pointLabel: "Saída do Tratamento",
      parameterName: "Cloro Residual Livre",
      result: "< 0,15 mg/L",
      standardLabel: "Padrão mínimo",
      standardValue: "0,2 mg/L",
      situation: "NÃO ATENDE — o resultado encontra-se abaixo do padrão mínimo estabelecido para o parâmetro Cloro Residual Livre.",
      classification: "non_compliant",
      sampleNumber: "1-1/2026.0",
      sourceFile: "laudo.pdf",
    }],
  },
};

const monthly = {
  monthId: "2026-07",
  monthLabel: "Julho de 2026",
  status: "draft",
  summary: { analysesReviewed: 1, affectedClients: 1, affectedLocations: 1, nonCompliances: 1 },
  clients: [{
    key: "demo30",
    name: "Cerâmica Demo30",
    cnpj: identity.cnpj,
    locations: [{
      key: "unidadeficticia",
      name: "Unidadeficticia",
      positions: [{
        key: "treatment",
        name: "Saída do tratamento",
        order: 2,
        parameters: [{
          key: "free_residual_chlorine",
          name: "Cloro residual livre",
          occurrences: [{
            id: "occurrence",
            analysisId: "analysis",
            sampleNumber: "1-1/2026.0",
            collectionDate: "10/07/2026",
            result: "< 0,15 mg/L",
            unit: "mg/L",
            ruleDescription: "mínimo de 0,2 mg/L",
            legalReference: "PRC GM/MS nº 5/2017",
            laboratoryDeclaredNonCompliance: true,
            sourceFile: "laudo.pdf",
          }],
        }],
      }],
    }],
  }],
  text: "texto mensal legado",
  sourceAnalysisIds: ["analysis"],
  ruleSetVersions: ["1"],
  versionId: "version",
  generatedByUid: "user",
  generatedByName: "Usuário",
  generatedByEmail: "usuario@example.com",
  generatedAt: "2026-08-06T12:00:00.000Z",
};

test("WhatsApp individual inclui cliente, mas omite CNPJ e unidade na identificação", () => {
  const text = formatIndividualWhatsAppReport(individual);
  const identification = text.split("\n\n")[1];
  assert.match(text, /\*Cliente:\* Cerâmica Demo30 LTDA - Ouro Fino/);
  assert.doesNotMatch(text, /00\.057\.488\/9108-00|CNPJ/);
  assert.doesNotMatch(identification, /Unidadeficticia|Unidade|SAC/);
  assert.match(text, /🔴 \*Ponto de coleta:\* Saída do Tratamento/);
  assert.match(text, /\nCloro Residual Livre\n\*Resultado:\* < 0,15 mg\/L/);
  assert.match(text, /\*Padrão mínimo:\* 0,2 mg\/L/);
  assert.doesNotMatch(text, /Parâmetro analisado/i);
});

test("e-mail individual entrega somente o corpo, sem assunto", () => {
  const text = formatIndividualEmailReport(individual);
  assert.equal(text.startsWith("Prezados,"), true);
  assert.doesNotMatch(text, /^Assunto:/m);
  assert.match(text, /Cliente: Cerâmica Demo30 LTDA - Ouro Fino/);
  assert.match(text, /CNPJ: 00\.057\.488\/9108-00/);
  assert.match(text, /Ponto de coleta: Saída do Tratamento\nCloro Residual Livre/);
});

test("relatório individual inclui orientação preenchida depois da situação", () => {
  const context = {
    ...individual,
    orientationBySectionId: { chlorine: "Aumentar a dosagem de cloro." },
  };
  const whatsapp = formatIndividualWhatsAppReport(context);
  const email = formatIndividualEmailReport(context);

  assert.match(whatsapp, /\*Situação:\*[\s\S]+\*Orientação:\* Aumentar a dosagem de cloro\./);
  assert.match(email, /Situação:[\s\S]+Orientação: Aumentar a dosagem de cloro\./);
});

test("relatório individual omite orientação vazia ou composta por espaços", () => {
  const context = {
    ...individual,
    orientationBySectionId: { chlorine: "   " },
  };
  assert.doesNotMatch(formatIndividualWhatsAppReport(context), /Orientação:/i);
  assert.doesNotMatch(formatIndividualEmailReport(context), /Orientação:/i);
});

test("relatório individual histórico sem os novos campos mantém o formato legado", () => {
  const legacy = structuredClone(individual);
  delete legacy.report.sections[0].pointLabel;
  delete legacy.report.sections[0].parameterName;
  delete legacy.report.sections[0].standardLabel;
  delete legacy.report.sections[0].standardValue;

  const text = formatIndividualWhatsAppReport(legacy);
  assert.match(text, /🔴 \*Unidadeficticia – Saída do tratamento\*/);
  assert.doesNotMatch(text, /undefined/);
});

test("WhatsApp mensal omite CNPJ e preserva os pontos", () => {
  const text = formatMonthlyWhatsAppReport(monthly);
  assert.doesNotMatch(text, /00\.057\.488\/9108-00|CNPJ/);
  assert.match(text, /\*UNIDADEFICTICIA\*[\s\S]*\*Saída do tratamento\*/);
  assert.doesNotMatch(text, /Orientação:/i);
});

test("e-mail mensal inclui assunto, resumo, cliente e CNPJ", () => {
  const text = formatMonthlyEmailReport(monthly);
  assert.match(text, /^Assunto: Relatório mensal de não conformidades – Julho de 2026/);
  assert.match(text, /Foram identificados 1 resultado fora dos padrões legais/);
  assert.match(text, /CERÂMICA DEMO30[\s\S]*CNPJ: 00\.057\.488\/9108-00/);
});
