import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { record, identifier, text, canonical } from './catalog-validation';
import { ComercialError } from './comercial';
import { somar } from '../domain/comercial';
import { situacaoParcela } from '../domain/correcoes';
import { createCorrectionService } from './correcoes';
import { createFinancialQueryService } from './financeiro-consulta';
import {
  createFinancialService,
  normalizarPagamentoReembolso,
  prepararPagamentoReembolso,
  normalizarEstornoFinanceiro,
  prepararEstornoFinanceiro,
  resumoFinanceiro,
  parcelasFinanceiras,
  validarFormaAtiva,
} from './financeiro';
import type {
  TipoOperacaoFinanceira,
  RevisaoOperacaoFinanceira,
  DadosPagamentoReembolsoPublico,
  DadosEstornoPublico,
  ResultadoOperacaoFinanceira,
} from '../../shared/financeiro-ipc';
import type { DadosEstornoDevolucaoPublico } from '../../shared/correcoes-ipc';
type Dados = DadosPagamentoReembolsoPublico | DadosEstornoPublico | DadosEstornoDevolucaoPublico;
export function createRefundReversalService(
  db: Database.Database,
  version: string,
  clock: () => Date = () => new Date(),
) {
  const financial = createFinancialService(db, version, clock),
    corrections = createCorrectionService(db, version, clock),
    query = createFinancialQueryService(db, clock);
  function normalize(raw: unknown, tipo: TipoOperacaoFinanceira): Dados {
    if (tipo === 'PAGAR_REEMBOLSO') {
      const e = record(raw, ['vendaId', 'reembolsoId', 'dataEfetiva', 'pagamentos']);
      return {
        ...normalizarPagamentoReembolso(
          {
            reembolsoId: e['reembolsoId'],
            dataEfetiva: e['dataEfetiva'],
            pagamentos: e['pagamentos'],
          },
          clock(),
        ),
        vendaId: identifier(e['vendaId']),
      };
    }
    if (tipo === 'ESTORNAR_DEVOLUCAO') {
      const e = record(raw, ['vendaId', 'documentoId', 'dataEfetiva']);
      const n = corrections.normalizarVenda(
        { documentoId: e['documentoId'], dataEfetiva: e['dataEfetiva'] },
        true,
      );
      return {
        vendaId: identifier(e['vendaId']),
        documentoId: n.documentoId,
        dataEfetiva: n.dataEfetiva,
      };
    }
    const e = record(raw, ['vendaId', 'movimentoId', 'dataEfetiva']);
    return {
      ...normalizarEstornoFinanceiro(
        { movimentoId: e['movimentoId'], dataEfetiva: e['dataEfetiva'] },
        clock(),
      ),
      vendaId: identifier(e['vendaId']),
    };
  }
  function target(data: Dados, tipo: TipoOperacaoFinanceira) {
    if (tipo === 'PAGAR_REEMBOLSO')
      query.obterReembolso({
        vendaId: data.vendaId,
        reembolsoId: (data as DadosPagamentoReembolsoPublico).reembolsoId,
      });
    else if (tipo === 'ESTORNAR_DEVOLUCAO') {
      const d = query.obterDocumento({
        vendaId: data.vendaId,
        documentoId: (data as DadosEstornoDevolucaoPublico).documentoId,
      });
      if (d.categoria !== 'DEVOLUCAO_VENDA')
        throw new ComercialError('INVALID_STATE', 'Somente devolução de venda.');
    } else
      query.obterMovimento({
        vendaId: data.vendaId,
        movimentoId: (data as DadosEstornoPublico).movimentoId,
      });
  }
  function fingerprint(data: Dados, motivo: string, tipo: TipoOperacaoFinanceira) {
    const id = data.vendaId,
      read = (sql: string) => db.prepare(sql).all(id);
    return createHash('sha256')
      .update(
        canonical({
          data,
          motivo,
          tipo,
          documentos: db
            .prepare('SELECT * FROM documentos WHERE id=? OR documento_origem_id=? ORDER BY id')
            .all(id, id),
          parcelas: read('SELECT * FROM parcelas_receber WHERE venda_id=? ORDER BY id'),
          movimentos: read('SELECT * FROM movimentos_financeiros WHERE documento_id=? ORDER BY id'),
          alocacoes: read(
            'SELECT a.* FROM alocacoes_recebimento a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id=? ORDER BY a.id',
          ),
          abatimentos: read(
            'SELECT a.* FROM abatimentos_parcela a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id=? ORDER BY a.id',
          ),
          obrigacoes: read(
            'SELECT r.* FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id WHERE d.documento_origem_id=? ORDER BY r.id',
          ),
          origens: read(
            'SELECT o.* FROM origens_reembolso o JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id WHERE d.documento_origem_id=? ORDER BY o.id',
          ),
          pagamentos: read(
            'SELECT a.* FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id WHERE d.documento_origem_id=? ORDER BY a.id',
          ),
          saldos: read(
            'SELECT * FROM saldos_estoque WHERE produto_id IN (SELECT produto_id FROM itens_documento WHERE documento_id=?) ORDER BY produto_id',
          ),
          estoque: read(
            'SELECT id FROM movimentacoes_estoque WHERE produto_id IN (SELECT produto_id FROM itens_documento WHERE documento_id=?) ORDER BY id',
          ),
          formas:
            'pagamentos' in data
              ? data.pagamentos.map((p) =>
                  db
                    .prepare('SELECT id,nome,ativo FROM formas_pagamento WHERE id=?')
                    .get(p.formaPagamentoId),
                )
              : [],
        }),
      )
      .digest('hex');
  }
  function review(input: unknown, tipo: TipoOperacaoFinanceira): RevisaoOperacaoFinanceira {
    const e = record(input, ['motivo', 'dados']),
      motivo = text(e['motivo'], 'motivo', 4000),
      dados = normalize(e['dados'], tipo);
    target(dados, tipo);
    const venda = query.obterVenda(dados.vendaId),
      anterior = resumoFinanceiro(db, dados.vendaId);
    const effects: Parameters<typeof resumoFinanceiro>[2] = {};
    const obrigacoes: RevisaoOperacaoFinanceira['obrigacoes'] = [],
      estoque: RevisaoOperacaoFinanceira['estoque'] = [],
      itens: RevisaoOperacaoFinanceira['itens'] = [],
      formas: RevisaoOperacaoFinanceira['formas'] = [];
    const parcelas = parcelasFinanceiras(db, dados.vendaId, dados.dataEfetiva),
      recebidoDelta = new Map<number, number>(),
      abatidoDelta = new Map<number, number>();
    let valorCentavos = 0;
    function obligation(id: number, delta: number, anular = false) {
      const r = query.obterReembolso({ vendaId: dados.vendaId, reembolsoId: id });
      obrigacoes.push({
        id,
        originalCentavos: r.valorOriginalCentavos,
        pagoAnteriorCentavos: r.pagoLiquidoCentavos,
        pagoPrevistoCentavos: r.pagoLiquidoCentavos + delta,
        saldoAnteriorCentavos: r.saldoExigivelCentavos,
        saldoPrevistoCentavos: anular ? 0 : r.saldoExigivelCentavos - delta,
        ativaPrevista: !anular && r.ativa,
      });
    }
    if (tipo === 'PAGAR_REEMBOLSO') {
      const d = dados as DadosPagamentoReembolsoPublico,
        p = prepararPagamentoReembolso(db, d);
      valorCentavos = p.amount;
      effects.reembolsosPagosCentavos = p.amount;
      obligation(d.reembolsoId, p.amount);
      for (const pay of d.pagamentos)
        formas.push({
          id: pay.formaPagamentoId,
          nome: validarFormaAtiva(db, pay.formaPagamentoId).nome,
          valorCentavos: pay.valorCentavos,
        });
    } else if (tipo === 'ESTORNAR_DEVOLUCAO') {
      const d = dados as DadosEstornoDevolucaoPublico,
        p = corrections.prepararEstornoDevolucao(d),
        doc = query.obterDocumento({ vendaId: d.vendaId, documentoId: d.documentoId });
      valorCentavos = doc.totalCentavos;
      effects.abatimentosDividaCentavos = -doc.totalCentavos;
      for (const b of doc.abatimentos) {
        if (b.natureza === 'ABATIMENTO') abatidoDelta.set(b.parcelaId, -b.valorCentavos);
      }
      for (const id of doc.reembolsoIds) obligation(id, 0, true);
      for (const m of p.movimentos)
        estoque.push({
          id: m.id,
          produtoId: m.produto_id,
          natureza: m.quantidade_delta > 0 ? 'REVERSAO_SAIDA' : 'REVERSAO_ENTRADA',
          quantidadeDelta: -m.quantidade_delta,
          valorDeltaCentavos: -m.valor_delta_centavos,
        });
      for (const i of doc.itens)
        itens.push({
          descricao: i.descricaoHistorica,
          sku: i.skuHistorico,
          quantidade: i.quantidade,
          custoCentavos: i.custoHistoricoCentavos,
        });
    } else {
      const d = dados as DadosEstornoPublico,
        m = prepararEstornoFinanceiro(
          db,
          d,
          tipo === 'ESTORNAR_RECEBIMENTO' ? 'RECEBIMENTO_CLIENTE' : 'REEMBOLSO_CLIENTE',
        ),
        detail = query.obterMovimento({ vendaId: d.vendaId, movimentoId: d.movimentoId });
      valorCentavos = m.valor_centavos;
      formas.push({
        id: m.forma_pagamento_id,
        nome: m.forma_pagamento_historica,
        valorCentavos: m.valor_centavos,
      });
      if (tipo === 'ESTORNAR_RECEBIMENTO') {
        effects.estornosRecebimentoCentavos = m.valor_centavos;
        for (const a of detail.alocacoes)
          if (a.parcelaId) recebidoDelta.set(a.parcelaId, -a.valorCentavos);
      } else {
        effects.estornosReembolsoCentavos = m.valor_centavos;
        for (const id of new Set(
          detail.alocacoes.map((a) => a.reembolsoId).filter((id): id is number => id !== null),
        ))
          obligation(
            id,
            -somar(
              detail.alocacoes.filter((a) => a.reembolsoId === id).map((a) => a.valorCentavos),
            ),
          );
      }
    }
    return {
      tipo,
      dados,
      motivo,
      revisao: fingerprint(dados, motivo, tipo),
      venda,
      anterior,
      previsto: resumoFinanceiro(db, dados.vendaId, effects),
      valorCentavos,
      obrigacoes,
      estoque,
      itens,
      formas,
      parcelas: parcelas.map((p) => ({
        id: p.id,
        saldoAnteriorCentavos: p.saldoCentavos,
        saldoPrevistoCentavos: situacaoParcela(
          p.valorOriginalCentavos,
          p.abatimentosCentavos + (abatidoDelta.get(p.id) ?? 0),
          p.recebimentosCentavos + (recebidoDelta.get(p.id) ?? 0),
          p.vencimento,
          dados.dataEfetiva,
        ).saldoCentavos,
        abatimentoRevertidoCentavos: -(abatidoDelta.get(p.id) ?? 0),
      })),
      avisos: [
        tipo === 'PAGAR_REEMBOLSO'
          ? 'Pagamento exclusivamente desta obrigação, sem novos abatimentos.'
          : 'Estorno integral e individual. Nenhuma dependência será desfeita automaticamente.',
        'Documentos, movimentos e formas históricos permanecem preservados.',
      ],
    };
  }
  function write(input: unknown, tipo: TipoOperacaoFinanceira): ResultadoOperacaoFinanceira {
    const e = record(input, ['operacaoId', 'motivo', 'dados', 'revisao']),
      operacaoId = text(e['operacaoId'], 'operacaoId', 100),
      motivo = text(e['motivo'], 'motivo', 4000),
      revisao = text(e['revisao'], 'revisao', 64),
      dados = normalize(e['dados'], tipo);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operacaoId) ||
      !/^[0-9a-f]{64}$/.test(revisao)
    )
      throw new ComercialError('VALIDATION', 'Intenção ou revisão inválida.');
    return db
      .transaction(() => {
        target(dados, tipo);
        if (!db.prepare('SELECT id FROM operacoes WHERE id=?').get(operacaoId)) {
          if (fingerprint(dados, motivo, tipo) !== revisao)
            throw new ComercialError('VERSION_CONFLICT', 'Revisão desatualizada.');
          review({ motivo, dados }, tipo);
        }
        if (tipo === 'PAGAR_REEMBOLSO') {
          const { reembolsoId, dataEfetiva, pagamentos } = dados as DadosPagamentoReembolsoPublico;
          return financial.pagarReembolso({
            operacaoId,
            motivo,
            dados: { reembolsoId, dataEfetiva, pagamentos },
          });
        }
        if (tipo === 'ESTORNAR_DEVOLUCAO') {
          const { documentoId, dataEfetiva } = dados as DadosEstornoDevolucaoPublico;
          return corrections.estornarDevolucao({
            operacaoId,
            motivo,
            dados: { documentoId, dataEfetiva },
          });
        }
        const { movimentoId, dataEfetiva } = dados as DadosEstornoPublico;
        return tipo === 'ESTORNAR_RECEBIMENTO'
          ? financial.estornarRecebimento({
              operacaoId,
              motivo,
              dados: { movimentoId, dataEfetiva },
            })
          : financial.estornarReembolso({
              operacaoId,
              motivo,
              dados: { movimentoId, dataEfetiva },
            });
      })
      .immediate();
  }
  return {
    revisarPagamentoReembolso: (i: unknown) => db.transaction(() => review(i, 'PAGAR_REEMBOLSO'))(),
    pagarReembolso: (i: unknown) => write(i, 'PAGAR_REEMBOLSO'),
    revisarEstornoRecebimento: (i: unknown) =>
      db.transaction(() => review(i, 'ESTORNAR_RECEBIMENTO'))(),
    estornarRecebimento: (i: unknown) => write(i, 'ESTORNAR_RECEBIMENTO'),
    revisarEstornoReembolso: (i: unknown) =>
      db.transaction(() => review(i, 'ESTORNAR_REEMBOLSO'))(),
    estornarReembolso: (i: unknown) => write(i, 'ESTORNAR_REEMBOLSO'),
    revisarEstornoDevolucaoVenda: (i: unknown) =>
      db.transaction(() => review(i, 'ESTORNAR_DEVOLUCAO'))(),
    estornarDevolucaoVenda: (i: unknown) => write(i, 'ESTORNAR_DEVOLUCAO'),
  };
}
