// Fixed SQL fragments. Renderer values are bound parameters, never identifiers.
export const eventos = `WITH eventos AS (
 SELECT i.produto_id AS produtoId,i.sku_historico AS skuHistorico,i.descricao_historica AS nomeHistorico,
 i.id AS itemId,d.id AS documentoId,v.id AS vendaId,v.numero,v.cliente_id AS clienteId,v.contraparte_nome AS clienteNomeHistorico,
 v.estado,v.data_comercial AS dataVenda,d.data_comercial AS dataEfetiva,
 CASE WHEN d.tipo='VENDA' THEN 'VENDA' WHEN d.tipo='DEV_VENDA' THEN 'DEVOLUCAO' WHEN o.tipo='VENDA' THEN 'CANCELAMENTO' ELSE 'ESTORNO_DEVOLUCAO' END AS categoria,
 CASE WHEN d.tipo IN ('VENDA','ESTORNO') AND (d.tipo='VENDA' OR o.tipo='DEV_VENDA') THEN 1 ELSE -1 END AS sinal,
 i.quantidade,i.valor_bruto_centavos AS bruto,i.valor_liquido_centavos AS valor,i.valor_custo_estoque_centavos AS custo
 FROM documentos d LEFT JOIN documentos o ON o.id=d.documento_origem_id
 JOIN documentos v ON v.id=CASE WHEN d.tipo='VENDA' THEN d.id WHEN o.tipo='VENDA' THEN o.id ELSE o.documento_origem_id END
 JOIN itens_documento i ON i.documento_id=d.id
 WHERE v.tipo='VENDA' AND v.estado IN ('CONFIRMADO','ESTORNADO') AND d.estado IN ('CONFIRMADO','ESTORNADO')
 AND (d.tipo='VENDA' OR d.tipo='DEV_VENDA' AND o.tipo='VENDA' OR d.tipo='ESTORNO' AND o.tipo IN ('VENDA','DEV_VENDA'))
)`;
export const filtroEvento = `(@cliente IS NULL OR clienteId=@cliente) AND (@produto IS NULL OR produtoId=@produto)`;
export const fluxoEvento = `${filtroEvento} AND dataEfetiva BETWEEN @inicio AND @fim`;
export const coorte = `${eventos}, coorte AS (
 SELECT vendaId,numero,clienteId,clienteNomeHistorico,estado,dataVenda AS dataComercial,
 mnr_rel_soma(CASE WHEN categoria='VENDA' THEN valor ELSE 0 END) AS originalCentavos,
 mnr_rel_soma(sinal*valor) AS comercialLiquidoAtualCentavos,
 mnr_rel_soma(sinal*custo) AS custoHistoricoLiquidoAtualCentavos
 FROM eventos WHERE ${filtroEvento} AND dataVenda BETWEEN @inicio AND @fim GROUP BY vendaId
)`;
export const financeiros = `WITH financeiros AS (
 SELECT m.id,v.id AS vendaId,v.numero AS vendaNumero,v.cliente_id AS clienteId,v.contraparte_nome AS clienteNomeHistorico,
 CASE WHEN m.natureza='RECEBIMENTO_CLIENTE' THEN 'RECEBIMENTO' WHEN m.natureza='REEMBOLSO_CLIENTE' THEN 'PAGAMENTO_REEMBOLSO'
 WHEN o.natureza='RECEBIMENTO_CLIENTE' THEN 'ESTORNO_RECEBIMENTO' ELSE 'ESTORNO_REEMBOLSO' END AS natureza,
 m.forma_pagamento_id AS formaPagamentoId,m.forma_pagamento_historica AS formaHistorica,m.valor_centavos AS valorCentavos,
 m.data_efetiva AS dataEfetiva,m.registrado_em AS registradoEm,m.estorna_movimento_id AS estornaMovimentoId
 FROM movimentos_financeiros m JOIN documentos v ON v.id=m.documento_id
 LEFT JOIN movimentos_financeiros o ON o.id=m.estorna_movimento_id
 WHERE v.tipo='VENDA' AND v.estado IN ('CONFIRMADO','ESTORNADO')
 AND (m.natureza IN ('RECEBIMENTO_CLIENTE','REEMBOLSO_CLIENTE') OR m.natureza='ESTORNO_FINANCEIRO' AND o.natureza IN ('RECEBIMENTO_CLIENTE','REEMBOLSO_CLIENTE'))
), filtrados AS (SELECT id,vendaId,vendaNumero,clienteId,clienteNomeHistorico,natureza,formaPagamentoId,formaHistorica,valorCentavos,dataEfetiva,registradoEm,estornaMovimentoId FROM financeiros
 WHERE dataEfetiva BETWEEN @inicio AND @fim AND (@cliente IS NULL OR clienteId=@cliente) AND (@forma IS NULL OR formaPagamentoId=@forma)
 AND (@natureza IS NULL OR natureza=@natureza))`;
