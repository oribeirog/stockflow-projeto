import { comercialV3 } from './0003-comercial';
import { cadastrosV1 } from './0001-cadastros';

// Released migration SQL is immutable. Rebuild only domains that V3 CHECKs close.
const table = (name: string) => {
  const start = comercialV3.sql.indexOf(`CREATE TABLE ${name} (`);
  if (start < 0) throw new Error(`Missing V3 table ${name}`);
  return comercialV3.sql.slice(start, comercialV3.sql.indexOf(') STRICT;', start) + 9);
};
const trigger = (name: string) => {
  const start = comercialV3.sql.indexOf(`CREATE TRIGGER ${name} `);
  const line = comercialV3.sql.slice(start, comercialV3.sql.indexOf('\n', start));
  if (line.endsWith('END;')) return line;
  const lines = comercialV3.sql.slice(start).split('\n');
  const end = lines.findIndex(
    (l) => l.trim() === 'END;' || (l.includes('BEGIN ') && l.trim().endsWith('END;')),
  );
  if (end < 0) throw new Error(`Missing trigger end ${name}`);
  return lines.slice(0, end + 1).join('\n');
};
const fk = 'ON DELETE RESTRICT ON UPDATE RESTRICT';
const ref = (name: string, target: string) =>
  `${name} INTEGER NOT NULL REFERENCES ${target}(id) ${fk}`;
