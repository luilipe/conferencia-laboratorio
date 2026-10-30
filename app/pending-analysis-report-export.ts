import type { jsPDF as JsPdfType } from "jspdf";
import type { PendingAnalysisReport, PendingAnalysisRow } from "../lib/analysis-schedule-types.ts";

const PAGE_WIDTH = 297;
const PAGE_HEIGHT = 210;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLUMNS = [
  { key: "sampleNumber", label: "NÚMERO DA AMOSTRA", width: 37 },
  { key: "client", label: "CLIENTE", width: 79 },
  { key: "collectionDate", label: "DATA DE COLETA", width: 31 },
  { key: "identification", label: "IDENTIFICAÇÃO", width: 91 },
  { key: "situation", label: "SITUAÇÃO", width: 31 },
] as const;

export async function buildPendingAnalysisPdf(report: PendingAnalysisReport): Promise<JsPdfType> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  let y = 0;

  const addHeader = (continuation = false) => {
    pdf.setFillColor(13, 53, 66);
    pdf.rect(0, 0, PAGE_WIDTH, continuation ? 20 : 38, "F");
    pdf.setFillColor(10, 126, 119);
    pdf.rect(0, continuation ? 18 : 35, PAGE_WIDTH, 3, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(continuation ? 11 : 18);
    pdf.text("RELATÓRIO DE ANÁLISES PENDENTES", MARGIN, continuation ? 11 : 17);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(201, 227, 228);
    pdf.setFontSize(9);
    pdf.text(pdfText(report.competenceLabel), PAGE_WIDTH - MARGIN, continuation ? 11 : 17, { align: "right" });
    if (!continuation) {
      pdf.text(`Total de amostras pendentes: ${report.total}`, MARGIN, 27);
      pdf.text(`Gerado em ${formatDateTime(report.generatedAt)} por ${pdfText(report.generatedBy || "Sistema")}`, PAGE_WIDTH - MARGIN, 27, { align: "right" });
    }
    y = continuation ? 27 : 46;
  };

  const drawTableHeader = () => {
    pdf.setFillColor(231, 240, 240);
    pdf.setDrawColor(197, 215, 216);
    pdf.rect(MARGIN, y, CONTENT_WIDTH, 9, "FD");
    let x = MARGIN;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.2);
    pdf.setTextColor(40, 67, 74);
    for (const column of COLUMNS) {
      pdf.text(column.label, x + 2, y + 5.8);
      x += column.width;
    }
    y += 9;
  };

  const addPage = () => {
    pdf.addPage("a4", "landscape");
    addHeader(true);
    drawTableHeader();
  };

  const drawRow = (row: PendingAnalysisRow, index: number) => {
    const lineSets = COLUMNS.map((column) =>
      pdf.splitTextToSize(pdfText(String(row[column.key] || "-")), column.width - 4) as string[],
    );
    const maxLines = Math.max(...lineSets.map((lines) => lines.length), 1);
    const rowHeight = Math.max(9, maxLines * 3.7 + 4);
    if (y + rowHeight > PAGE_HEIGHT - 17) addPage();
    pdf.setFillColor(index % 2 === 0 ? 249 : 255, index % 2 === 0 ? 251 : 255, index % 2 === 0 ? 251 : 255);
    pdf.setDrawColor(226, 233, 234);
    pdf.rect(MARGIN, y, CONTENT_WIDTH, rowHeight, "FD");
    let x = MARGIN;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.4);
    pdf.setTextColor(48, 66, 72);
    lineSets.forEach((lines, columnIndex) => {
      pdf.setFont("helvetica", columnIndex === 0 ? "bold" : "normal");
      pdf.text(lines, x + 2, y + 5.3);
      x += COLUMNS[columnIndex].width;
    });
    y += rowHeight;
  };

  addHeader();
  if (!report.rows.length) {
    pdf.setFillColor(240, 250, 243);
    pdf.setDrawColor(185, 221, 196);
    pdf.roundedRect(MARGIN, y, CONTENT_WIDTH, 24, 2, 2, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(40, 116, 69);
    pdf.text("Nenhuma análise pendente foi localizada nesta competência.", MARGIN + 7, y + 14);
  } else {
    drawTableHeader();
    report.rows.forEach(drawRow);
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(220, 228, 229);
    pdf.line(MARGIN, PAGE_HEIGHT - 11, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 11);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(112, 130, 135);
    pdf.text("Relação consolidada de análises sem laudo publicado", MARGIN, PAGE_HEIGHT - 6);
    pdf.text(`Página ${page} de ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 6, { align: "right" });
  }
  return pdf;
}

export async function downloadPendingAnalysisPdf(report: PendingAnalysisReport): Promise<void> {
  const pdf = await buildPendingAnalysisPdf(report);
  pdf.save(`analises-pendentes-${report.competence}.pdf`);
}

function pdfText(value: string): string {
  return value.replace(/[–—]/g, "-").replace(/[“”]/g, '"').trim();
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}
