import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical, record, text } from './catalog-validation';
import { ComercialError } from './comercial';
import { situacaoParcela } from '../domain/correcoes';
import type { RevisaoRecebimento } from '../../shared/financeiro-ipc';
import {
  createFinancialService,
  normalizarRecebimento,
  prepararRecebimento,
  resumoFinanceiro,
  parcelasFinanceiras,
} from './financeiro';

export function createReceiptService(
  db: Database.Database,
  version: string,
  clock: () => Date = () => new Date(),
) {
  const financial = createFinancialService(db, version, clock);
  function fingerprint(dados: ReturnType<typeof normalizarRecebimento>, motivo: string) {
    const venda = db
      .prepare('SELECT id,versao,estado FROM documentos WHERE id=?')
      .get(dados.vendaId);
    const parcelas = parcelasFinanceiras(db, dados.vendaId, dados.dataEfetiva);
    const movimentos = db
      .prepare('SELECT id FROM movimentos_financeiros WHERE documento_id=? ORDER BY id')
      .all(dados.vendaId);
    const alocacoes = db
      .prepare(
        'SELECT a.id FROM alocacoes_recebimento a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id=? ORDER BY a.id',
      )
      .all(dados.vendaId);
    const abatimentos = db
      .prepare(
        'SELECT a.id FROM abatimentos_parcela a JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id=? ORDER BY a.id',
      )
      .all(dados.vendaId);
    const correcoes = db
      .prepare('SELECT id,estado,versao FROM documentos WHERE documento_origem_id=? ORDER BY id')
      .all(dados.vendaId);
    const formas = dados.pagamentos.map(
      (p) =>
        db
          .prepare('SELECT id,nome,ativo FROM formas_pagamento WHERE id=?')
          .get(p.formaPagamentoId) ?? null,
    );
    return createHash('sha256')
      .update(
        canonical({
          dados,
          motivo,
          venda: venda ?? null,
          parcelas,
          movimentos,
          alocacoes,
          abatimentos,
          correcoes,
          formas,
        }),
      )
      .digest('hex');
  }
  function review(input: unknown): RevisaoRecebimento {
    const envelope = record(input, ['motivo', 'dados']);
    const motivo = text(envelope['motivo'], 'motivo', 4000);
    const dados = normalizarRecebimento(envelope['dados'], clock());
    const plano = prepararRecebimento(db, dados);
    const formas = dados.pagamentos.map((p) => {
      const f = db
        .prepare('SELECT id,nome,ativo FROM formas_pagamento WHERE id=?')
        .get(p.formaPagamentoId) as { id: number; nome: string; ativo: number } | undefined;
      if (!f?.ativo) throw new ComercialError('INACTIVE_REFERENCE', 'Forma de pagamento inativa.');
      return f;
    });
    const venda = db
      .prepare(
        "SELECT id,numero,versao,estado,contraparte_nome AS cliente FROM documentos WHERE id=? AND tipo='VENDA'",
      )
      .get(dados.vendaId) as RevisaoRecebimento['venda'];
    const resumo = resumoFinanceiro(db, dados.vendaId);
    const revisao = fingerprint(dados, motivo);
    const efeitos = plano.alocacoes.map((a) => {
      const p = plano.parcelas.find((p) => p.id === a.parcelaId)!;
      const futuro = situacaoParcela(
        p.valorOriginalCentavos,
        p.abatimentosCentavos,
        p.recebimentosCentavos + a.valorCentavos,
        p.vencimento,
        dados.dataEfetiva,
      );
      return {
        parcelaId: p.id,
        saldoAnteriorCentavos: p.saldoCentavos,
        saldoPrevistoCentavos: futuro.saldoCentavos,
        statusPrevisto: futuro.status,
      };
    });
    return {
      dados,
      motivo,
      plano,
      venda,
      formas,
      resumo,
      revisao,
      efeitos,
      saldoPrevistoCentavos: resumo.saldoReceberCentavos - plano.totalCentavos,
    };
  }
  return {
    revisarRecebimento(input: unknown) {
      return db.transaction(() => review(input))();
    },
    registrarRecebimento(input: unknown) {
      const e = record(input, ['operacaoId', 'motivo', 'dados', 'revisao']);
      const operacaoId = text(e['operacaoId'], 'operacaoId', 100);
      const revisao = text(e['revisao'], 'revisao', 64);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          operacaoId,
        ) ||
        !/^[0-9a-f]{64}$/.test(revisao)
      )
        throw new ComercialError('VALIDATION', 'Intenção ou revisão inválida.');
      const motivo = text(e['motivo'], 'motivo', 4000);
      const dados = normalizarRecebimento(e['dados'], clock());
      const command = { operacaoId, motivo, dados };
      return db
        .transaction(() => {
          const old = db.prepare('SELECT id FROM operacoes WHERE id=?').get(operacaoId);
          if (!old && fingerprint(dados, motivo) !== revisao)
            throw new ComercialError('VERSION_CONFLICT', 'O financeiro mudou após a revisão.');
          return financial.registrarRecebimento(command);
        })
        .immediate();
    },
  };
}
