import type {ReportDocument} from './types.ts';
import {REPORT_STYLES} from './report-styles.ts';
import {renderReportChartSvg} from './chart-svg.ts';

export type ReportHtmlAssets = {
  logoDataUrl?: string;
  regularFontDataUrl?: string;
  boldFontDataUrl?: string;
  mathFontDataUrl?: string;
};

export const escapeReportHtml = (v: string) =>
  v.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));

function formatMonthYear(p: string): string {
  const [yyyy, mm] = p.split('-');
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const monthIdx = parseInt(mm, 10) - 1;
  if (!isNaN(monthIdx) && months[monthIdx]) {
    return `${months[monthIdx]} de ${yyyy}`;
  }
  return p.split('-').reverse().join('/');
}

function formatTableCell(text: string, tag: 'th' | 'td'): string {
  const e = escapeReportHtml;
  if (tag === 'th') return `<th>${e(text || '—')}</th>`;
  const clean = (text || '').trim();
  if (/^(conforme|atende|100% conforme)$/i.test(clean)) {
    return `<td><span class="badge badge-conforme">${e(clean)}</span></td>`;
  }
  if (/^(n[ãa]o conforme|n[ãa]o atende)$/i.test(clean)) {
    return `<td><span class="badge badge-nao-conforme">${e(clean)}</span></td>`;
  }
  if (/^(n[ãa]o avaliado|sem crit[ée]rio|pendente)$/i.test(clean)) {
    return `<td><span class="badge badge-nao-avaliado">${e(clean)}</span></td>`;
  }
  return `<td>${e(text || '—')}</td>`;
}

export function renderReportHtml(document: ReportDocument, assets: ReportHtmlAssets = {}): string {
  const e = escapeReportHtml, d = document, i = d.identity;
  const font = (data: string | undefined, weight: string) =>
    data && /^data:font\/(?:ttf|woff2);base64,[A-Za-z0-9+/=]+$/.test(data)
      ? `@font-face{font-family:'Report Sans';font-weight:${weight};src:url('${data}');font-display:block}`
      : '';
  const logo = assets.logoDataUrl && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(assets.logoDataUrl)
    ? `<img class="brand" src="${assets.logoDataUrl}" alt="Ouro Fino Tecnologias Ambientais">`
    : `<div class="company-brand">OURO FINO TECNOLOGIAS AMBIENTAIS</div>`;

  const row = (cells: string[], tag: 'th' | 'td') =>
    `<tr>${cells.map(c => formatTableCell(c, tag)).join('')}</tr>`;

  const cssString = (text: string) => JSON.stringify(text.replace(/\s+/g, ' ')).replace(/</g, '\\3c ');
  const pageLabels = `@page{@top-left{content:${cssString(i.clientDisplayName + ' · ' + d.stationId)};font:8pt Arial;color:#52665b}@bottom-left{content:${cssString('Ouro Fino · ' + d.period + ' · revisão ' + d.revision)};font:8pt Arial;color:#52665b}}`;

  const systemUnitLabel = [d.stationId, i.facilityName].filter(Boolean).filter((v, idx, arr) => arr.indexOf(v) === idx).join(' · ');
  const monthYearLabel = formatMonthYear(d.period);

  const sections = d.sections.map(s => `
    <section class="section ${s.id === 'executive-summary' ? 'summary' : ''} ${s.id.startsWith('appendix-') ? 'appendix' : ''} ${s.orientation === 'landscape' ? 'landscape' : ''}" id="s-${e(s.id)}">
      <h2>${e(s.title)}</h2>
      ${s.paragraphs.map(p => `<p>${e(p)}</p>`).join('')}
      ${s.tables.map(t => `
        <p class="table-title">${e(t.title)}</p>
        <div class="table-wrap">
          <table${t.columns.length >= 4 && /par[âa]metro/i.test(t.columns[0]) ? ' class="parameter-table"' : ''}>
            <thead>${row(t.columns, 'th')}</thead>
            <tbody>${t.rows.map(r => row(r, 'td')).join('')}</tbody>
          </table>
          ${!t.rows.length ? '<p class="muted">Sem resultados registrados para esta competência.</p>' : ''}
        </div>
      `).join('')}
      ${s.charts.map(c => `
        <figure>
          <figcaption>${e(c.title)}</figcaption>
          ${renderReportChartSvg(c)}
        </figure>
      `).join('')}
    </section>
  `).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${e(i.clientDisplayName)} — ${e(d.period)}</title>
  <style>
    ${font(assets.regularFontDataUrl, '400')}
    ${font(assets.boldFontDataUrl, '700')}
    ${assets.mathFontDataUrl && /^data:font\/ttf;base64,[A-Za-z0-9+/=]+$/.test(assets.mathFontDataUrl) ? `@font-face{font-family:'Report Math';src:url('${assets.mathFontDataUrl}')}body{font-family:'Report Sans','Report Math',Arial,sans-serif}` : ''}
    ${REPORT_STYLES}
    ${pageLabels}
  </style>
</head>
<body>
  <main>
    <header>
      ${logo}
      <p class="report-subtitle">RELATÓRIO TÉCNICO DE ACOMPANHAMENTO</p>
      <h1 class="report-title">${e(i.clientDisplayName)}</h1>
      <p class="client-system">${e(systemUnitLabel)} · ${e(monthYearLabel)}</p>
      <div class="meta">
        <span>Competência: ${e(d.period.split('-').reverse().join('/'))}</span>
        <span>Emissão: ${e(i.issueDate?.split('-').reverse().join('/') || 'A definir')}</span>
        <span>Revisão ${d.revision}</span>
      </div>
      ${d.mode === 'draft' ? '<p class="draft">RASCUNHO · aguardando revisão técnica</p>' : '<p class="muted">Finalizado após revisão técnica</p>'}
    </header>
    ${sections}
    <footer class="footer">
      Ouro Fino Tecnologias Ambientais · ${e(i.clientDisplayName)} · ${e(d.period)} · revisão ${d.revision}<br>
      ${e(i.responsibleName ?? '')} ${e(i.responsibleRegistration ?? '')}
    </footer>
  </main>
</body>
</html>`;
}
