import type Database from 'better-sqlite3';

// Checks persisted components and links, never recomputes historical costs/rateios.
export function reconciliarComercial(db: Database.Database): boolean {
  return db.transaction(() => {
    const invalid = [
      "SELECT 1 FROM operacoes WHERE tipo LIKE 'COMERCIAL_%' AND resultado_json='null' LIMIT 1",
      `SELECT 1 FROM documentos d LEFT JOIN operacoes o ON o.id=d.operacao_confirmacao_id
       WHERE (d.estado='CONFIRMADO' AND (o.id IS NULL OR o.tipo<>'COMERCIAL_CONFIRMAR' OR o.resultado_json='null'))
       OR (d.estado<>'CONFIRMADO' AND d.operacao_confirmacao_id IS NOT NULL) LIMIT 1`,
      `SELECT 1 FROM movimentacoes_estoque m LEFT JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id
       WHERE m.natureza IN ('COMPRA','VENDA') AND v.movimentacao_id IS NULL LIMIT 1`,
      `SELECT 1 FROM vinculos_estoque_comercial v JOIN movimentacoes_estoque m ON m.id=v.movimentacao_id
       JOIN itens_documento i ON i.id=v.item_documento_id JOIN documentos d ON d.id=i.documento_id
       WHERE d.estado<>'CONFIRMADO' OR m.natureza<>d.tipo OR m.produto_id<>i.produto_id
       OR m.operacao_id<>d.operacao_confirmacao_id OR abs(m.quantidade_delta)<>i.quantidade
       OR abs(m.valor_delta_centavos)<>i.valor_custo_estoque_centavos LIMIT 1`,
      `SELECT 1 FROM parcelas_receber p JOIN documentos d ON d.id=p.venda_id WHERE d.estado<>'CONFIRMADO'
       OR d.tipo<>'VENDA' OR p.vencimento<d.data_comercial LIMIT 1`,
      `SELECT 1 FROM movimentos_financeiros m JOIN documentos d ON d.id=m.documento_id
       WHERE d.estado<>'CONFIRMADO' OR m.operacao_id<>d.operacao_confirmacao_id
       OR m.data_efetiva<>d.data_comercial OR (d.tipo='COMPRA' AND m.natureza<>'PAGAMENTO_COMPRA')
       OR (d.tipo='VENDA' AND (m.natureza<>'RECEBIMENTO_CLIENTE' OR d.modalidade_venda<>'A_VISTA')) LIMIT 1`,
      `SELECT 1 FROM alocacoes_recebimento a JOIN movimentos_financeiros m ON m.id=a.movimento_financeiro_id
       JOIN parcelas_receber p ON p.id=a.parcela_id WHERE m.natureza<>'RECEBIMENTO_CLIENTE' OR p.venda_id<>m.documento_id LIMIT 1`,
      `SELECT 1 FROM movimentos_financeiros m WHERE m.natureza='RECEBIMENTO_CLIENTE'
       AND m.valor_centavos<>coalesce((SELECT sum(valor_centavos) FROM alocacoes_recebimento WHERE movimento_financeiro_id=m.id),0) LIMIT 1`,
      `SELECT 1 FROM parcelas_receber p WHERE p.valor_original_centavos<
       coalesce((SELECT sum(valor_centavos) FROM alocacoes_recebimento WHERE parcela_id=p.id),0) LIMIT 1`,
      `SELECT 1 FROM documentos d WHERE d.estado='CONFIRMADO' AND (
       (d.tipo='COMPRA' AND d.fornecedor_id IS NULL) OR (d.tipo='VENDA' AND (d.modalidade_venda IS NULL OR (d.modalidade_venda='A_PRAZO' AND d.cliente_id IS NULL)))
       OR NOT EXISTS (SELECT 1 FROM itens_documento WHERE documento_id=d.id)
       OR d.subtotal_centavos<>(SELECT sum(valor_bruto_centavos) FROM itens_documento WHERE documento_id=d.id)
       OR d.desconto_itens_centavos<>(SELECT sum(desconto_item_centavos) FROM itens_documento WHERE documento_id=d.id)
       OR d.desconto_global_centavos<>(SELECT sum(desconto_global_rateado_centavos) FROM itens_documento WHERE documento_id=d.id)
       OR d.frete_centavos<>(SELECT sum(frete_rateado_centavos) FROM itens_documento WHERE documento_id=d.id)
       OR d.despesas_diretas_centavos<>(SELECT sum(despesas_rateadas_centavos) FROM itens_documento WHERE documento_id=d.id)
       OR coalesce((SELECT sum(valor_centavos) FROM movimentos_financeiros WHERE documento_id=d.id),0)<>
         CASE WHEN d.tipo='COMPRA' OR d.modalidade_venda='A_VISTA' THEN d.total_centavos ELSE 0 END
       OR coalesce((SELECT sum(valor_original_centavos) FROM parcelas_receber WHERE venda_id=d.id),0)<>
         CASE WHEN d.tipo='VENDA' THEN d.total_centavos ELSE 0 END
       OR (d.tipo='VENDA' AND d.modalidade_venda='A_VISTA' AND d.total_centavos>0 AND
         (SELECT count(*) FROM parcelas_receber WHERE venda_id=d.id AND numero=1 AND vencimento=d.data_comercial)<>1)
       OR EXISTS (SELECT 1 FROM itens_documento i WHERE i.documento_id=d.id AND (
         i.sku_historico IS NULL OR i.descricao_historica IS NULL
         OR (d.tipo='COMPRA' AND i.valor_custo_estoque_centavos<>i.valor_liquido_centavos+i.frete_rateado_centavos+i.despesas_rateadas_centavos)
         OR ((d.tipo='COMPRA' AND i.valor_custo_estoque_centavos=0 OR d.tipo='VENDA' AND i.valor_liquido_centavos<i.valor_custo_estoque_centavos) AND i.motivo IS NULL)
         OR (SELECT count(*) FROM vinculos_estoque_comercial WHERE item_documento_id=i.id)<>1))) LIMIT 1`,
    ];
    return !invalid.some((sql) => db.prepare(sql).get() !== undefined);
  })();
}