export const contas = `WITH recebidos AS (
 SELECT parcela_id,mnr_rel_soma(CASE natureza WHEN 'APLICACAO' THEN valor_centavos ELSE -valor_centavos END) AS valor FROM alocacoes_recebimento GROUP BY parcela_id
), abatidos AS (
 SELECT parcela_id,mnr_rel_soma(CASE natureza WHEN 'ABATIMENTO' THEN valor_centavos ELSE -valor_centavos END) AS valor FROM abatimentos_parcela GROUP BY parcela_id
), base AS (
 SELECT p.id,p.venda_id AS vendaId,d.numero AS vendaNumero,d.cliente_id AS clienteId,d.contraparte_nome AS clienteNomeHistorico,p.tipo,p.vencimento,
 p.valor_original_centavos AS originalCentavos,coalesce(r.valor,0) AS recebimentosLiquidosCentavos,coalesce(b.valor,0) AS abatimentosLiquidosCentavos
 FROM parcelas_receber p JOIN documentos d ON d.id=p.venda_id
 LEFT JOIN recebidos r ON r.parcela_id=p.id LEFT JOIN abatidos b ON b.parcela_id=p.id
 WHERE d.tipo='VENDA' AND d.estado IN ('CONFIRMADO','ESTORNADO')
 AND (@cliente IS NULL OR d.cliente_id=@cliente) AND (@venda IS NULL OR d.id=@venda)
 AND (@de IS NULL OR p.vencimento>=@de) AND (@ate IS NULL OR p.vencimento<=@ate)
), saldos AS (SELECT id,vendaId,vendaNumero,clienteId,clienteNomeHistorico,tipo,vencimento,originalCentavos,recebimentosLiquidosCentavos,abatimentosLiquidosCentavos,
 mnr_rel_saldo(originalCentavos,abatimentosLiquidosCentavos,recebimentosLiquidosCentavos,vencimento,@hoje) AS saldoCentavos,
 mnr_rel_status(originalCentavos,abatimentosLiquidosCentavos,recebimentosLiquidosCentavos,vencimento,@hoje) AS status FROM base), filtrados AS (
 SELECT id,vendaId,vendaNumero,clienteId,clienteNomeHistorico,tipo,vencimento,originalCentavos,recebimentosLiquidosCentavos,abatimentosLiquidosCentavos,saldoCentavos,status FROM saldos
 WHERE @situacao='TODAS' OR @situacao='ABERTAS' AND saldoCentavos>0 OR @situacao='VENCIDAS' AND status='VENCIDO'
 OR @situacao='A_VENCER' AND saldoCentavos>0 AND vencimento>=@hoje OR @situacao='QUITADAS' AND saldoCentavos=0)`;
export const reembolsos = `WITH pagos AS (
 SELECT o.reembolso_id,mnr_rel_soma(CASE a.natureza WHEN 'PAGAMENTO' THEN a.valor_centavos ELSE -a.valor_centavos END) AS valor
 FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id GROUP BY o.reembolso_id
), base AS (
 SELECT r.id,v.id AS vendaId,d.id AS correcaoId,v.cliente_id AS clienteId,v.contraparte_nome AS clienteNomeHistorico,
 d.estado='CONFIRMADO' AS ativa,r.valor_centavos AS originalCentavos,coalesce(p.valor,0) AS pagoLiquidoCentavos,
 CASE WHEN d.estado='CONFIRMADO' THEN mnr_rel_reembolso(r.valor_centavos,coalesce(p.valor,0)) ELSE 0 END AS pendenteCentavos
 FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id JOIN documentos v ON v.id=d.documento_origem_id
 LEFT JOIN pagos p ON p.reembolso_id=r.id WHERE v.tipo='VENDA' AND (@cliente IS NULL OR v.cliente_id=@cliente) AND (@venda IS NULL OR v.id=@venda)
), filtrados AS (SELECT id,vendaId,correcaoId,clienteId,clienteNomeHistorico,ativa,originalCentavos,pagoLiquidoCentavos,pendenteCentavos FROM base
 WHERE @situacao='TODAS' OR @situacao='PENDENTES' AND ativa AND pendenteCentavos>0 OR @situacao='QUITADAS' AND ativa AND pendenteCentavos=0 OR @situacao='ANULADAS' AND NOT ativa)`;
export const saldosProdutos = `WITH filtrados AS (SELECT p.id AS produtoId,p.nome AS nomeAtual,p.sku AS skuAtual,p.ativo,p.estoque_minimo AS estoqueMinimo,s.quantidade,s.valor_total_centavos AS valorCentavos
 FROM produtos p JOIN saldos_estoque s ON s.produto_id=p.id WHERE (@produto IS NULL OR p.id=@produto) AND (@ativo IS NULL OR p.ativo=@ativo)
 AND (@situacao='TODOS' OR @situacao='SEM_ESTOQUE' AND s.quantidade=0 OR @situacao='BAIXO' AND s.quantidade<p.estoque_minimo))`;
