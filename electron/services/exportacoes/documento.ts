import type Database from 'better-sqlite3';
import {
  LIMITES_EXPORTACAO,
  MODELOS_RELATORIO,
  type PedidoExportacao,
} from '../../../shared/exportacoes';
import type { PaginaRelatorio } from '../../../shared/relatorios-ipc';
import { createReportService } from '../relatorios';
import { createFinancialQueryService } from '../financeiro-consulta';
import { localDay } from '../financeiro';
import { validarPedido } from './validacao';

export class ExportacaoError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export type TipoCelula = 'texto' | 'inteiro' | 'moeda' | 'data' | 'percentual';
export type ValorCelula =
  | string
  | number
  | null
  | { valor: number | null; tipo: 'moeda' | 'percentual' | 'inteiro' };
export interface SecaoRelatorio {
  nome: string;
  nota: string;
  colunas: { titulo: string; tipo: TipoCelula; largura: number }[];
  linhas: ValorCelula[][];
}
export interface DocumentoRelatorio {
  titulo: string;
  modelo: PedidoExportacao['modelo'];
  geradoEm: string;
  referencia: string;
  criterios: string[];
  notas: string[];
  secoes: SecaoRelatorio[];
  registros: number;
}
export const C = (titulo: string, tipo: TipoCelula = 'texto', largura = 24) => ({
  titulo,
  tipo,
  largura,
});
// Only presentation labels: every financial amount comes from an official DTO.
const labels: Record<string, string> = {
  faturamentoLiquidoCentavos: 'Faturamento comercial líquido (fluxo)',
  vendasConfirmadas: 'Vendas confirmadas (fluxo)',
  resultadoBrutoEstimadoCentavos: 'Resultado bruto comercial estimado (fluxo)',
  margemBrutaPontosBase: 'Margem bruta estimada (fluxo)',
  ticketMedioCentavos: 'Ticket médio da coorte',
  comercialLiquidoAtualCentavos: 'Comercial líquido atual da coorte',
  recebimentosBrutosCentavos: 'Recebimentos brutos',
  estornosRecebimentosCentavos: 'Estornos de recebimentos',
  recebidoLiquidoCentavos: 'Recebimentos líquidos',
  pagamentosReembolsoCentavos: 'Pagamentos de reembolso',
  estornosReembolsoCentavos: 'Estornos de pagamentos de reembolso',
  reembolsoPagoLiquidoCentavos: 'Reembolso pago líquido',
  exigivelCentavos: 'Saldo exigível atual',
  vencidoCentavos: 'Saldo atualmente vencido',
  aVencerCentavos: 'Saldo atual a vencer',
  originalCentavos: 'Valor original histórico',
  custoHistoricoLiquidoAtualCentavos: 'Custo histórico líquido atual',
  pendenteCentavos: 'Reembolso pendente atual',
  valorOriginalAtivoCentavos: 'Obrigações originais ativas',
  pagoLiquidoAtivoCentavos: 'Reembolsos pagos líquidos ativos',
  valorCentavos: 'Valor atual do estoque',
  unidades: 'Unidades disponíveis atuais',
  semEstoque: 'Produtos sem estoque',
  abaixoMinimo: 'Produtos abaixo do mínimo',
  comercialLiquidoCentavos: 'Comercial líquido do fluxo',
  unidadesLiquidas: 'Unidades líquidas do fluxo',
  parcelasAbertas: 'Parcelas abertas',
  parcelasVencidas: 'Parcelas vencidas',
  parcelasQuitadas: 'Parcelas quitadas',
  obrigacoesAtivas: 'Obrigações ativas',
  obrigacoesPendentes: 'Obrigações pendentes',
  obrigacoesQuitadas: 'Obrigações quitadas',
  produtos: 'Produtos',
  clientes: 'Clientes',
  vendas: 'Vendas',
};
const notes = [
  'Fluxo comercial usa a data comercial. Fluxo financeiro usa a data efetiva. Faturamento não é caixa.',
  'Coorte: vendas selecionadas pela data original, com líquido atual incluindo correções posteriores ao período.',
  'Posições são atuais e consideram todo o histórico. Não representam saldo no último dia do período.',
  'Resultado bruto comercial estimado não é lucro líquido. Impostos e despesas operacionais não estão completos.',
  'As informações deste arquivo representam a mesma visão consistente dos dados. Todos os registros filtrados foram incluídos, com totais oficiais.',
  'Datas comerciais são preservadas sem conversão para UTC. Datas anteriores a 01/03/1900 permanecem como texto ISO no Excel, evitando ambiguidades do calendário inicial desse formato.',
];
export function coletarDocumento(
  db: Database.Database,
  raw: unknown,
  clock = () => new Date(),
  afterPage?: () => void,
): DocumentoRelatorio {
  const pedido = validarPedido(raw),
    now = clock(),
    started = performance.now();
  const s = createReportService(db, () => now);
  const secoes: SecaoRelatorio[] = [];
  let registros = 0;
  const check = () => {
    if (performance.now() - started > LIMITES_EXPORTACAO.coletaMs)
      throw new ExportacaoError('EXPORT_LIMIT');
  };
  const section = (
    nome: string,
    nota: string,
    colunas: SecaoRelatorio['colunas'],
    linhas: ValorCelula[][],
  ) => secoes.push({ nome, nota, colunas, linhas });
  const totals = (nome: string, value: object) => {
    let summary = secoes.find((s) => s.nome === 'Resumo');
    if (!summary) {
      summary = {
        nome: 'Resumo',
        nota: 'Totais oficiais do conjunto filtrado completo. A natureza de cada grupo está indicada no nome.',
        colunas: [C('Indicador', 'texto', 68), C('Valor', 'texto', 30)],
        linhas: [],
      };
      secoes.unshift(summary);
    }
    for (const [k, v] of Object.entries(value)) {
      const tipo = k.endsWith('Centavos')
        ? 'moeda'
        : k.endsWith('PontosBase')
          ? 'percentual'
          : 'inteiro';
      summary.linhas.push([
        `${nome} · ${labels[k] ?? k.replace(/([A-Z])/g, ' $1')}`,
        { valor: v as number | null, tipo },
      ]);
    }
  };
  const pages = <T, S>(
    query: (p: { limite: number; deslocamento: number }) => PaginaRelatorio<T, S>,
  ) => {
    const itens: T[] = [];
    let totais!: S;
    let first = true;
    for (let offset = 0; ; offset += 200) {
      check();
      const p = query({ limite: 200, deslocamento: offset });
      if (first) {
        totais = p.totais;
        first = false;
      } else if (JSON.stringify(totais) !== JSON.stringify(p.totais))
        throw new ExportacaoError('EXPORT_INTEGRITY');
      itens.push(...p.itens);
      registros += p.itens.length;
      if (registros > LIMITES_EXPORTACAO.linhas) throw new ExportacaoError('EXPORT_LIMIT');
      afterPage?.();
      if (!p.temMais) break;
      if (p.itens.length !== 200) throw new ExportacaoError('EXPORT_INTEGRITY');
    }
    return { itens, totais };
  };
  db.transaction(() => {
    // Pin the WAL snapshot before any nested official endpoint/savepoint.
    db.prepare('SELECT count(*) FROM sqlite_schema').get();
    switch (pedido.modelo) {
      case 'GERENCIAL': {
        const r = s.obterResumoGerencial(pedido.filtros),
          e = s.listarSaldos({ limite: 1 });
        totals('Comercial', {
          faturamentoLiquidoCentavos: r.fluxoComercial.faturamentoLiquidoCentavos,
          vendasConfirmadas: r.fluxoComercial.vendasConfirmadas,
          resultadoBrutoEstimadoCentavos: r.fluxoComercial.resultadoBrutoEstimadoCentavos,
          margemBrutaPontosBase: r.fluxoComercial.margemBrutaPontosBase,
        });
        totals('Coorte', {
          ticketMedioCentavos: r.coorteVendas.ticketMedioCentavos,
        });
        totals('Financeiro', {
          recebidoLiquidoCentavos: r.fluxoFinanceiro.recebidoLiquidoCentavos,
        });
        totals('Contas atuais', {
          exigivelCentavos: r.posicaoAtual.contas.exigivelCentavos,
          vencidoCentavos: r.posicaoAtual.contas.vencidoCentavos,
        });
        totals('Reembolsos atuais', {
          pendenteCentavos: r.posicaoAtual.reembolsos.pendenteCentavos,
        });
        totals('Estoque atual', {
          valorCentavos: e.totais.valorCentavos,
          unidades: e.totais.unidades,
          semEstoque: e.totais.semEstoque,
          abaixoMinimo: e.totais.abaixoMinimo,
        });
        break;
      }
      case 'VENDAS': {
        const r = pages((p) => s.listarVendas({ ...pedido.filtros, ...p }));
        section(
          'Vendas',
          'Vendas selecionadas pela data original, com valores líquidos atuais. Correções posteriores ao período são consideradas, sem detalhamento individual neste modelo.',
          [
            C('Venda'),
            C('Data comercial', 'data'),
            C('Cliente histórico', 'texto', 36),
            C('Situação'),
            C('Original (R$)', 'moeda'),
            C('Líquido atual (R$)', 'moeda'),
            C('Custo histórico líquido (R$)', 'moeda'),
          ],
          r.itens.map((v) => [
            v.numero,
            v.dataComercial,
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.estado,
            v.originalCentavos,
            v.comercialLiquidoAtualCentavos,
            v.custoHistoricoLiquidoAtualCentavos,
          ]),
        );
        totals('Totais da coorte', r.totais);
        break;
      }
      case 'MOVIMENTOS': {
        const r = pages((p) => s.listarMovimentos({ ...pedido.filtros, ...p }));
        section(
          'Movimentos',
          'Somente movimentos de clientes vinculados a vendas; alocações e parcelas técnicas não somam dinheiro adicional.',
          [
            C('ID', 'inteiro', 12),
            C('Data efetiva', 'data', 18),
            C('Venda'),
            C('Cliente histórico', 'texto', 30),
            C('Natureza'),
            C('Forma histórica'),
            C('Valor (R$)', 'moeda'),
            C('Estorna movimento', 'inteiro', 16),
          ],
          r.itens.map((v) => [
            v.id,
            v.dataEfetiva,
            v.vendaNumero,
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.natureza,
            v.formaHistorica,
            v.valorCentavos,
            v.estornaMovimentoId,
          ]),
        );
        totals('Totais financeiros', r.totais);
        break;
      }
      case 'CONTAS': {
        const r = pages((p) => s.listarContasReceber({ ...pedido.filtros, ...p }));
        section(
          'Contas a receber',
          'Posição atual. Vencimentos de hoje são a vencer. Abatimentos são comerciais, não dinheiro recebido.',
          [
            C('Cliente histórico', 'texto', 32),
            C('Venda'),
            C('Parcela ID', 'inteiro', 14),
            C('Tipo'),
            C('Vencimento', 'data', 18),
            C('Original (R$)', 'moeda'),
            C('Recebido líquido (R$)', 'moeda'),
            C('Abatido líquido (R$)', 'moeda'),
            C('Saldo atual (R$)', 'moeda'),
            C('Situação'),
          ],
          r.itens.map((v) => [
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.vendaNumero,
            v.id,
            v.tipo,
            v.vencimento,
            v.originalCentavos,
            v.recebimentosLiquidosCentavos,
            v.abatimentosLiquidosCentavos,
            v.saldoCentavos,
            v.status,
          ]),
        );
        totals('Totais atuais', r.totais);
        break;
      }
      case 'REEMBOLSOS': {
        const r = pages((p) => s.listarReembolsos({ ...pedido.filtros, ...p }));
        const q = createFinancialQueryService(db, () => now);
        const rows = r.itens.map((v) => {
          check();
          const d = q.obterReembolso({ vendaId: v.vendaId, reembolsoId: v.id });
          if (
            d.pagoLiquidoCentavos !== v.pagoLiquidoCentavos ||
            d.saldoExigivelCentavos !== v.pendenteCentavos
          )
            throw new ExportacaoError('EXPORT_INTEGRITY');
          return [
            v.id,
            v.vendaId,
            v.correcaoId,
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.ativa ? (v.pendenteCentavos ? 'PENDENTE' : 'PAGA') : 'ANULADA',
            v.originalCentavos,
            d.pagosCentavos,
            d.estornosCentavos,
            v.pagoLiquidoCentavos,
            v.pendenteCentavos,
          ];
        });
        section(
          'Reembolsos',
          'Posição atual. Obrigações anuladas preservam o histórico e têm pendente zero. Brutos e estornos vêm da consulta financeira oficial.',
          [
            C('Obrigação ID', 'inteiro', 15),
            C('Venda ID', 'inteiro', 14),
            C('Correção ID', 'inteiro', 14),
            C('Cliente histórico', 'texto', 32),
            C('Situação'),
            C('Original (R$)', 'moeda'),
            C('Pagamentos (R$)', 'moeda'),
            C('Estornos (R$)', 'moeda'),
            C('Pago líquido (R$)', 'moeda'),
            C('Pendente (R$)', 'moeda'),
          ],
          rows,
        );
        totals('Totais de obrigações ativas', r.totais);
        break;
      }
      case 'ESTOQUE': {
        const r = pages((p) => s.listarSaldos({ ...pedido.filtros, ...p }));
        section(
          'Estoque',
          'Posição atual com valor total oficial do estoque. Custo médio unitário e movimentos não são apresentados. Não representa estoque histórico.',
          [
            C('Produto ID', 'inteiro', 14),
            C('SKU'),
            C('Nome atual', 'texto', 42),
            C('Cadastro'),
            C('Disponível', 'inteiro', 16),
            C('Valor atual (R$)', 'moeda'),
            C('Mínimo', 'inteiro', 14),
            C('Sem estoque'),
            C('Abaixo do mínimo'),
          ],
          r.itens.map((v) => [
            v.produtoId,
            v.skuAtual,
            v.nomeAtual,
            v.ativo ? 'Ativo' : 'Inativo',
            v.quantidade,
            v.valorCentavos,
            v.estoqueMinimo,
            v.quantidade === 0 ? 'Sim' : 'Não',
            v.quantidade < v.estoqueMinimo ? 'Sim' : 'Não',
          ]),
        );
        totals('Totais de estoque', r.totais);
        break;
      }
      case 'DESEMPENHO': {
        const p = pages((p) =>
          s.listarProdutos({ ...pedido.filtros, ...p, ordem: 'UNIDADES_DESC' }),
        );
        const c = pages((p) => s.listarClientes({ ...pedido.filtros, ...p }));
        section(
          'Produtos',
          'Fluxo por unidades líquidas decrescentes, ID como desempate. Identificação histórica.',
          [
            C('Posição', 'inteiro', 12),
            C('Produto ID', 'inteiro', 14),
            C('SKU histórico'),
            C('Nome histórico', 'texto', 42),
            C('Unidades líquidas', 'inteiro', 20),
            C('Líquido do fluxo (R$)', 'moeda'),
          ],
          p.itens.map((v, i) => [
            i + 1,
            v.produtoId,
            v.skuHistorico,
            v.nomeHistorico,
            v.unidadesLiquidas,
            v.comercialLiquidoCentavos,
          ]),
        );
        section(
          'Clientes',
          'Coorte por valor líquido atual decrescente, ID como desempate. Não representa recebimentos. Exclui vendas anônimas.',
          [
            C('Posição', 'inteiro', 12),
            C('Cliente ID', 'inteiro', 14),
            C('Nome histórico', 'texto', 42),
            C('Vendas', 'inteiro', 14),
            C('Líquido atual (R$)', 'moeda'),
          ],
          c.itens.map((v, i) => [
            i + 1,
            v.clienteId,
            v.nomeHistorico,
            v.vendas,
            v.comercialLiquidoAtualCentavos,
          ]),
        );
        totals('Totais de produtos', p.totais);
        totals('Totais de clientes', c.totais);
        break;
      }
    }
    check();
  })();
  const filterLabels: Record<string, string> = {
    dataInicio: 'Período de',
    dataFim: 'Período até',
    clienteId: 'Cliente ID',
    produtoId: 'Produto ID',
    formaPagamentoId: 'Forma de pagamento ID',
    vendaId: 'Venda ID',
    situacao: 'Situação',
    ativo: 'Cadastro ativo',
    ordem: 'Ordenação',
    natureza: 'Natureza',
    vencimentoDe: 'Vencimento de',
    vencimentoAte: 'Vencimento até',
  };
  const criterios = Object.entries(pedido.filtros).map(
    ([k, v]) =>
      `${filterLabels[k]}: ${typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v).replaceAll('_', ' ')}`,
  );
  if (pedido.modelo === 'GERENCIAL')
    criterios.push(
      'Estoque global, inclusive produtos inativos; filtro de cliente aplica-se somente ao comercial e Financeiro.',
    );
  const d: DocumentoRelatorio = {
    titulo: MODELOS_RELATORIO.find((m) => m.id === pedido.modelo)!.nome,
    modelo: pedido.modelo,
    geradoEm: now.toISOString(),
    referencia: localDay(now),
    criterios: criterios.length ? criterios : ['Todos os registros permitidos pelo modelo.'],
    notas: notes,
    secoes,
    registros,
  };
  if (Buffer.byteLength(JSON.stringify(d)) > LIMITES_EXPORTACAO.dadosBytes)
    throw new ExportacaoError('EXPORT_LIMIT');
  return d;
}
