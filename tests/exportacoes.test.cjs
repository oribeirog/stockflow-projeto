const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const { fixture } = require('./helpers/estoque-fixture.cjs');
const { cycle, command, day, clock } = require('./helpers/consolidacao-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { createReportService } = require('../dist/electron/services/relatorios');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { coletarDocumento } = require('../dist/electron/services/exportacoes/documento');
const { gerarExcel, numeroExcel } = require('../dist/electron/services/exportacoes/xlsx');
const { gerarHtml } = require('../dist/electron/services/exportacoes/html');
const {
  salvarArquivo,
  mensagemExportacao,
} = require('../dist/electron/services/exportacoes/arquivos');
const { validarPedido } = require('../dist/electron/services/exportacoes/validacao');
const { MODELOS_RELATORIO } = require('../dist/shared/exportacoes');
const range = { dataInicio: '2026-11-01', dataFim: '2026-11-30' };
const filtros = (m) => (['CONTAS', 'REEMBOLSOS', 'ESTOQUE'].includes(m) ? {} : range);
async function workbook(documento) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await gerarExcel(documento));
  return wb;
}
function values(wb) {
  const result = [];
  for (const s of wb.worksheets) s.eachRow((r) => r.eachCell((c) => result.push(c.value)));
  return result;
}
test('4F3 every closed model exports a valid styled XLSX, dates, official totals and no database writes', async (t) => {
  const { db } = await fixture(t),
    s = cycle(db);
  s.buy(30, 100);
  s.sell();
  const before = snapshot(db);
  db.pragma('query_only=ON');
  for (const { id } of MODELOS_RELATORIO) {
    const d = coletarDocumento(db, { modelo: id, filtros: filtros(id) }, clock),
      wb = await workbook(d);
    assert.equal(wb.creator, 'MNR Perfumes');
    assert.equal(wb.worksheets[0].name, 'Resumo');
    assert(wb.getWorksheet('Metodologia'));
    assert(wb.worksheets.length <= 4);
    for (const sheet of wb.worksheets) {
      assert.equal(sheet.views[0].state, 'frozen');
      assert(sheet.pageSetup.printTitlesRow);
    }
    const all = values(wb);
    assert(all.includes('MNR Perfumes'));
    assert(all.includes(d.titulo));
    for (const section of d.secoes)
      for (const row of section.linhas)
        for (const [i, v] of row.entries()) {
          if (v && typeof v === 'object')
            assert(
              all.includes(
                v.valor === null
                  ? 'Não aplicável'
                  : v.valor / (v.tipo === 'moeda' ? 100 : v.tipo === 'percentual' ? 10000 : 1),
              ),
            );
          else if (typeof v === 'number')
            assert(all.includes(v / (section.colunas[i].tipo === 'moeda' ? 100 : 1)));
        }
  }
  assert.equal(snapshot(db), before);
});
test('4F3 reference 300/250/200/150 export states match official DTOs including void refunds', async (t) => {
  const { db } = await fixture(t),
    s = cycle(db);
  s.buy(20, 100);
  const sale = s.sell(),
    fin = createFinancialService(db, 'test', clock),
    cor = createCorrectionService(db, 'test', clock);
  fin.registrarRecebimento(
    command({
      vendaId: sale.id,
      dataEfetiva: day,
      pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 15000 }],
    }),
  );
  const check = async (commercial, debt, paid, pending) => {
    const before = snapshot(db),
      official = createReportService(db, clock).obterResumoGerencial(range);
    assert.equal(official.coorteVendas.comercialLiquidoAtualCentavos, commercial);
    assert.equal(official.fluxoFinanceiro.recebidoLiquidoCentavos, 25000);
    assert.equal(official.posicaoAtual.contas.exigivelCentavos, debt);
    assert.equal(official.posicaoAtual.reembolsos.pendenteCentavos, pending);
    for (const modelo of ['GERENCIAL', 'CONTAS', 'REEMBOLSOS', 'MOVIMENTOS', 'VENDAS']) {
      const d = coletarDocumento(db, { modelo, filtros: filtros(modelo) }, clock),
        wb = await workbook(d);
      if (modelo === 'GERENCIAL') {
        const all = values(wb);
        assert(all.includes(commercial / 100));
        assert(all.includes(debt / 100));
        assert(all.includes(pending / 100));
      }
      if (modelo === 'REEMBOLSOS' && d.registros) {
        const row = d.secoes.find((s) => s.nome === 'Reembolsos').linhas[0];
        assert.equal(row[8], paid);
        assert.equal(row[9], pending);
        if (!pending && commercial === 30000) assert.equal(row[4], 'ANULADA');
      }
      assert.match(gerarHtml(d), /MNR Perfumes/);
    }
    assert.equal(snapshot(db), before);
  };
  await check(30000, 5000, 0, 0);
  const returned = cor.devolverVenda(
    command({
      documentoId: sale.id,
      dataEfetiva: '2026-11-02',
      itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
    }),
  );
  const refund = s.q.obterDocumento({ vendaId: sale.id, documentoId: returned.documentoId })
    .reembolsoIds[0];
  await check(10000, 0, 0, 15000);
  const payment = fin.pagarReembolso(
    command({
      reembolsoId: refund,
      dataEfetiva: '2026-11-03',
      pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 10000 }],
    }),
  );
  await check(10000, 0, 10000, 5000);
  fin.estornarReembolso(command({ movimentoId: payment.movimentos[0], dataEfetiva: '2026-11-04' }));
  await check(10000, 0, 0, 15000);
  cor.estornarDevolucao(command({ documentoId: returned.documentoId, dataEfetiva: '2026-11-05' }));
  await check(30000, 5000, 0, 0);
});
test('4F3 single WAL snapshot covers all source pages while a real receipt commits', async (t) => {
  const { db } = await fixture(t),
    s = cycle(db);
  s.buy(1000, 100);
  db.transaction(() => {
    for (let i = 0; i < 205; i++) s.sell('cash');
  })();
  const credit = s.sell('credit'),
    writer = new Database(db.name);
  t.after(() => writer.close());
  writer.pragma('foreign_keys=ON');
  const fin = createFinancialService(writer, 'test', clock);
  let changed = false;
  const d = coletarDocumento(db, { modelo: 'CONTAS', filtros: {} }, clock, () => {
    if (!changed) {
      changed = true;
      fin.registrarRecebimento(
        command({
          vendaId: credit.id,
          dataEfetiva: day,
          pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 10000 }],
        }),
      );
    }
  });
  const rows = d.secoes.find((s) => s.nome === 'Contas a receber').linhas;
  assert(rows.length > 200);
  assert.equal(changed, true);
  assert.equal(
    rows.filter((r) => r[1] === credit.numero).reduce((n, r) => n + r[8], 0),
    30000,
  );
  const total = d.secoes[0].linhas.find((r) => r[0].includes('Saldo exigível atual'))[1].valor;
  assert.equal(total, 30000);
  assert.equal(
    createReportService(db, clock).listarContasReceber({}).totais.exigivelCentavos,
    20000,
  );
  const sales = coletarDocumento(db, { modelo: 'VENDAS', filtros: range }, clock);
  assert.equal(sales.registros, 206);
  const { LIMITES_EXPORTACAO } = require('../dist/shared/exportacoes');
  const max = LIMITES_EXPORTACAO.linhas;
  try {
    LIMITES_EXPORTACAO.linhas = 1;
    assert.throws(
      () => coletarDocumento(db, { modelo: 'VENDAS', filtros: range }, clock),
      /EXPORT_LIMIT/,
    );
  } finally {
    LIMITES_EXPORTACAO.linhas = max;
  }
});
test('4F3 text stays text, no formulas/external links, small/negative cents and precision boundaries', async () => {
  const strings = [
    '=HYPERLINK("file://secret")',
    '+SUM(1,1)',
    '-1+1',
    '@SUM(A1)',
    'Água & <Madeira> "ação" ' + 'Nome longo '.repeat(20),
  ];
  const d = {
    titulo: 'Teste brasileiro',
    modelo: 'VENDAS',
    geradoEm: clock().toISOString(),
    referencia: day,
    criterios: ['Todos'],
    notas: ['Oficial'],
    registros: strings.length,
    secoes: [
      {
        nome: 'Dados',
        nota: 'Teste',
        colunas: [
          { titulo: 'Nome', tipo: 'texto', largura: 46 },
          { titulo: 'Valor', tipo: 'moeda', largura: 26 },
          { titulo: 'Data', tipo: 'data', largura: 20 },
        ],
        linhas: strings.map((s, i) => [
          s,
          [-1, 1, -100, 100, 999999999999999][i],
          ['0000-01-01', '1900-01-01', '1900-02-28', '1900-03-01', '9999-12-31'][i],
        ]),
      },
    ],
  };
  const wb = await workbook(d);
  const all = values(wb);
  for (const date of ['0000-01-01', '1900-01-01', '1900-02-28']) assert(all.includes(date));
  for (const text of strings) assert(all.includes(text));
  for (const row of wb.getWorksheet('Dados').getRows(1, wb.getWorksheet('Dados').rowCount))
    row.eachCell((c) => assert.notEqual(c.type, ExcelJS.ValueType.Formula));
  assert.equal(numeroExcel(1, 100), 0.01);
  assert.equal(numeroExcel(-1, 100), -0.01);
  assert.throws(() => numeroExcel(Number.MAX_SAFE_INTEGER, 100), /EXPORT_PRECISION/);
  const html = gerarHtml(d);
  assert(!html.includes('<Madeira>'));
  assert(html.includes('&lt;Madeira&gt;'));
  assert(!html.includes('<script'));
});
test('4F3 empty files, strict filters, defensive line limit, sanitized failures and exclusive atomic save', async (t) => {
  const { db } = await fixture(t);
  const d = coletarDocumento(db, { modelo: 'VENDAS', filtros: range }, clock);
  assert.equal(d.registros, 0);
  assert(values(await workbook(d)).includes('Nenhum registro para os critérios selecionados.'));
  for (const input of [
    { modelo: 'SQL', filtros: {} },
    { modelo: 'ESTOQUE', filtros: { path: 'C:/private' } },
    { modelo: 'CONTAS', filtros: { sql: 'DROP TABLE' } },
    { modelo: 'VENDAS', filtros: { ...range, limite: 1 } },
    { modelo: 'GERENCIAL', filtros: { dataInicio: '2026-02-29', dataFim: '2026-03-01' } },
    { modelo: 'CONTAS', filtros: { clienteId: -1 } },
    { modelo: 'ESTOQUE', filtros: { ativo: 'true' } },
  ])
    assert.throws(() => validarPedido(input));
  const root = mkdtempSync(resolve('.local-data/test/export-save-')),
    protectedDir = join(root, 'data');
  mkdirSync(protectedDir);
  const bytes = await gerarExcel(d),
    path = join(root, 'Relatório.xlsx');
  await salvarArquivo(path, 'xlsx', bytes, [protectedDir]);
  assert.equal(readFileSync(path).length, bytes.length);
  await assert.rejects(salvarArquivo(path, 'xlsx', bytes, [protectedDir]), { code: 'EEXIST' });
  assert.deepEqual(readFileSync(path), Buffer.from(bytes));
  await assert.rejects(
    salvarArquivo(join(protectedDir, 'x.xlsx'), 'xlsx', bytes, [protectedDir]),
    /EXPORT_DESTINATION/,
  );
  await assert.rejects(salvarArquivo(join(root, 'x.pdf'), 'xlsx', bytes, []), /EXPORT_DESTINATION/);
  assert(!readdirSync(root).some((n) => n.endsWith('.tmp')));
  for (const code of [
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EEXIST',
    'ENOENT',
    'EXPORT_LIMIT',
    'ERR_WORKER_OUT_OF_MEMORY',
  ]) {
    const m = mensagemExportacao({ code, message: 'C:/secret password SQL' });
    assert.equal(m.code, code);
    assert(!m.message.includes('secret'));
  }
});