const value = 'valor_centavos INTEGER NOT NULL CHECK(valor_centavos BETWEEN 1 AND 9000000000000)';
const id = 'id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id BETWEEN 1 AND 9007199254740991)';
const historical = [
  'abatimentos_parcela',
  'reembolsos_cliente',
  'origens_reembolso',
  'alocacoes_reembolso',
];
export const financeiroTables = [...historical] as const;
const definitions: Record<string, string> = {
  eventos_auditoria: cadastrosV1.sql
    .slice(
      cadastrosV1.sql.indexOf('CREATE TABLE eventos_auditoria ('),
      cadastrosV1.sql.indexOf('CREATE INDEX auditoria_produto'),
    )
    .trim()
    .replace(
      '  evento TEXT',
      `  documento_id INTEGER REFERENCES documentos(id) ${fk},\n  evento TEXT`,
    ),
  parcelas_receber: table('parcelas_receber').replace(
    '  criado_em TEXT',
    "  tipo TEXT NOT NULL DEFAULT 'REGULAR' CHECK(tipo IN ('REGULAR','ENTRADA')),\n  criado_em TEXT",
  ),
  vinculos_estoque_comercial: table('vinculos_estoque_comercial'),
  documentos: table('documentos')
    .replace("('COMPRA','VENDA')", "('COMPRA','VENDA','DEV_COMPRA','DEV_VENDA','ESTORNO')")
    .replace(
      "('RASCUNHO','CONFIRMADO','DESCARTADO')",
      "('RASCUNHO','CONFIRMADO','DESCARTADO','ESTORNADO')",
    )
    .replace(
      "CHECK ((tipo='COMPRA'",
      "CHECK (tipo IN ('DEV_COMPRA','DEV_VENDA','ESTORNO') OR (tipo='COMPRA'",
    )
    .replace(
      '  observacoes TEXT',
      `  documento_origem_id INTEGER REFERENCES documentos(id) ${fk},\n  documento_corrigido_id INTEGER REFERENCES documentos(id) ${fk},\n  observacoes TEXT`,
    ),
  itens_documento: table('itens_documento')
    .replace(
      '  motivo TEXT',
      `  item_origem_id INTEGER REFERENCES itens_documento(id) ${fk},\n  quantidade_perda INTEGER NOT NULL DEFAULT 0 CHECK(quantidade_perda BETWEEN 0 AND quantidade),\n  resultado_ajuste_centavos INTEGER NOT NULL DEFAULT 0 CHECK(resultado_ajuste_centavos BETWEEN -9000000000000 AND 9000000000000),\n  motivo TEXT`,
    )
    .replace(
      'CHECK (valor_bruto_centavos=quantidade*valor_unitario_centavos)',
      'CHECK (item_origem_id IS NOT NULL OR valor_bruto_centavos=quantidade*valor_unitario_centavos)',
    ),
  movimentos_financeiros: table('movimentos_financeiros')
    .replace(
      "('PAGAMENTO_COMPRA','RECEBIMENTO_CLIENTE')",
      "('PAGAMENTO_COMPRA','RECEBIMENTO_CLIENTE','REEMBOLSO_CLIENTE','REEMBOLSO_FORNECEDOR','ESTORNO_FINANCEIRO')",
    )
    .replace(
      "(natureza='RECEBIMENTO_CLIENTE' AND sentido='ENTRADA')",
      "(natureza IN ('RECEBIMENTO_CLIENTE','REEMBOLSO_FORNECEDOR') AND sentido='ENTRADA') OR (natureza='REEMBOLSO_CLIENTE' AND sentido='SAIDA') OR (natureza='ESTORNO_FINANCEIRO' AND sentido IN ('ENTRADA','SAIDA'))",
    )
    .replace(
      '  operacao_id TEXT',
      `  estorna_movimento_id INTEGER UNIQUE REFERENCES movimentos_financeiros(id) ${fk},\n  operacao_id TEXT`,
    ),
  alocacoes_recebimento: table('alocacoes_recebimento').replace(
    '  valor_centavos INTEGER',
    `  natureza TEXT NOT NULL DEFAULT 'APLICACAO' CHECK(natureza IN ('APLICACAO','ESTORNO')),\n  estorna_alocacao_id INTEGER UNIQUE REFERENCES alocacoes_recebimento(id) ${fk},\n  valor_centavos INTEGER`,
  ),
  movimentacoes_estoque: table('movimentacoes_estoque_v3')
    .replaceAll('movimentacoes_estoque_v3', 'movimentacoes_estoque')
    .replace(
      "'COMPRA','VENDA')",
      "'COMPRA','VENDA','DEV_VENDA','DEV_COMPRA','REVERSAO_ENTRADA','REVERSAO_SAIDA','PERDA_DEVOLUCAO')",
    )
    .replace(
      "('AJUSTE_ENTRADA','COMPRA')",
      "('AJUSTE_ENTRADA','COMPRA','DEV_VENDA','REVERSAO_ENTRADA')",
    )
    .replace(
      "('AJUSTE_SAIDA','PERDA','VENDA')",
      "('AJUSTE_SAIDA','PERDA','VENDA','DEV_COMPRA','REVERSAO_SAIDA','PERDA_DEVOLUCAO')",
    ),
};
const originalColumns: Record<string, string> = {
  eventos_auditoria:
    'id,operacao_id,produto_id,cliente_id,fornecedor_id,evento,motivo,antes_json,depois_json,registrado_em,versao_aplicativo,documento_id',
  parcelas_receber: 'id,venda_id,numero,valor_original_centavos,vencimento,criado_em',
  vinculos_estoque_comercial: 'movimentacao_id,item_documento_id',
  documentos:
    'id,numero,tipo,estado,versao,cliente_id,fornecedor_id,contraparte_nome,contraparte_documento,modalidade_venda,data_comercial,subtotal_centavos,desconto_itens_centavos,desconto_global_centavos,frete_centavos,despesas_diretas_centavos,total_centavos,observacoes,criado_em,confirmado_em,operacao_confirmacao_id',
  itens_documento:
    'id,documento_id,sequencia,produto_id,sku_historico,descricao_historica,quantidade,valor_unitario_centavos,valor_bruto_centavos,desconto_item_centavos,desconto_global_rateado_centavos,frete_rateado_centavos,despesas_rateadas_centavos,valor_liquido_centavos,valor_custo_estoque_centavos,motivo',
  movimentos_financeiros:
    'id,documento_id,natureza,sentido,valor_centavos,forma_pagamento_id,forma_pagamento_historica,data_efetiva,registrado_em,operacao_id',
  alocacoes_recebimento: 'id,movimento_financeiro_id,parcela_id,valor_centavos',
  movimentacoes_estoque:
    'id,produto_id,natureza,quantidade_delta,valor_delta_centavos,quantidade_apos,valor_apos_centavos,versao_apos,motivo,data_efetiva,registrado_em,operacao_id,movimentacao_origem_id',
};
const allTriggers = [...comercialV3.sql.matchAll(/CREATE TRIGGER (\w+) /g)].map((m) => m[1]);
const indexes = [...comercialV3.sql.matchAll(/CREATE INDEX (\w+) ON (\w+)\([^;]+;/g)]
  .filter((m) => Object.hasOwn(definitions, m[2]))
  .map((m) => m[0])
  .join('\n');
const replaced = [
  'documentos_atualizar',
  'documentos_confirmar',
  'financeiro_inserir',
  'alocacoes_inserir',
  'vinculos_inserir',
  'estoque_movimento_validar',
  'comercial_operacao_finalizar',
];
const preserved = allTriggers.filter((n) => !replaced.includes(n));
// Products of a remainder (< quantity <= 1e9) stay below 1e18 in SQLite.
const roundCost = (q: string) =>
  `(${q})*(custo/quantidade)+((custo%quantidade)*(${q}))/quantidade+CASE WHEN (((custo%quantidade)*(${q}))%quantidade)>=(quantidade/2+quantidade%2) THEN 1 ELSE 0 END`;

export const financeiroV4 = {
  version: 4,
  name: '0004-financeiro',
  sql: `
PRAGMA defer_foreign_keys=ON;
${allTriggers.map((n) => `DROP TRIGGER ${n};`).join('\n')}
DROP TRIGGER eventos_auditoria_imutavel;
DROP TRIGGER eventos_auditoria_sem_exclusao;
CREATE TABLE sequencias_v4(nome TEXT PRIMARY KEY, seq INTEGER NOT NULL) STRICT;
INSERT INTO sequencias_v4 SELECT name,seq FROM sqlite_sequence;
${Object.entries(definitions)
  .map(([name, sql]) => {
    let definition = sql.replace(`CREATE TABLE ${name} (`, `CREATE TABLE ${name}_v4 (`);
    for (const target of Object.keys(definitions))
      definition = definition.replaceAll(`REFERENCES ${target}(`, `REFERENCES ${target}_v4(`);
    return definition;
  })
  .join('\n')}
${Object.keys(definitions)
  .map(
    (name) =>
      `INSERT INTO ${name}_v4(${originalColumns[name]}) SELECT ${originalColumns[name]} FROM ${name};`,
  )
  .join('\n')}
${['alocacoes_recebimento', 'vinculos_estoque_comercial', 'eventos_auditoria', 'parcelas_receber', 'movimentos_financeiros', 'itens_documento', 'documentos', 'movimentacoes_estoque'].map((name) => `DROP TABLE ${name};`).join('\n')}
${Object.keys(definitions)
  .map((name) => `ALTER TABLE ${name}_v4 RENAME TO ${name};`)
  .join('\n')}
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT seq FROM sequencias_v4 WHERE nome=sqlite_sequence.name),0));
DROP TABLE sequencias_v4;
CREATE UNIQUE INDEX parcelas_entrada ON parcelas_receber(venda_id) WHERE tipo='ENTRADA';
${indexes}
CREATE INDEX auditoria_produto ON eventos_auditoria(produto_id,id);
CREATE INDEX auditoria_cliente ON eventos_auditoria(cliente_id);
CREATE INDEX auditoria_fornecedor ON eventos_auditoria(fornecedor_id);
CREATE INDEX auditoria_operacao ON eventos_auditoria(operacao_id);
CREATE TRIGGER eventos_auditoria_imutavel BEFORE UPDATE ON eventos_auditoria BEGIN SELECT RAISE(ABORT,'Historico imutavel'); END;
CREATE TRIGGER eventos_auditoria_sem_exclusao BEFORE DELETE ON eventos_auditoria BEGIN SELECT RAISE(ABORT,'Historico imutavel'); END;
CREATE INDEX documentos_origem ON documentos(documento_origem_id);
CREATE INDEX documentos_corrigido ON documentos(documento_corrigido_id);
CREATE INDEX itens_origem ON itens_documento(item_origem_id);
CREATE UNIQUE INDEX estoque_reversao_unica ON movimentacoes_estoque(movimentacao_origem_id) WHERE natureza IN ('REVERSAO_ENTRADA','REVERSAO_SAIDA');
CREATE TABLE abatimentos_parcela (${id}, ${ref('documento_correcao_id', 'documentos')}, ${ref('parcela_id', 'parcelas_receber')}, ${value},
 natureza TEXT NOT NULL CHECK(natureza IN ('ABATIMENTO','ESTORNO')), estorna_abatimento_id INTEGER UNIQUE REFERENCES abatimentos_parcela(id) ${fk}) STRICT;
CREATE TABLE reembolsos_cliente (${id}, documento_correcao_id INTEGER NOT NULL UNIQUE REFERENCES documentos(id) ${fk}, ${value}) STRICT;
CREATE TABLE origens_reembolso (${id}, ${ref('reembolso_id', 'reembolsos_cliente')}, ${ref('alocacao_recebimento_id', 'alocacoes_recebimento')}, ${value}, UNIQUE(reembolso_id,alocacao_recebimento_id)) STRICT;
CREATE TABLE alocacoes_reembolso (${id}, ${ref('origem_reembolso_id', 'origens_reembolso')}, ${ref('movimento_financeiro_id', 'movimentos_financeiros')}, ${value},
 natureza TEXT NOT NULL CHECK(natureza IN ('PAGAMENTO','ESTORNO')), estorna_alocacao_id INTEGER UNIQUE REFERENCES alocacoes_reembolso(id) ${fk}) STRICT;
CREATE INDEX abatimentos_documento ON abatimentos_parcela(documento_correcao_id);
CREATE INDEX abatimentos_por_parcela ON abatimentos_parcela(parcela_id);
CREATE INDEX origens_recebimento ON origens_reembolso(alocacao_recebimento_id);
CREATE INDEX reembolso_movimento ON alocacoes_reembolso(movimento_financeiro_id);
CREATE INDEX reembolso_origem ON alocacoes_reembolso(origem_reembolso_id);
${preserved.map(trigger).join('\n')}
CREATE TRIGGER documentos_conteudo_preservado BEFORE UPDATE ON documentos WHEN OLD.estado<>'RASCUNHO' BEGIN
 SELECT CASE WHEN ${originalColumns['documentos']
   .split(',')
   .filter((c) => !['estado', 'versao'].includes(c))
   .concat(['documento_origem_id', 'documento_corrigido_id'])
   .map((c) => `NEW.${c} IS NOT OLD.${c}`)
   .join(' OR ')} THEN RAISE(ABORT,'Conteudo confirmado imutavel') END;
END;
${historical
  .map(
    (t) => `
CREATE TRIGGER ${t}_imutavel BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'Historico imutavel'); END;
CREATE TRIGGER ${t}_sem_exclusao BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'Historico imutavel'); END;
CREATE TRIGGER ${t}_identidade BEFORE INSERT ON ${t} WHEN NEW.id<>-1 BEGIN SELECT RAISE(ABORT,'ID deve ser gerado'); END;`,
  )
  .join('\n')}
${trigger('documentos_atualizar').replace("OLD.estado<>'RASCUNHO'", "(OLD.estado<>'RASCUNHO' AND NOT (OLD.estado='CONFIRMADO' AND NEW.estado='ESTORNADO' AND EXISTS(SELECT 1 FROM documentos c JOIN operacoes o ON o.id=c.operacao_confirmacao_id WHERE c.documento_origem_id=OLD.id AND c.tipo='ESTORNO' AND o.resultado_json='null'))) ")}
${trigger('documentos_confirmar')
  .replace(
    "WHEN NEW.estado='CONFIRMADO'",
    "WHEN NEW.estado='CONFIRMADO' AND NEW.tipo IN ('COMPRA','VENDA')",
  )
  .replace(
    "modalidade_venda='A_VISTA' THEN NEW.total_centavos ELSE 0 END",
    "modalidade_venda='A_VISTA' THEN NEW.total_centavos ELSE coalesce((SELECT sum(valor_original_centavos) FROM parcelas_receber WHERE venda_id=NEW.id AND tipo='ENTRADA'),0) END",
  )}
CREATE TRIGGER financeiro_inserir BEFORE INSERT ON movimentos_financeiros BEGIN
 SELECT CASE WHEN length(NEW.data_efetiva)<>10 OR date(NEW.data_efetiva) IS NULL OR date(NEW.data_efetiva)<>NEW.data_efetiva THEN RAISE(ABORT,'Data financeira invalida') END;
 SELECT CASE WHEN NEW.id<>-1 OR NOT EXISTS(SELECT 1 FROM operacoes WHERE id=NEW.operacao_id AND resultado_json='null')
 OR NOT EXISTS(SELECT 1 FROM documentos d WHERE d.id=NEW.documento_id AND (d.estado IN ('CONFIRMADO','ESTORNADO') OR (d.estado='RASCUNHO' AND d.operacao_confirmacao_id=NEW.operacao_id)))
 OR (NEW.natureza<>'ESTORNO_FINANCEIRO' AND (NEW.estorna_movimento_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM formas_pagamento WHERE id=NEW.forma_pagamento_id AND ativo=1 AND nome=NEW.forma_pagamento_historica)))
 OR (NEW.natureza='ESTORNO_FINANCEIRO' AND NOT EXISTS(SELECT 1 FROM movimentos_financeiros m WHERE m.id=NEW.estorna_movimento_id AND m.natureza<>'ESTORNO_FINANCEIRO' AND m.documento_id=NEW.documento_id AND m.valor_centavos=NEW.valor_centavos AND m.sentido<>NEW.sentido AND m.forma_pagamento_id=NEW.forma_pagamento_id AND m.forma_pagamento_historica=NEW.forma_pagamento_historica))
 THEN RAISE(ABORT,'Movimento financeiro invalido') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM documentos d JOIN operacoes o ON o.id=NEW.operacao_id WHERE d.id=NEW.documento_id AND
 ((NEW.natureza='RECEBIMENTO_CLIENTE' AND d.tipo='VENDA' AND NEW.data_efetiva>=d.data_comercial AND (o.tipo='FINANCEIRO_RECEBER' AND d.estado='CONFIRMADO' OR d.estado='RASCUNHO' AND NEW.operacao_id=d.operacao_confirmacao_id AND o.tipo IN ('COMERCIAL_CONFIRMAR','COMERCIAL_CONFIRMAR_ENTRADA')))
 OR (NEW.natureza='PAGAMENTO_COMPRA' AND d.tipo='COMPRA' AND d.estado='RASCUNHO' AND NEW.operacao_id=d.operacao_confirmacao_id AND o.tipo='COMERCIAL_CONFIRMAR')
 OR (NEW.natureza='REEMBOLSO_FORNECEDOR' AND d.tipo='DEV_COMPRA' AND NEW.operacao_id=d.operacao_confirmacao_id AND o.tipo='CORRECAO_DEVOLVER_COMPRA')
 OR (NEW.natureza='REEMBOLSO_CLIENTE' AND d.tipo='VENDA' AND o.tipo='FINANCEIRO_REEMBOLSAR')
 OR (NEW.natureza='ESTORNO_FINANCEIRO' AND (o.tipo LIKE 'FINANCEIRO_ESTORNAR_%' OR o.tipo IN ('CORRECAO_CANCELAR_COMPRA','CORRECAO_ESTORNAR_DEVOLUCAO')))))
 THEN RAISE(ABORT,'Natureza ou operacao financeira incompatível') END;
 SELECT CASE WHEN NEW.natureza='ESTORNO_FINANCEIRO' AND EXISTS(SELECT 1 FROM movimentos_financeiros m WHERE m.id=NEW.estorna_movimento_id AND m.natureza='RECEBIMENTO_CLIENTE') AND EXISTS(SELECT 1 FROM alocacoes_recebimento a JOIN abatimentos_parcela b ON b.parcela_id=a.parcela_id JOIN documentos d ON d.id=b.documento_correcao_id WHERE a.movimento_financeiro_id=NEW.estorna_movimento_id AND b.natureza='ABATIMENTO' AND d.estado='CONFIRMADO') THEN RAISE(ABORT,'Recebimento sustenta correcao') END;
END;
CREATE TRIGGER alocacoes_inserir BEFORE INSERT ON alocacoes_recebimento BEGIN
 SELECT CASE WHEN NEW.id<>-1 OR NOT EXISTS(SELECT 1 FROM movimentos_financeiros m JOIN parcelas_receber p ON p.venda_id=m.documento_id JOIN operacoes o ON o.id=m.operacao_id
 WHERE m.id=NEW.movimento_financeiro_id AND p.id=NEW.parcela_id AND o.resultado_json='null' AND
 ((NEW.natureza='APLICACAO' AND NEW.estorna_alocacao_id IS NULL AND m.natureza='RECEBIMENTO_CLIENTE'
 AND NEW.valor_centavos<=p.valor_original_centavos-coalesce((SELECT sum(CASE natureza WHEN 'APLICACAO' THEN valor_centavos ELSE -valor_centavos END) FROM alocacoes_recebimento WHERE parcela_id=p.id),0)-coalesce((SELECT sum(CASE natureza WHEN 'ABATIMENTO' THEN valor_centavos ELSE -valor_centavos END) FROM abatimentos_parcela WHERE parcela_id=p.id),0))
 OR (NEW.natureza='ESTORNO' AND m.natureza='ESTORNO_FINANCEIRO' AND EXISTS(SELECT 1 FROM alocacoes_recebimento a WHERE a.id=NEW.estorna_alocacao_id AND a.natureza='APLICACAO' AND a.movimento_financeiro_id=m.estorna_movimento_id AND a.parcela_id=p.id AND a.valor_centavos=NEW.valor_centavos)))
 AND NEW.valor_centavos<=m.valor_centavos-coalesce((SELECT sum(valor_centavos) FROM alocacoes_recebimento WHERE movimento_financeiro_id=m.id),0))
 THEN RAISE(ABORT,'Alocacao invalida') END;
END;
${trigger('estoque_movimento_validar').replace('NEW.quantidade_delta < 0 THEN (', "NEW.quantidade_delta < 0 AND NEW.natureza NOT IN ('REVERSAO_SAIDA','PERDA_DEVOLUCAO') THEN (")}
CREATE TRIGGER estoque_correcao_validar BEFORE INSERT ON movimentacoes_estoque WHEN NEW.natureza IN ('DEV_VENDA','DEV_COMPRA','REVERSAO_ENTRADA','REVERSAO_SAIDA','PERDA_DEVOLUCAO') BEGIN
 SELECT CASE WHEN NEW.movimentacao_origem_id IS NULL OR NOT EXISTS(SELECT 1 FROM operacoes WHERE id=NEW.operacao_id AND tipo LIKE 'CORRECAO_%' AND resultado_json='null') THEN RAISE(ABORT,'Correcao sem origem') END;
 SELECT CASE WHEN NEW.natureza='PERDA_DEVOLUCAO' AND NOT EXISTS(SELECT 1 FROM movimentacoes_estoque m WHERE m.id=NEW.movimentacao_origem_id AND m.natureza='DEV_VENDA' AND m.operacao_id=NEW.operacao_id AND m.quantidade_delta=-NEW.quantidade_delta AND m.valor_delta_centavos=-NEW.valor_delta_centavos AND m.versao_apos=NEW.versao_apos-1) THEN RAISE(ABORT,'Perda vinculada invalida') END;
 SELECT CASE WHEN NEW.natureza IN ('REVERSAO_ENTRADA','REVERSAO_SAIDA') AND NOT EXISTS(SELECT 1 FROM movimentacoes_estoque m WHERE m.id=NEW.movimentacao_origem_id AND m.quantidade_delta=-NEW.quantidade_delta AND m.valor_delta_centavos=-NEW.valor_delta_centavos) THEN RAISE(ABORT,'Reversao inexata') END;
 SELECT CASE WHEN NEW.natureza IN ('REVERSAO_ENTRADA','REVERSAO_SAIDA') AND EXISTS(SELECT 1 FROM movimentacoes_estoque p JOIN operacoes o ON o.id=NEW.operacao_id WHERE p.id=NEW.movimentacao_origem_id AND NOT(p.natureza='VENDA' AND o.tipo='CORRECAO_CANCELAR_VENDA') AND EXISTS(SELECT 1 FROM movimentacoes_estoque m WHERE m.produto_id=p.produto_id AND m.id>p.id AND m.operacao_id<>p.operacao_id AND m.operacao_id<>NEW.operacao_id)) THEN RAISE(ABORT,'Reversao com movimento posterior') END;
 SELECT CASE WHEN NEW.natureza='DEV_VENDA' AND NOT EXISTS(
 WITH origem AS (SELECT i.id,i.quantidade,i.valor_custo_estoque_centavos custo FROM itens_documento i JOIN vinculos_estoque_comercial v ON v.item_documento_id=i.id JOIN movimentacoes_estoque m ON m.id=v.movimentacao_id WHERE m.id=NEW.movimentacao_origem_id AND m.natureza='VENDA' AND m.produto_id=NEW.produto_id),
 acumulado AS (SELECT o.*,coalesce((SELECT sum(i.quantidade) FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE i.item_origem_id=o.id AND d.tipo='DEV_VENDA' AND d.estado='CONFIRMADO'),0)+coalesce((SELECT sum(m.quantidade_delta) FROM movimentacoes_estoque m WHERE m.operacao_id=NEW.operacao_id AND m.natureza='DEV_VENDA' AND m.movimentacao_origem_id=NEW.movimentacao_origem_id),0) anterior FROM origem o)
 SELECT 1 FROM acumulado WHERE NEW.quantidade_delta>0 AND anterior+NEW.quantidade_delta<=quantidade AND NEW.valor_delta_centavos=(${roundCost('anterior+NEW.quantidade_delta')})-(${roundCost('anterior')})) THEN RAISE(ABORT,'Custo historico devolvido invalido') END;
END;
CREATE TRIGGER abatimento_inserir BEFORE INSERT ON abatimentos_parcela BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM documentos d JOIN parcelas_receber p ON p.id=NEW.parcela_id JOIN operacoes o ON o.id=d.operacao_confirmacao_id WHERE d.id=NEW.documento_correcao_id AND d.estado='RASCUNHO' AND o.resultado_json='null' AND o.tipo LIKE 'CORRECAO_%' AND
 ((NEW.natureza='ABATIMENTO' AND NEW.estorna_abatimento_id IS NULL AND d.documento_origem_id=p.venda_id AND d.tipo IN ('DEV_VENDA','ESTORNO') AND NEW.valor_centavos<=p.valor_original_centavos-coalesce((SELECT sum(CASE natureza WHEN 'ABATIMENTO' THEN valor_centavos ELSE -valor_centavos END) FROM abatimentos_parcela WHERE parcela_id=p.id),0)) OR
 (NEW.natureza='ESTORNO' AND d.tipo='ESTORNO' AND EXISTS(SELECT 1 FROM abatimentos_parcela a WHERE a.id=NEW.estorna_abatimento_id AND a.natureza='ABATIMENTO' AND a.documento_correcao_id=d.documento_origem_id AND a.parcela_id=p.id AND a.valor_centavos=NEW.valor_centavos)))) THEN RAISE(ABORT,'Abatimento invalido') END;
END;
CREATE TRIGGER obrigacao_inserir BEFORE INSERT ON reembolsos_cliente BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM documentos d JOIN documentos v ON v.id=d.documento_origem_id JOIN operacoes o ON o.id=d.operacao_confirmacao_id WHERE d.id=NEW.documento_correcao_id AND d.estado='RASCUNHO' AND d.tipo IN ('DEV_VENDA','ESTORNO') AND v.tipo='VENDA' AND o.resultado_json='null' AND o.tipo IN ('CORRECAO_DEVOLVER_VENDA','CORRECAO_CANCELAR_VENDA')) THEN RAISE(ABORT,'Obrigacao invalida') END;
END;
CREATE TRIGGER origem_reembolso_inserir BEFORE INSERT ON origens_reembolso BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id JOIN operacoes op ON op.id=d.operacao_confirmacao_id JOIN alocacoes_recebimento a ON a.id=NEW.alocacao_recebimento_id JOIN parcelas_receber p ON p.id=a.parcela_id WHERE r.id=NEW.reembolso_id AND d.estado='RASCUNHO' AND op.resultado_json='null' AND a.natureza='APLICACAO' AND p.venda_id=d.documento_origem_id AND NOT EXISTS(SELECT 1 FROM alocacoes_recebimento e WHERE e.estorna_alocacao_id=a.id)
 AND NEW.valor_centavos<=r.valor_centavos-coalesce((SELECT sum(valor_centavos) FROM origens_reembolso WHERE reembolso_id=r.id),0)
 AND NEW.valor_centavos<=a.valor_centavos-coalesce((SELECT sum(o.valor_centavos) FROM origens_reembolso o JOIN reembolsos_cliente x ON x.id=o.reembolso_id JOIN documentos c ON c.id=x.documento_correcao_id WHERE o.alocacao_recebimento_id=a.id AND c.estado IN ('RASCUNHO','CONFIRMADO')),0)) THEN RAISE(ABORT,'Origem de reembolso invalida') END;
END;
CREATE TRIGGER reembolso_alocacao_inserir BEFORE INSERT ON alocacoes_reembolso BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM origens_reembolso o JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id JOIN movimentos_financeiros m ON m.id=NEW.movimento_financeiro_id JOIN operacoes op ON op.id=m.operacao_id WHERE o.id=NEW.origem_reembolso_id AND op.resultado_json='null' AND m.documento_id=d.documento_origem_id AND
 ((NEW.natureza='PAGAMENTO' AND NEW.estorna_alocacao_id IS NULL AND d.estado='CONFIRMADO' AND m.natureza='REEMBOLSO_CLIENTE' AND NEW.valor_centavos<=o.valor_centavos-coalesce((SELECT sum(CASE natureza WHEN 'PAGAMENTO' THEN valor_centavos ELSE -valor_centavos END) FROM alocacoes_reembolso WHERE origem_reembolso_id=o.id),0)) OR
 (NEW.natureza='ESTORNO' AND m.natureza='ESTORNO_FINANCEIRO' AND EXISTS(SELECT 1 FROM alocacoes_reembolso a WHERE a.id=NEW.estorna_alocacao_id AND a.natureza='PAGAMENTO' AND a.movimento_financeiro_id=m.estorna_movimento_id AND a.origem_reembolso_id=o.id AND a.valor_centavos=NEW.valor_centavos)))
 AND NEW.valor_centavos<=m.valor_centavos-coalesce((SELECT sum(valor_centavos) FROM alocacoes_reembolso WHERE movimento_financeiro_id=m.id),0)) THEN RAISE(ABORT,'Pagamento de reembolso invalido') END;
END;
${trigger('vinculos_inserir').replace('m.natureza=d.tipo', "(m.natureza=d.tipo OR (d.tipo='ESTORNO' AND m.natureza IN ('REVERSAO_ENTRADA','REVERSAO_SAIDA')) OR (d.tipo='DEV_VENDA' AND m.natureza='PERDA_DEVOLUCAO'))").replace('AND abs(m.quantidade_delta)=i.quantidade AND abs(m.valor_delta_centavos)=i.valor_custo_estoque_centavos', '')}
CREATE TRIGGER comercial_operacao_finalizar BEFORE UPDATE ON operacoes WHEN NEW.tipo='COMERCIAL_CONFIRMAR' AND NEW.resultado_json<>'null' BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM documentos WHERE operacao_confirmacao_id=NEW.id AND estado='CONFIRMADO')<>1 THEN RAISE(ABORT,'Confirmacao incompleta') END;
END;
CREATE TRIGGER financeiro_operacao_finalizar BEFORE UPDATE ON operacoes WHEN (NEW.tipo LIKE 'FINANCEIRO_%' OR NEW.tipo LIKE 'CORRECAO_%') AND NEW.resultado_json<>'null' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM eventos_auditoria WHERE operacao_id=NEW.id) THEN RAISE(ABORT,'Auditoria ausente') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM movimentos_financeiros m WHERE m.operacao_id=NEW.id AND m.natureza IN ('RECEBIMENTO_CLIENTE','ESTORNO_FINANCEIRO') AND (m.natureza='RECEBIMENTO_CLIENTE' OR EXISTS(SELECT 1 FROM movimentos_financeiros WHERE id=m.estorna_movimento_id AND natureza='RECEBIMENTO_CLIENTE')) AND m.valor_centavos<>coalesce((SELECT sum(valor_centavos) FROM alocacoes_recebimento WHERE movimento_financeiro_id=m.id),0)) THEN RAISE(ABORT,'Recebimento incompleto') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM movimentos_financeiros m WHERE m.operacao_id=NEW.id AND (m.natureza='REEMBOLSO_CLIENTE' OR m.natureza='ESTORNO_FINANCEIRO' AND EXISTS(SELECT 1 FROM movimentos_financeiros p WHERE p.id=m.estorna_movimento_id AND p.natureza='REEMBOLSO_CLIENTE')) AND m.valor_centavos<>coalesce((SELECT sum(valor_centavos) FROM alocacoes_reembolso WHERE movimento_financeiro_id=m.id),0)) THEN RAISE(ABORT,'Reembolso incompleto') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM reembolsos_cliente r JOIN documentos d ON d.id=r.documento_correcao_id WHERE d.operacao_confirmacao_id=NEW.id AND r.valor_centavos<>coalesce((SELECT sum(valor_centavos) FROM origens_reembolso WHERE reembolso_id=r.id),0)) THEN RAISE(ABORT,'Obrigacao sem origem integral') END;
 SELECT CASE WHEN NEW.tipo LIKE 'FINANCEIRO_%' AND NOT EXISTS(SELECT 1 FROM movimentos_financeiros WHERE operacao_id=NEW.id) THEN RAISE(ABORT,'Operacao sem financeiro') END;
 SELECT CASE WHEN NEW.tipo LIKE 'CORRECAO_%' AND NEW.tipo<>'CORRECAO_ESTORNAR_AJUSTE' AND (SELECT count(*) FROM documentos WHERE operacao_confirmacao_id=NEW.id AND estado='CONFIRMADO')<>1 THEN RAISE(ABORT,'Correcao incompleta') END;
END;
CREATE TRIGGER operacoes_identidade_v4 BEFORE UPDATE ON operacoes WHEN NEW.id<>OLD.id OR NEW.tipo<>OLD.tipo OR NEW.hash_entrada<>OLD.hash_entrada OR NEW.registrado_em<>OLD.registrado_em BEGIN SELECT RAISE(ABORT,'Identidade da operacao imutavel'); END;
`.replaceAll(
    "tipo='COMERCIAL_CONFIRMAR'",
    "tipo IN ('COMERCIAL_CONFIRMAR','COMERCIAL_CONFIRMAR_ENTRADA')",
  ),
} as const;
