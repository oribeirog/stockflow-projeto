import type Database from 'better-sqlite3';
import {
  many,
  one,
  parcelasFinanceiras,
  resumoFinanceiro,
  saldoReembolso,
  total,
} from './financeiro';
import { reversaoAcumulada } from '../domain/correcoes';

/** Independent structural checks over persisted effects; no current-cost repricing. */
export function reconciliarFinanceiro(db: Database.Database): boolean {
  try {
    return db.transaction(() => {
      const invalid = [
        "SELECT 1 FROM operacoes WHERE (tipo LIKE 'COMERCIAL_%' OR tipo LIKE 'FINANCEIRO_%' OR tipo LIKE 'CORRECAO_%') AND resultado_json='null' LIMIT 1",
        `SELECT 1 FROM documentos d LEFT JOIN operacoes o ON o.id=d.operacao_confirmacao_id WHERE
      (d.estado IN ('CONFIRMADO','ESTORNADO') AND (o.id IS NULL OR o.resultado_json='null')) OR
      (d.estado NOT IN ('CONFIRMADO','ESTORNADO') AND d.operacao_confirmacao_id IS NOT NULL) OR
      (d.tipo IN ('DEV_VENDA','DEV_COMPRA','ESTORNO') AND NOT EXISTS(SELECT 1 FROM documentos p WHERE p.id=d.documento_origem_id AND p.id<>d.id)) LIMIT 1`,
        `SELECT 1 FROM movimentos_financeiros m JOIN documentos d ON d.id=m.documento_id JOIN operacoes o ON o.id=m.operacao_id WHERE d.estado NOT IN ('CONFIRMADO','ESTORNADO') OR m.data_efetiva<d.data_comercial OR
      (m.natureza='RECEBIMENTO_CLIENTE' AND (d.tipo<>'VENDA' OR NOT(m.operacao_id=d.operacao_confirmacao_id OR o.tipo='FINANCEIRO_RECEBER'))) OR
      (m.natureza='PAGAMENTO_COMPRA' AND (d.tipo<>'COMPRA' OR m.operacao_id<>d.operacao_confirmacao_id)) OR
      (m.natureza='REEMBOLSO_CLIENTE' AND (d.tipo<>'VENDA' OR o.tipo<>'FINANCEIRO_REEMBOLSAR')) OR
      (m.natureza='REEMBOLSO_FORNECEDOR' AND d.tipo<>'DEV_COMPRA') LIMIT 1`,
        `SELECT 1 FROM alocacoes_recebimento a JOIN movimentos_financeiros m ON m.id=a.movimento_financeiro_id JOIN parcelas_receber p ON p.id=a.parcela_id WHERE p.venda_id<>m.documento_id OR
      (a.natureza='APLICACAO' AND (m.natureza<>'RECEBIMENTO_CLIENTE' OR a.estorna_alocacao_id IS NOT NULL)) OR
      (a.natureza='ESTORNO' AND NOT EXISTS(SELECT 1 FROM alocacoes_recebimento x WHERE x.id=a.estorna_alocacao_id AND x.natureza='APLICACAO' AND x.movimento_financeiro_id=m.estorna_movimento_id AND x.parcela_id=a.parcela_id AND x.valor_centavos=a.valor_centavos)) LIMIT 1`,
        `SELECT 1 FROM movimentos_financeiros e LEFT JOIN movimentos_financeiros m ON m.id=e.estorna_movimento_id WHERE
      (e.natureza='ESTORNO_FINANCEIRO' AND (m.id IS NULL OR m.natureza='ESTORNO_FINANCEIRO' OR m.valor_centavos<>e.valor_centavos OR m.sentido=e.sentido OR m.documento_id<>e.documento_id OR m.forma_pagamento_id<>e.forma_pagamento_id OR m.forma_pagamento_historica<>e.forma_pagamento_historica OR e.data_efetiva<m.data_efetiva)) OR (e.natureza<>'ESTORNO_FINANCEIRO' AND e.estorna_movimento_id IS NOT NULL) LIMIT 1`,
        `SELECT 1 FROM abatimentos_parcela a JOIN documentos d ON d.id=a.documento_correcao_id JOIN parcelas_receber p ON p.id=a.parcela_id WHERE
      (a.natureza='ABATIMENTO' AND (d.documento_origem_id<>p.venda_id OR d.tipo NOT IN ('DEV_VENDA','ESTORNO') OR a.estorna_abatimento_id IS NOT NULL)) OR
      (a.natureza='ESTORNO' AND NOT EXISTS(SELECT 1 FROM abatimentos_parcela b WHERE b.id=a.estorna_abatimento_id AND b.natureza='ABATIMENTO' AND b.parcela_id=a.parcela_id AND b.valor_centavos=a.valor_centavos AND d.documento_origem_id=b.documento_correcao_id)) LIMIT 1`,
        `SELECT 1 FROM origens_reembolso o JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id JOIN alocacoes_recebimento a ON a.id=o.alocacao_recebimento_id JOIN parcelas_receber p ON p.id=a.parcela_id WHERE a.natureza<>'APLICACAO' OR p.venda_id<>d.documento_origem_id OR (d.estado='CONFIRMADO' AND EXISTS(SELECT 1 FROM alocacoes_recebimento e WHERE e.estorna_alocacao_id=a.id)) LIMIT 1`,
        `SELECT 1 FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id JOIN movimentos_financeiros m ON m.id=a.movimento_financeiro_id WHERE m.documento_id<>d.documento_origem_id OR
      (a.natureza='PAGAMENTO' AND (m.natureza<>'REEMBOLSO_CLIENTE' OR a.estorna_alocacao_id IS NOT NULL)) OR
      (a.natureza='ESTORNO' AND NOT EXISTS(SELECT 1 FROM alocacoes_reembolso x WHERE x.id=a.estorna_alocacao_id AND x.natureza='PAGAMENTO' AND x.origem_reembolso_id=o.id AND x.valor_centavos=a.valor_centavos AND x.movimento_financeiro_id=m.estorna_movimento_id)) LIMIT 1`,
        `SELECT 1 FROM movimentacoes_estoque m LEFT JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id WHERE m.natureza IN ('COMPRA','VENDA','DEV_VENDA','DEV_COMPRA','PERDA_DEVOLUCAO') AND v.movimentacao_id IS NULL LIMIT 1`,
        `SELECT 1 FROM movimentacoes_estoque m JOIN movimentacoes_estoque p ON p.id=m.movimentacao_origem_id WHERE m.natureza IN ('REVERSAO_ENTRADA','REVERSAO_SAIDA','PERDA_DEVOLUCAO') AND (m.quantidade_delta<>-p.quantidade_delta OR m.valor_delta_centavos<>-p.valor_delta_centavos OR m.produto_id<>p.produto_id OR (m.natureza='PERDA_DEVOLUCAO' AND (p.natureza<>'DEV_VENDA' OR p.operacao_id<>m.operacao_id OR p.versao_apos+1<>m.versao_apos))) LIMIT 1`,
      ];
      if (invalid.some((sql) => one(db, sql))) return false;
      for (const d of many<{
        id: number;
        tipo: string;
        estado: string;
        total_centavos: number;
        documento_origem_id: number | null;
      }>(db, "SELECT * FROM documentos WHERE estado IN ('CONFIRMADO','ESTORNADO')")) {
        const components = many<{
          valor_bruto_centavos: number;
          desconto_item_centavos: number;
          desconto_global_rateado_centavos: number;
          frete_rateado_centavos: number;
          despesas_rateadas_centavos: number;
          valor_liquido_centavos: number;
        }>(db, 'SELECT * FROM itens_documento WHERE documento_id=?', d.id);
        if (!components.length) return false;
        const sum = components.reduce(
          (v, i) =>
            v +
            BigInt(i.valor_liquido_centavos) +
            BigInt(i.frete_rateado_centavos) +
            BigInt(i.despesas_rateadas_centavos),
          0n,
        );
        if (sum !== BigInt(d.total_centavos)) return false;
        if (d.tipo === 'VENDA') {
          const ps = parcelasFinanceiras(db, d.id, '0000-01-01'),
            s = resumoFinanceiro(db, d.id);
          if (
            ps.reduce((v, p) => v + BigInt(p.valorOriginalCentavos), 0n) !==
            BigInt(d.total_centavos)
          )
            return false;
          if (ps.some((p) => p.abatimentosCentavos > p.valorOriginalCentavos)) return false;
          if (
            ps.reduce((v, p) => v + BigInt(p.saldoCentavos), 0n) !== BigInt(s.saldoReceberCentavos)
          )
            return false;
          let pending = 0n;
          for (const r of many<{ id: number; valor_centavos: number }>(
            db,
            "SELECT r.* FROM reembolsos_cliente r JOIN documentos c ON c.id=r.documento_correcao_id WHERE c.documento_origem_id=? AND c.estado='CONFIRMADO'",
            d.id,
          )) {
            if (
              total(
                db,
                'SELECT valor_centavos valor FROM origens_reembolso WHERE reembolso_id=?',
                r.id,
              ) !== r.valor_centavos
            )
              return false;
            pending += BigInt(saldoReembolso(db, r.id));
          }
          if (pending !== BigInt(s.reembolsosPendentesCentavos)) return false;
        }
        if (
          d.tipo === 'COMPRA' &&
          total(
            db,
            "SELECT valor_centavos valor FROM movimentos_financeiros WHERE documento_id=? AND natureza='PAGAMENTO_COMPRA'",
            d.id,
          ) !== d.total_centavos
        )
          return false;
        if (
          d.tipo === 'DEV_COMPRA' &&
          total(
            db,
            "SELECT valor_centavos valor FROM movimentos_financeiros WHERE documento_id=? AND natureza='REEMBOLSO_FORNECEDOR'",
            d.id,
          ) !== d.total_centavos
        )
          return false;
        if (
          d.tipo === 'DEV_VENDA' ||
          (d.tipo === 'ESTORNO' &&
            one<{ tipo: string }>(
              db,
              'SELECT tipo FROM documentos WHERE id=?',
              d.documento_origem_id!,
            )?.tipo === 'VENDA')
        ) {
          if (
            total(
              db,
              "SELECT valor_centavos valor FROM abatimentos_parcela WHERE documento_correcao_id=? AND natureza='ABATIMENTO'",
              d.id,
            ) !== d.total_centavos
          )
            return false;
        }
      }
      for (const m of many<{
        id: number;
        valor_centavos: number;
        natureza: string;
        estorna_movimento_id: number | null;
      }>(db, 'SELECT * FROM movimentos_financeiros')) {
        const original = m.estorna_movimento_id
          ? one<{ natureza: string }>(
              db,
              'SELECT natureza FROM movimentos_financeiros WHERE id=?',
              m.estorna_movimento_id,
            )?.natureza
          : m.natureza;
        if (
          original === 'RECEBIMENTO_CLIENTE' &&
          total(
            db,
            'SELECT valor_centavos valor FROM alocacoes_recebimento WHERE movimento_financeiro_id=?',
            m.id,
          ) !== m.valor_centavos
        )
          return false;
        if (
          original === 'REEMBOLSO_CLIENTE' &&
          total(
            db,
            'SELECT valor_centavos valor FROM alocacoes_reembolso WHERE movimento_financeiro_id=?',
            m.id,
          ) !== m.valor_centavos
        )
          return false;
      }
      for (const a of many<{ id: number; valor_centavos: number }>(
        db,
        "SELECT * FROM alocacoes_recebimento WHERE natureza='APLICACAO'",
      ))
        if (
          total(
            db,
            "SELECT o.valor_centavos valor FROM origens_reembolso o JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id WHERE o.alocacao_recebimento_id=? AND d.estado='CONFIRMADO'",
            a.id,
          ) > a.valor_centavos
        )
          return false;
      for (const o of many<{ id: number; valor_centavos: number }>(
        db,
        'SELECT * FROM origens_reembolso',
      ))
        if (
          total(
            db,
            "SELECT CASE natureza WHEN 'PAGAMENTO' THEN valor_centavos ELSE -valor_centavos END valor FROM alocacoes_reembolso WHERE origem_reembolso_id=?",
            o.id,
          ) > o.valor_centavos
        )
          return false;
      if (
        one(
          db,
          `SELECT 1 FROM vinculos_estoque_comercial v JOIN movimentacoes_estoque m ON m.id=v.movimentacao_id JOIN itens_documento i ON i.id=v.item_documento_id JOIN documentos d ON d.id=i.documento_id WHERE d.estado NOT IN ('CONFIRMADO','ESTORNADO') OR m.operacao_id<>d.operacao_confirmacao_id OR m.produto_id<>i.produto_id LIMIT 1`,
        )
      )
        return false;
      interface HistoricalItem {
        id: number;
        documento_id: number;
        item_origem_id: number | null;
        quantidade: number;
        quantidade_perda: number;
        produto_id: number;
        sku_historico: string;
        descricao_historica: string;
        valor_liquido_centavos: number;
        desconto_item_centavos: number;
        desconto_global_rateado_centavos: number;
        valor_bruto_centavos: number;
        frete_rateado_centavos: number;
        despesas_rateadas_centavos: number;
        valor_custo_estoque_centavos: number;
        resultado_ajuste_centavos: number;
      }
      for (const i of many<HistoricalItem>(
        db,
        'SELECT * FROM itens_documento WHERE item_origem_id IS NOT NULL',
      )) {
        const d = one<{ id: number; tipo: string; documento_origem_id: number }>(
          db,
          'SELECT * FROM documentos WHERE id=?',
          i.documento_id,
        )!;
        const src = one<HistoricalItem>(
          db,
          'SELECT * FROM itens_documento WHERE id=?',
          i.item_origem_id!,
        )!;
        if (
          src.documento_id !== d.documento_origem_id ||
          src.produto_id !== i.produto_id ||
          src.sku_historico !== i.sku_historico ||
          src.descricao_historica !== i.descricao_historica
        )
          return false;
        // Reconstruct quantity available when this correction was recorded, including
        // reversals already recorded then, rather than using today's document states.
        const prior = total(
          db,
          `SELECT x.quantidade valor FROM itens_documento x JOIN documentos c ON c.id=x.documento_id WHERE x.item_origem_id=? AND c.id<? AND c.tipo IN ('DEV_VENDA','DEV_COMPRA') AND NOT EXISTS(SELECT 1 FROM documentos e WHERE e.documento_origem_id=c.id AND e.tipo='ESTORNO' AND e.id<?)`,
          src.id,
          d.id,
          d.id,
        );
        const part = (t: number) =>
          d.tipo === 'ESTORNO' ? t : reversaoAcumulada(t, src.quantidade, prior, i.quantidade);
        if (d.tipo === 'ESTORNO' && i.quantidade !== src.quantidade) return false;
        for (const key of [
          'valor_liquido_centavos',
          'desconto_item_centavos',
          'desconto_global_rateado_centavos',
        ] as const)
          if (i[key] !== part(src[key])) return false;
        if (
          i.valor_bruto_centavos !==
          i.valor_liquido_centavos + i.desconto_item_centavos + i.desconto_global_rateado_centavos
        )
          return false;
        if (d.tipo === 'DEV_COMPRA') {
          if (
            i.frete_rateado_centavos ||
            i.despesas_rateadas_centavos ||
            i.resultado_ajuste_centavos !==
              i.valor_liquido_centavos - i.valor_custo_estoque_centavos
          )
            return false;
        } else if (i.valor_custo_estoque_centavos !== part(src.valor_custo_estoque_centavos))
          return false;
        const ms = many<{
          id: number;
          natureza: string;
          quantidade_delta: number;
          valor_delta_centavos: number;
          movimentacao_origem_id: number;
        }>(
          db,
          'SELECT m.* FROM movimentacoes_estoque m JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id WHERE v.item_documento_id=? ORDER BY m.id',
          i.id,
        );
        if (d.tipo === 'DEV_VENDA') {
          const entries = ms.filter((m) => m.natureza === 'DEV_VENDA'),
            losses = ms.filter((m) => m.natureza === 'PERDA_DEVOLUCAO');
          if (
            entries.length + losses.length !== ms.length ||
            entries.reduce((v, m) => v + m.quantidade_delta, 0) !== i.quantidade ||
            entries.reduce((v, m) => v + m.valor_delta_centavos, 0) !==
              i.valor_custo_estoque_centavos ||
            losses.reduce((v, m) => v - m.quantidade_delta, 0) !== i.quantidade_perda
          )
            return false;
          let q = prior;
          for (const m of entries) {
            if (
              m.valor_delta_centavos !==
                reversaoAcumulada(
                  src.valor_custo_estoque_centavos,
                  src.quantidade,
                  q,
                  m.quantidade_delta,
                ) ||
              !one(
                db,
                'SELECT 1 FROM vinculos_estoque_comercial WHERE movimentacao_id=? AND item_documento_id=?',
                m.movimentacao_origem_id,
                src.id,
              )
            )
              return false;
            q += m.quantidade_delta;
          }
        } else if (d.tipo === 'DEV_COMPRA') {
          if (
            ms.length !== 1 ||
            ms[0].natureza !== 'DEV_COMPRA' ||
            ms[0].quantidade_delta !== -i.quantidade ||
            ms[0].valor_delta_centavos !== -i.valor_custo_estoque_centavos
          )
            return false;
        } else if (d.tipo === 'ESTORNO') {
          const originals = many<{ id: number }>(
            db,
            'SELECT movimentacao_id id FROM vinculos_estoque_comercial WHERE item_documento_id=?',
            src.id,
          );
          if (
            ms.length !== originals.length ||
            originals.some(
              (o) =>
                !ms.some(
                  (m) =>
                    m.movimentacao_origem_id === o.id &&
                    ['REVERSAO_ENTRADA', 'REVERSAO_SAIDA'].includes(m.natureza),
                ),
            )
          )
            return false;
        }
      }
      // Ordinary purchase/sale stock snapshots remain exact even after corrections.
      if (
        one(
          db,
          `SELECT 1 FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE d.tipo IN ('COMPRA','VENDA') AND d.estado IN ('CONFIRMADO','ESTORNADO') AND (i.sku_historico IS NULL OR i.descricao_historica IS NULL OR
      (d.tipo='COMPRA' AND i.valor_custo_estoque_centavos<>i.valor_liquido_centavos+i.frete_rateado_centavos+i.despesas_rateadas_centavos) OR
      (SELECT count(*) FROM vinculos_estoque_comercial v JOIN movimentacoes_estoque m ON m.id=v.movimentacao_id WHERE v.item_documento_id=i.id AND m.natureza=d.tipo AND m.produto_id=i.produto_id AND m.operacao_id=d.operacao_confirmacao_id AND abs(m.quantidade_delta)=i.quantidade AND abs(m.valor_delta_centavos)=i.valor_custo_estoque_centavos)<>1) LIMIT 1`,
        )
      )
        return false;
      return true;
    })();
  } catch {
    return false;
  }
}
