import ExcelJS from 'exceljs';
import {
  ExportacaoError,
  type DocumentoRelatorio,
  type TipoCelula,
  type ValorCelula,
} from './documento';
export const MOEDA_EXCEL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
export function numeroExcel(value: number, divisor = 1): number {
  const numeric = value / divisor;
  if (
    !Number.isSafeInteger(value) ||
    Math.abs(value) > 999_999_999_999_999 ||
    Math.round(Number(numeric.toPrecision(15)) * divisor) !== value
  )
    throw new ExportacaoError('EXPORT_PRECISION');
  return numeric;
}
export function celulaExcel(cell: ExcelJS.Cell, raw: ValorCelula, type: TipoCelula) {
  const value = raw !== null && typeof raw === 'object' ? raw.valor : raw;
  const kind = raw !== null && typeof raw === 'object' ? raw.tipo : type;
  if (value === null) {
    cell.value = 'Não aplicável';
    return;
  }
  if (kind === 'moeda' || kind === 'percentual' || kind === 'inteiro') {
    if (typeof value !== 'number') throw new ExportacaoError('EXPORT_INTEGRITY');
    cell.value = numeroExcel(value, kind === 'moeda' ? 100 : kind === 'percentual' ? 10000 : 1);
    cell.numFmt = kind === 'moeda' ? MOEDA_EXCEL : kind === 'percentual' ? '0.00%' : '#,##0';
    cell.alignment = { horizontal: 'right', vertical: 'top', wrapText: true };
  } else if (
    kind === 'data' &&
    typeof value === 'string' &&
    value >= '1900-03-01' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    cell.value = new Date(value + 'T00:00:00Z');
    cell.numFmt = 'dd/mm/yyyy';
  } else {
    // A string value is serialized as shared string, never as a formula/hyperlink.
    const text = String(value);
    if (text.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
      throw new ExportacaoError('EXPORT_LIMIT');
    cell.value = text;
    cell.numFmt = '@';
  }
}
export async function gerarExcel(d: DocumentoRelatorio): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MNR Perfumes';
  workbook.created = new Date(d.geradoEm);
  workbook.title = d.titulo;
  workbook.subject = 'Relatório oficial MNR Perfumes';
  const sections = [
    ...d.secoes,
    {
      nome: 'Metodologia',
      nota: 'Definições utilizadas nesta exportação.',
      colunas: [{ titulo: 'Notas de interpretação', tipo: 'texto' as const, largura: 110 }],
      linhas: d.notas.map((n) => [n]),
    },
  ];
  for (const section of sections) {
    if (
      !section.nome ||
      section.nome.length > 31 ||
      /[\\/*?:[\]]/.test(section.nome) ||
      workbook.getWorksheet(section.nome)
    )
      throw new ExportacaoError('EXPORT_INTEGRITY');
    const sheet = workbook.addWorksheet(section.nome, {
      properties: { defaultRowHeight: 22 },
      pageSetup: {
        paperSize: 9,
        orientation: section.colunas.length > 5 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.columns = section.colunas.map((c) => ({ width: c.largura }));
    const width = section.colunas.length;
    const banner = (text: string, size = 11, bold = false) => {
      const r = sheet.addRow([text]);
      if (width > 1) sheet.mergeCells(r.number, 1, r.number, width);
      r.font = { name: 'Calibri', size, bold, color: { argb: 'FF172A46' } };
      r.alignment = { vertical: 'top', wrapText: true };
      r.height = Math.max(24, Math.ceil(text.length / (width === 1 ? 95 : 100)) * 16);
      return r;
    };
    banner('MNR Perfumes', 20, true);
    banner(d.titulo, 16, true);
    banner(
      `Referência atual: ${d.referencia} | Gerado em: ${new Date(d.geradoEm).toLocaleString('pt-BR')} (${d.geradoEm})`,
    );
    for (const c of d.criterios) banner(c);
    banner(section.nota);
    const header = sheet.addRow(section.colunas.map((c) => c.titulo));
    header.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0961DC' } };
    header.height = 34;
    header.alignment = { wrapText: true, vertical: 'middle' };
    for (const values of section.linhas) {
      const row = sheet.addRow([]);
      row.font = { name: 'Calibri', size: 11 };
      row.alignment = { vertical: 'top', wrapText: true };
      let lines = 1;
      values.forEach((v, i) => {
        celulaExcel(row.getCell(i + 1), v, section.colunas[i]!.tipo);
        const text = String(typeof v === 'object' && v !== null ? v.valor : (v ?? ''));
        lines = Math.max(
          lines,
          ...text.split('\n').map((s) => Math.ceil(s.length / (section.colunas[i]!.largura - 2))),
        );
      });
      if (lines > 24) throw new ExportacaoError('EXPORT_LIMIT');
      row.height = Math.max(24, lines * 16 + 8);
      if (row.number % 2 === 0)
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5FA' } };
      row.eachCell(
        (cell) => (cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE4EF' } } }),
      );
    }
    if (!section.linhas.length) banner('Nenhum registro para os critérios selecionados.');
    sheet.views = [{ state: 'frozen', ySplit: header.number }];
    if (section.linhas.length)
      sheet.autoFilter = {
        from: { row: header.number, column: 1 },
        to: { row: sheet.rowCount, column: width },
      };
    sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
    sheet.headerFooter.oddFooter = '&CMNR Perfumes | Página &P de &N';
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
