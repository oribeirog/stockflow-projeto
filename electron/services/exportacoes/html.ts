import type { DocumentoRelatorio, TipoCelula, ValorCelula } from './documento';
export const escaparHtml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function textoCelula(raw: ValorCelula, type: TipoCelula): string {
  const value = raw !== null && typeof raw === 'object' ? raw.valor : raw;
  const kind = raw !== null && typeof raw === 'object' ? raw.tipo : type;
  if (value === null) return 'Não aplicável';
  if (kind === 'moeda' && typeof value === 'number') {
    const s = String(Math.abs(value)).padStart(3, '0');
    return `${value < 0 ? '-' : ''}R$ ${s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${s.slice(-2)}`;
  }
  if (kind === 'percentual' && typeof value === 'number') {
    const s = String(Math.abs(value)).padStart(3, '0');
    return `${value < 0 ? '-' : ''}${s.slice(0, -2)},${s.slice(-2)}%`;
  }
  if (kind === 'data' && typeof value === 'string')
    return value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4);
  return String(value);
}
export function gerarHtml(d: DocumentoRelatorio): string {
  const e = escaparHtml,
    landscape = d.secoes.some((s) => s.colunas.length > 5);
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>${e(d.titulo)} - MNR Perfumes</title><style>
    @page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:18mm 10mm 18mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#18263b;font-size:9pt;margin:0}h1{font-size:21pt;margin:8px 0 12px}h2{font-size:13pt;color:#0961dc;margin:22px 0 8px;break-after:avoid}p{line-height:1.45;margin:5px 0}.brand{color:#0961dc;font-size:13pt;font-weight:bold}.meta{padding:10px 0;border-top:3px solid #0961dc;border-bottom:1px solid #cbd5e1;margin-bottom:12px}.note{color:#465468;font-size:8pt}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:10px 0 16px;font-size:8pt}thead{display:table-header-group}th{background:#e6eefb;color:#172a46;text-align:left;font-weight:bold}td,th{padding:7px 5px;border-bottom:1px solid #cbd5e1;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}tr{break-inside:avoid;page-break-inside:avoid}.number{text-align:right;font-variant-numeric:tabular-nums}.summary td{background:#f1f5fa}.method{break-before:page}li{margin:8px 0;line-height:1.45}</style></head><body><div class="brand">MNR Perfumes</div><h1>${e(d.titulo)}</h1><div class="meta"><p>Referência das posições atuais: <b>${e(d.referencia)}</b></p><p>Gerado em ${e(new Date(d.geradoEm).toLocaleString('pt-BR'))} (${e(d.geradoEm)})</p>${d.criterios.map((c) => `<p>${e(c)}</p>`).join('')}</div>${d.secoes.map((s) => `<section><h2>${e(s.nome)}</h2><p class="note">${e(s.nota)}</p><table class="${s.nome === 'Resumo' ? 'summary' : ''}"><colgroup>${s.colunas.map((c) => `<col style="width:${(c.largura / s.colunas.reduce((n, c) => n + c.largura, 0)) * 100}%">`).join('')}</colgroup><thead><tr>${s.colunas.map((c) => `<th>${e(c.titulo)}</th>`).join('')}</tr></thead><tbody>${s.linhas.map((row) => `<tr>${row.map((v, i) => `<td class="${['moeda', 'inteiro', 'percentual'].includes(s.colunas[i]!.tipo) || (typeof v === 'object' && v !== null) ? 'number' : ''}">${e(textoCelula(v, s.colunas[i]!.tipo))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.colunas.length}">Nenhum registro para os critérios selecionados.</td></tr>`}</tbody></table></section>`).join('')}<section class="method"><h2>Metodologia</h2><ul>${d.notas.map((n) => `<li>${e(n)}</li>`).join('')}</ul></section></body></html>`;
}
