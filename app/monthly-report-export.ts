import type { jsPDF as JsPdfType } from "jspdf";
import type { MonthlyExecutiveReport } from "@/lib/compliance-types";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 16;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export async function buildMonthlyPdf(report: MonthlyExecutiveReport): Promise<JsPdfType> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let y = 0;

  const addPage = () => {
    pdf.addPage();
    pdf.setFillColor(12, 52, 65);
    pdf.rect(0, 0, PAGE_WIDTH, 15, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    pdf.text("RELATÓRIO MENSAL DE NÃO CONFORMIDADES", MARGIN, 9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(201, 227, 228);
    pdf.text(pdfText(report.monthLabel), PAGE_WIDTH - MARGIN, 9, { align: "right" });
    y = 24;
  };
  const ensureSpace = (height: number) => {
    if (y + height > PAGE_HEIGHT - 18) addPage();
  };
  const wrapped = (text: string, width: number) =>
    pdf.splitTextToSize(pdfText(text), width) as string[];
  const write = (
    text: string,
    x: number,
    width: number,
    options: { size?: number; color?: [number, number, number]; bold?: boolean; lineHeight?: number } = {},
  ) => {
    const size = options.size ?? 9;
    const lineHeight = options.lineHeight ?? size * 0.42;
    pdf.setFont("helvetica", options.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(options.color ?? [44, 61, 67]));
    const lines = wrapped(text, width);
    ensureSpace(lines.length * lineHeight + 1);
    pdf.text(lines, x, y);
    y += lines.length * lineHeight;
  };

  pdf.setFillColor(12, 52, 65);
  pdf.rect(0, 0, PAGE_WIDTH, 42, "F");
  pdf.setFillColor(9, 130, 123);
  pdf.rect(0, 39, PAGE_WIDTH, 3, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(17);
  pdf.setTextColor(255, 255, 255);
  pdf.text("RELATÓRIO MENSAL DE NÃO CONFORMIDADES", MARGIN, 18);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(201, 227, 228);
  pdf.text(`Período: ${pdfText(report.monthLabel)}`, MARGIN, 28);
  pdf.text(`Gerado por: ${pdfText(report.generatedByName || "Sistema de Conformidade")}`, MARGIN, 34);
  y = 51;

  const cards = [
    [report.summary.nonCompliances, "Fora do padrão"],
    [report.summary.affectedClients, "Clientes afetados"],
    [report.summary.affectedLocations, "Locais afetados"],
    [report.summary.analysesReviewed, "Análises consideradas"],
  ] as const;
  const cardGap = 3;
  const cardWidth = (CONTENT_WIDTH - cardGap * 3) / 4;
  cards.forEach(([value, label], index) => {
    const x = MARGIN + index * (cardWidth + cardGap);
    pdf.setFillColor(246, 249, 249);
    pdf.setDrawColor(219, 228, 230);
    pdf.roundedRect(x, y, cardWidth, 20, 2, 2, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.setTextColor(16, 55, 68);
    pdf.text(String(value), x + 4, y + 8);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(102, 121, 127);
    pdf.text(pdfText(label), x + 4, y + 14);
  });
  y += 28;

  if (!report.clients.length) {
    pdf.setFillColor(240, 250, 243);
    pdf.setDrawColor(185, 221, 196);
    pdf.roundedRect(MARGIN, y, CONTENT_WIDTH, 24, 2, 2, "FD");
    y += 9;
    write("Nenhum resultado comprovadamente fora do padrão legal foi identificado no período.", MARGIN + 6, CONTENT_WIDTH - 12, { size: 10, color: [40, 116, 69], bold: true });
    y += 8;
  }

  for (const client of report.clients) {
    ensureSpace(24);
    pdf.setFillColor(232, 243, 243);
    pdf.setDrawColor(183, 216, 215);
    pdf.roundedRect(MARGIN, y, CONTENT_WIDTH, client.cnpj ? 17 : 13, 2, 2, "FD");
    y += 6;
    write(client.name.toLocaleUpperCase("pt-BR"), MARGIN + 5, CONTENT_WIDTH - 10, { size: 11, color: [12, 79, 83], bold: true });
    if (client.cnpj) write(`CNPJ: ${formatCnpj(client.cnpj)}`, MARGIN + 5, CONTENT_WIDTH - 10, { size: 7.5, color: [94, 116, 121] });
    y += 9;

    for (const location of client.locations) {
      ensureSpace(18);
      write(location.name.toLocaleUpperCase("pt-BR"), MARGIN + 2, CONTENT_WIDTH - 2, { size: 10, color: [16, 55, 68], bold: true });
      pdf.setDrawColor(209, 221, 223);
      pdf.line(MARGIN + 2, y, PAGE_WIDTH - MARGIN, y);
      y += 5;

      for (const position of location.positions) {
        ensureSpace(15);
        write(position.name, MARGIN + 5, CONTENT_WIDTH - 5, { size: 9, color: [56, 75, 82], bold: true });
        y += 2;
        for (const parameter of position.parameters) {
          ensureSpace(32);
          const parameterY = y;
          pdf.setFillColor(184, 48, 42);
          pdf.circle(MARGIN + 7, parameterY - 1.2, 1.7, "F");
          write(
            `${parameter.name}${parameter.occurrences.length > 1 ? ` - ${parameter.occurrences.length} ocorrências` : ""}`,
            MARGIN + 12,
            CONTENT_WIDTH - 12,
            { size: 9, color: [145, 55, 47], bold: true },
          );
          for (const occurrence of parameter.occurrences) {
            ensureSpace(26);
            pdf.setFillColor(255, 249, 248);
            pdf.setDrawColor(239, 209, 205);
            const detailLines = [
              `Resultado: ${occurrence.result}`,
              `Limite legal: ${occurrence.ruleDescription}`,
              occurrence.sampleNumber ? `Amostra: ${occurrence.sampleNumber}` : "",
              occurrence.collectionDate ? `Data da coleta: ${occurrence.collectionDate}` : "",
              "Situação: Fora do padrão estabelecido pela legislação.",
              occurrence.laboratoryDeclaredNonCompliance ? 'Observação: O próprio laudo declara "NÃO ATENDE".' : "",
            ].filter(Boolean);
            const lineCount = detailLines.reduce((total, line) => total + wrapped(line, CONTENT_WIDTH - 18).length, 0);
            const boxHeight = Math.max(22, lineCount * 3.7 + 6);
            if (y + boxHeight > PAGE_HEIGHT - 18) {
              addPage();
            }
            pdf.roundedRect(MARGIN + 7, y - 3, CONTENT_WIDTH - 7, boxHeight, 1.5, 1.5, "FD");
            y += 2;
            for (const line of detailLines) {
              const [label, ...rest] = line.split(":");
              const value = rest.join(":").trim();
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(7.8);
              pdf.setTextColor(52, 70, 76);
              pdf.text(`${pdfText(label)}:`, MARGIN + 11, y);
              const labelWidth = pdf.getTextWidth(`${pdfText(label)}: `);
              pdf.setFont("helvetica", "normal");
              const valueLines = wrapped(value, CONTENT_WIDTH - 18 - labelWidth);
              pdf.text(valueLines, MARGIN + 11 + labelWidth, y);
              y += Math.max(1, valueLines.length) * 3.6;
            }
            y += 7;
          }
          y += 2;
        }
      }
      y += 3;
    }
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(222, 229, 230);
    pdf.line(MARGIN, PAGE_HEIGHT - 12, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(117, 133, 138);
    pdf.text("Relatório executivo - somente não conformidades legais", MARGIN, PAGE_HEIGHT - 7);
    pdf.text(`Página ${page} de ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 7, { align: "right" });
  }
  return pdf;
}

export async function downloadMonthlyPdf(report: MonthlyExecutiveReport) {
  const pdf = await buildMonthlyPdf(report);
  pdf.save(`relatorio-mensal-nao-conformidades-${report.monthId}.pdf`);
}

function pdfText(value: string): string {
  return value
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/🔴|🟠|🟢/g, "")
    .trim();
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value;
}
