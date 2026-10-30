import type { ReportDocument, ReportSection, ReportTable, ReportChart } from './types.ts';
import { renderReportChartV2 } from './chart-renderer.ts';

export async function exportReportDocxV4(content: ReportDocument): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    Header,
    Footer,
    PageNumber,
    PageOrientation,
    WidthType,
    HeadingLevel,
    ImageRun,
    AlignmentType,
    SectionType,
    BorderStyle
  } = await import('docx');

  const run = (text: string, bold = false, size = 20, color = '24372B') =>
    new TextRun({ text, font: 'Arial', size, bold, color });

  const paragraph = (text: string, spacingAfter = 140) =>
    new Paragraph({
      children: [run(text, false, 20)],
      spacing: { after: spacingAfter, line: 280 },
      widowControl: true
    });

  const heading1 = (text: string) =>
    new Paragraph({
      children: [run(text, true, 28, '214632')],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 140 },
      keepNext: true
    });

  const heading2 = (text: string) =>
    new Paragraph({
      children: [run(text, true, 22, '214632')],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
      keepNext: true
    });

  const header = new Header({
    children: [
      new Paragraph({
        children: [
          run(
            `OURO FINO TECNOLOGIAS AMBIENTAIS  |  ${content.identity.clientDisplayName} · ${content.period.split('-').reverse().join('/')}`,
            true,
            15,
            '214632'
          )
        ],
        spacing: { after: 100 }
      })
    ]
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          run(`Relatório Técnico de Acompanhamento · Revisão ${content.revision} · Página `, false, 15, '52665B'),
          new TextRun({ children: [PageNumber.CURRENT], size: 15, color: '52665B' }),
          run(' de ', false, 15, '52665B'),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: '52665B' })
        ]
      })
    ]
  });

  const table = (columns: string[], rows: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [columns, ...rows].map((row, i) =>
        new TableRow({
          tableHeader: i === 0,
          cantSplit: true,
          children: row.map((text, colIdx) => {
            const isHeader = i === 0;
            const isZebra = i > 0 && i % 2 === 0;
            const isSituation = !isHeader && columns[colIdx] === 'Situação';
            const textColor = isHeader
              ? 'FFFFFF'
              : isSituation && text === 'Não conforme'
                ? 'C0392B'
                : isSituation && text === 'Conforme'
                  ? '214632'
                  : '24372B';
            const bold = isHeader || (isSituation && text !== 'Não avaliado');

            return new TableCell({
              shading: { fill: isHeader ? '214632' : isZebra ? 'F3F6F4' : 'FFFFFF' },
              margins: { top: 90, bottom: 90, left: 100, right: 100 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'D9E3DD' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9E3DD' },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE }
              },
              children: [
                new Paragraph({
                  children: [run(text || '—', bold, isHeader ? 17 : 18, textColor)],
                  widowControl: true,
                  spacing: { after: 0 }
                })
              ]
            });
          })
        })
      )
    });

  const periodFormatted = content.period.split('-').reverse().join('/');
  const issueFormatted = content.identity.issueDate ? content.identity.issueDate.split('-').reverse().join('/') : 'A definir';

  const coverElements = [
    new Paragraph({
      children: [run('OURO FINO TECNOLOGIAS AMBIENTAIS', true, 18, '52665B')],
      spacing: { before: 100, after: 80 }
    }),
    new Paragraph({
      children: [run('RELATÓRIO TÉCNICO DE ACOMPANHAMENTO', true, 32, '214632')],
      spacing: { after: 140 },
      keepNext: true
    }),
    heading1(content.identity.clientDisplayName),
    paragraph(`${content.identity.facilityName || 'Unidade'} · ${content.stationId.toUpperCase()} · ${periodFormatted}`),
    new Paragraph({
      children: [
        run(`Data de emissão: ${issueFormatted} · Revisão ${content.revision} · `, false, 18, '52665B'),
        run(
          content.mode === 'draft' ? 'RASCUNHO — aguardando revisão técnica' : 'Relatório técnico aprovado',
          true,
          18,
          content.mode === 'draft' ? 'A54E47' : '214632'
        )
      ],
      spacing: { after: 300 }
    })
  ];

  const sections = content.sections.map((s, index) => {
    const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
      ...(index === 0 ? coverElements : []),
      heading1(s.title),
      ...s.paragraphs.flatMap(p => p.split('\n\n').map(text => paragraph(text)))
    ];

    for (const t of s.tables) {
      children.push(heading2(t.title), table(t.columns, t.rows));
      if (!t.rows.length) {
        children.push(paragraph('Sem resultados disponíveis para exibição.'));
      }
    }

    for (const c of s.charts) {
      const width = s.orientation === 'landscape' ? 930 : 650;
      const png = renderReportChartV2(c);
      if (png && png.startsWith('data:image/png;base64,')) {
        try {
          const base64Data = png.split(',')[1];
          const bytes = Uint8Array.from(atob(base64Data), x => x.charCodeAt(0));
          children.push(
            heading2(c.title),
            new Paragraph({
              children: [
                new ImageRun({
                  type: 'png',
                  data: bytes,
                  transformation: { width, height: Math.round((width * 900) / 2100) }
                })
              ],
              spacing: { before: 100, after: 160 }
            })
          );
        } catch {
          children.push(heading2(c.title), paragraph(`Gráfico de ${c.title} disponível na versão eletrônica.`));
        }
      }
    }

    return {
      properties: {
        type: index > 0 && content.sections[index - 1].orientation === s.orientation
          ? SectionType.CONTINUOUS
          : SectionType.NEXT_PAGE,
        page: {
          size: {
            width: 11906,
            height: 16838,
            orientation: s.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT
          },
          margin: { top: 1020, bottom: 1020, left: 1020, right: 1020, header: 400, footer: 400 }
        }
      },
      headers: { default: header },
      footers: { default: footer },
      children
    };
  });

  return Packer.toBlob(
    new Document({
      creator: 'Ouro Fino Tecnologias Ambientais',
      title: `Relatório Técnico ${content.identity.clientDisplayName} — ${periodFormatted}`,
      features: { updateFields: true },
      sections
    })
  );
}
