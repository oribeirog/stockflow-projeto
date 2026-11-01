import { estoqueV2 } from './0002-estoque';

// Reuse the immutable V2 definitions verbatim, changing only the nature domain.
// This intentionally depends on the released SQL, whose checksum is also checked.
const stockTable = estoqueV2.sql
  .slice(
    estoqueV2.sql.indexOf('CREATE TABLE movimentacoes_estoque'),
    estoqueV2.sql.indexOf('CREATE INDEX estoque_produto'),
  )
  .replaceAll('movimentacoes_estoque', 'movimentacoes_estoque_v3')
  .replace(
    "('AJUSTE_ENTRADA','AJUSTE_SAIDA','PERDA')",
    "('AJUSTE_ENTRADA','AJUSTE_SAIDA','PERDA','COMPRA','VENDA')",
  )
  .replace("natureza = 'AJUSTE_ENTRADA'", "natureza IN ('AJUSTE_ENTRADA','COMPRA')")
  .replace("('AJUSTE_SAIDA','PERDA')", "('AJUSTE_SAIDA','PERDA','VENDA')");
const stockIndexes = estoqueV2.sql.slice(
  estoqueV2.sql.indexOf('CREATE INDEX estoque_produto'),
  estoqueV2.sql.indexOf('INSERT INTO saldos_estoque'),
);
const stockTriggers = estoqueV2.sql.slice(
  estoqueV2.sql.indexOf('CREATE TRIGGER estoque_saldo_inicial'),
);
const stockTriggerNames = [
  'estoque_saldo_inicial',
  'estoque_produto_criado',
  'estoque_saldo_sem_exclusao',
  'estoque_saldo_protegido',
  'estoque_movimento_imutavel',
  'estoque_movimento_sem_exclusao',
  'estoque_movimento_validar',
  'estoque_movimento_aplicar',
];
const fk = 'ON DELETE RESTRICT ON UPDATE RESTRICT';
const money = 'INTEGER NOT NULL CHECK (VALUE BETWEEN 0 AND 9000000000000)';
const amount = (column: string) => `${column} ${money.replace('VALUE', column)}`;
const id = 'id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991)';
export const commercialTables = [
  'documentos',
  'itens_documento',
  'parcelas_receber',
  'movimentos_financeiros',
  'alocacoes_recebimento',
  'vinculos_estoque_comercial',
] as const;
export const comercialV3 = {
  version: 3,
  name: '0003-comercial',
  sql: `
PRAGMA defer_foreign_keys=ON;
CREATE TABLE estoque_sequencia_v3 (seq INTEGER NOT NULL) STRICT;
INSERT INTO estoque_sequencia_v3 SELECT seq FROM sqlite_sequence WHERE name='movimentacoes_estoque';
${stockTriggerNames.map((name) => `DROP TRIGGER ${name};`).join('\n')}
${stockTable}
INSERT INTO movimentacoes_estoque_v3
  (id,produto_id,natureza,quantidade_delta,valor_delta_centavos,quantidade_apos,valor_apos_centavos,
   versao_apos,motivo,data_efetiva,registrado_em,operacao_id,movimentacao_origem_id)
SELECT id,produto_id,natureza,quantidade_delta,valor_delta_centavos,quantidade_apos,valor_apos_centavos,
   versao_apos,motivo,data_efetiva,registrado_em,operacao_id,movimentacao_origem_id FROM movimentacoes_estoque;
DROP TABLE movimentacoes_estoque;
ALTER TABLE movimentacoes_estoque_v3 RENAME TO movimentacoes_estoque;
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT max(seq) FROM estoque_sequencia_v3),0)) WHERE name='movimentacoes_estoque';
INSERT INTO sqlite_sequence(name,seq) SELECT 'movimentacoes_estoque',seq FROM estoque_sequencia_v3
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='movimentacoes_estoque');
DROP TABLE estoque_sequencia_v3;
${stockIndexes}
${stockTriggers}
CREATE TABLE documentos (
  ${id}, numero TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('COMPRA','VENDA')),
  estado TEXT NOT NULL CHECK (estado IN ('RASCUNHO','CONFIRMADO','DESCARTADO')),
  versao INTEGER NOT NULL CHECK (versao BETWEEN 1 AND 9007199254740991),
  cliente_id INTEGER REFERENCES clientes(id) ${fk},
  fornecedor_id INTEGER REFERENCES fornecedores(id) ${fk},
  contraparte_nome TEXT, contraparte_documento TEXT,
  modalidade_venda TEXT CHECK (modalidade_venda IN ('A_VISTA','A_PRAZO')),
  data_comercial TEXT NOT NULL CHECK (length(data_comercial)=10 AND date(data_comercial) IS NOT NULL AND date(data_comercial)=data_comercial),
  ${['subtotal_centavos', 'desconto_itens_centavos', 'desconto_global_centavos', 'frete_centavos', 'despesas_diretas_centavos', 'total_centavos'].map(amount).join(',\n  ')},
  observacoes TEXT CHECK (observacoes IS NULL OR length(trim(observacoes)) BETWEEN 1 AND 4000),
  criado_em TEXT NOT NULL, confirmado_em TEXT,
  operacao_confirmacao_id TEXT UNIQUE REFERENCES operacoes(id) ${fk},
  CHECK ((tipo='COMPRA' AND cliente_id IS NULL AND modalidade_venda IS NULL) OR
    (tipo='VENDA' AND fornecedor_id IS NULL AND frete_centavos=0 AND despesas_diretas_centavos=0)),
  CHECK (total_centavos=subtotal_centavos-desconto_itens_centavos-desconto_global_centavos+frete_centavos+despesas_diretas_centavos),
  CHECK (estado<>'CONFIRMADO' OR (confirmado_em IS NOT NULL AND operacao_confirmacao_id IS NOT NULL))
) STRICT;
CREATE TABLE itens_documento (
  ${id}, documento_id INTEGER NOT NULL REFERENCES documentos(id) ${fk},
  sequencia INTEGER NOT NULL CHECK (sequencia BETWEEN 1 AND 1000),
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ${fk},
  sku_historico TEXT, descricao_historica TEXT,
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 1000000000),
  ${['valor_unitario_centavos', 'valor_bruto_centavos', 'desconto_item_centavos', 'desconto_global_rateado_centavos', 'frete_rateado_centavos', 'despesas_rateadas_centavos', 'valor_liquido_centavos', 'valor_custo_estoque_centavos'].map(amount).join(',\n  ')},
  motivo TEXT CHECK (motivo IS NULL OR length(trim(motivo)) BETWEEN 1 AND 4000),
  UNIQUE(documento_id,sequencia), UNIQUE(documento_id,produto_id),
  CHECK (valor_bruto_centavos=quantidade*valor_unitario_centavos),
  CHECK (valor_liquido_centavos=valor_bruto_centavos-desconto_item_centavos-desconto_global_rateado_centavos)
) STRICT;
CREATE TABLE parcelas_receber (
  ${id}, venda_id INTEGER NOT NULL REFERENCES documentos(id) ${fk},
  numero INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 1000),
  valor_original_centavos INTEGER NOT NULL CHECK (valor_original_centavos BETWEEN 1 AND 9000000000000),
  vencimento TEXT NOT NULL CHECK (length(vencimento)=10 AND date(vencimento) IS NOT NULL AND date(vencimento)=vencimento),
  criado_em TEXT NOT NULL, UNIQUE(venda_id,numero)
) STRICT;
CREATE TABLE movimentos_financeiros (
  ${id}, documento_id INTEGER NOT NULL REFERENCES documentos(id) ${fk},
  natureza TEXT NOT NULL CHECK (natureza IN ('PAGAMENTO_COMPRA','RECEBIMENTO_CLIENTE')),
  sentido TEXT NOT NULL CHECK ((natureza='PAGAMENTO_COMPRA' AND sentido='SAIDA') OR (natureza='RECEBIMENTO_CLIENTE' AND sentido='ENTRADA')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos BETWEEN 1 AND 9000000000000),
  forma_pagamento_id INTEGER NOT NULL REFERENCES formas_pagamento(id) ${fk},
  forma_pagamento_historica TEXT NOT NULL,
  data_efetiva TEXT NOT NULL, registrado_em TEXT NOT NULL,
  operacao_id TEXT NOT NULL REFERENCES operacoes(id) ${fk}
) STRICT;
CREATE TABLE alocacoes_recebimento (
  ${id}, movimento_financeiro_id INTEGER NOT NULL REFERENCES movimentos_financeiros(id) ${fk},
  parcela_id INTEGER NOT NULL REFERENCES parcelas_receber(id) ${fk},
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos BETWEEN 1 AND 9000000000000)
) STRICT;
CREATE TABLE vinculos_estoque_comercial (
  movimentacao_id INTEGER PRIMARY KEY REFERENCES movimentacoes_estoque(id) ${fk},
  item_documento_id INTEGER NOT NULL REFERENCES itens_documento(id) ${fk}
) STRICT;
ALTER TABLE eventos_auditoria ADD COLUMN documento_id INTEGER REFERENCES documentos(id) ${fk};
CREATE INDEX auditoria_documento ON eventos_auditoria(documento_id,id);
CREATE INDEX documentos_tipo ON documentos(tipo,estado,data_comercial,id);
CREATE INDEX documentos_cliente ON documentos(cliente_id,data_comercial);
CREATE INDEX documentos_fornecedor ON documentos(fornecedor_id,data_comercial);
CREATE INDEX itens_produto ON itens_documento(produto_id);
CREATE INDEX parcelas_vencimento ON parcelas_receber(vencimento,venda_id);
CREATE INDEX financeiro_documento ON movimentos_financeiros(documento_id,data_efetiva,id);
CREATE INDEX financeiro_forma ON movimentos_financeiros(forma_pagamento_id);
CREATE INDEX financeiro_operacao ON movimentos_financeiros(operacao_id);
CREATE INDEX alocacoes_movimento ON alocacoes_recebimento(movimento_financeiro_id);
CREATE INDEX alocacoes_parcela ON alocacoes_recebimento(parcela_id);
CREATE INDEX vinculos_item ON vinculos_estoque_comercial(item_documento_id);
CREATE TRIGGER documentos_inserir BEFORE INSERT ON documentos BEGIN
  SELECT CASE WHEN NEW.id<>-1 OR NEW.estado<>'RASCUNHO' OR NEW.versao<>1 OR NEW.operacao_confirmacao_id IS NOT NULL
    THEN RAISE(ABORT,'Documento deve nascer como rascunho') END;
END;
CREATE TRIGGER documentos_sem_exclusao BEFORE DELETE ON documentos BEGIN SELECT RAISE(ABORT,'Use descarte logico'); END;
CREATE TRIGGER documentos_atualizar BEFORE UPDATE ON documentos BEGIN
  SELECT CASE WHEN OLD.estado<>'RASCUNHO' OR NEW.id<>OLD.id OR NEW.tipo<>OLD.tipo OR NEW.numero<>OLD.numero
    OR NEW.criado_em<>OLD.criado_em OR NEW.versao<>OLD.versao+1
    THEN RAISE(ABORT,'Documento imutavel ou versao invalida') END;
END;
${['INSERT', 'UPDATE', 'DELETE']
  .map(
    (action) => `
CREATE TRIGGER itens_${action.toLowerCase()} BEFORE ${action} ON itens_documento BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM documentos WHERE id=${action === 'DELETE' ? 'OLD' : 'NEW'}.documento_id AND estado='RASCUNHO')
    ${action === 'UPDATE' ? 'OR NEW.id<>OLD.id OR NEW.documento_id<>OLD.documento_id' : ''}
    ${action === 'INSERT' ? 'OR NEW.id<>-1' : ''}
    THEN RAISE(ABORT,'Item protegido') END;
END;`,
  )
  .join('\n')}
${[
  'parcelas_receber',
  'movimentos_financeiros',
  'alocacoes_recebimento',
  'vinculos_estoque_comercial',
]
  .map(
    (table) => `
CREATE TRIGGER ${table}_imutavel BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Historico imutavel'); END;
CREATE TRIGGER ${table}_sem_exclusao BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Historico imutavel'); END;`,
  )
  .join('\n')}
CREATE TRIGGER parcelas_inserir BEFORE INSERT ON parcelas_receber BEGIN
  SELECT CASE WHEN NEW.id<>-1 OR NOT EXISTS (SELECT 1 FROM documentos d JOIN operacoes o ON o.id=d.operacao_confirmacao_id
    WHERE d.id=NEW.venda_id AND d.tipo='VENDA' AND d.estado='RASCUNHO' AND o.resultado_json='null'
    AND NEW.vencimento>=d.data_comercial)
    THEN RAISE(ABORT,'Parcela invalida') END;
END;
CREATE TRIGGER financeiro_inserir BEFORE INSERT ON movimentos_financeiros BEGIN
  SELECT CASE WHEN NEW.id<>-1 OR NOT EXISTS (
    SELECT 1 FROM documentos d JOIN operacoes o ON o.id=d.operacao_confirmacao_id JOIN formas_pagamento f ON f.id=NEW.forma_pagamento_id
    WHERE d.id=NEW.documento_id AND d.estado='RASCUNHO' AND NEW.operacao_id=o.id AND o.resultado_json='null'
    AND f.ativo=1 AND NEW.forma_pagamento_historica=f.nome AND NEW.data_efetiva=d.data_comercial
    AND ((d.tipo='COMPRA' AND NEW.natureza='PAGAMENTO_COMPRA') OR
      (d.tipo='VENDA' AND d.modalidade_venda='A_VISTA' AND NEW.natureza='RECEBIMENTO_CLIENTE')))
    THEN RAISE(ABORT,'Movimento financeiro invalido') END;
END;
CREATE TRIGGER alocacoes_inserir BEFORE INSERT ON alocacoes_recebimento BEGIN
  SELECT CASE WHEN NEW.id<>-1 OR NOT EXISTS (
    SELECT 1 FROM movimentos_financeiros m JOIN parcelas_receber p ON p.venda_id=m.documento_id
    JOIN documentos d ON d.id=p.venda_id JOIN operacoes o ON o.id=m.operacao_id
    WHERE m.id=NEW.movimento_financeiro_id AND p.id=NEW.parcela_id AND m.natureza='RECEBIMENTO_CLIENTE'
    AND d.estado='RASCUNHO' AND o.resultado_json='null'
    AND NEW.valor_centavos<=m.valor_centavos-coalesce((SELECT sum(valor_centavos) FROM alocacoes_recebimento WHERE movimento_financeiro_id=m.id),0)
    AND NEW.valor_centavos<=p.valor_original_centavos-coalesce((SELECT sum(valor_centavos) FROM alocacoes_recebimento WHERE parcela_id=p.id),0))
    THEN RAISE(ABORT,'Alocacao invalida') END;
END;
CREATE TRIGGER estoque_comercial_inserir BEFORE INSERT ON movimentacoes_estoque WHEN NEW.natureza IN ('COMPRA','VENDA') BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM documentos d JOIN itens_documento i ON i.documento_id=d.id JOIN operacoes o ON o.id=d.operacao_confirmacao_id
    WHERE d.estado='RASCUNHO' AND d.tipo=NEW.natureza AND o.id=NEW.operacao_id AND o.resultado_json='null'
    AND o.tipo='COMERCIAL_CONFIRMAR' AND i.produto_id=NEW.produto_id AND i.quantidade=abs(NEW.quantidade_delta)
    AND i.valor_custo_estoque_centavos=abs(NEW.valor_delta_centavos) AND NEW.movimentacao_origem_id IS NULL
    AND NEW.data_efetiva=d.data_comercial)
    THEN RAISE(ABORT,'Movimento comercial sem item') END;
END;
CREATE TRIGGER vinculos_inserir BEFORE INSERT ON vinculos_estoque_comercial BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM vinculos_estoque_comercial WHERE movimentacao_id=NEW.movimentacao_id)
    OR NOT EXISTS (
    SELECT 1 FROM itens_documento i JOIN documentos d ON d.id=i.documento_id
    JOIN movimentacoes_estoque m ON m.id=NEW.movimentacao_id JOIN operacoes o ON o.id=m.operacao_id
    WHERE i.id=NEW.item_documento_id AND d.estado='RASCUNHO' AND m.natureza=d.tipo AND m.produto_id=i.produto_id
    AND m.operacao_id=d.operacao_confirmacao_id AND o.resultado_json='null'
    AND abs(m.quantidade_delta)=i.quantidade AND abs(m.valor_delta_centavos)=i.valor_custo_estoque_centavos)
    THEN RAISE(ABORT,'Vinculo comercial invalido') END;
END;
CREATE TRIGGER documentos_confirmar BEFORE UPDATE ON documentos WHEN NEW.estado='CONFIRMADO' BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM operacoes WHERE id=NEW.operacao_confirmacao_id AND tipo='COMERCIAL_CONFIRMAR' AND resultado_json='null')
    OR (NEW.tipo='COMPRA' AND NOT EXISTS (SELECT 1 FROM fornecedores WHERE id=NEW.fornecedor_id AND ativo=1 AND nome=NEW.contraparte_nome AND documento IS NEW.contraparte_documento))
    OR (NEW.tipo='VENDA' AND (NEW.modalidade_venda IS NULL OR (NEW.modalidade_venda='A_PRAZO' AND NEW.cliente_id IS NULL)))
    OR (NEW.cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id=NEW.cliente_id AND ativo=1 AND nome=NEW.contraparte_nome AND documento IS NEW.contraparte_documento))
    THEN RAISE(ABORT,'Contraparte ou operacao invalida') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM itens_documento WHERE documento_id=NEW.id)
    OR NEW.subtotal_centavos<>(SELECT sum(valor_bruto_centavos) FROM itens_documento WHERE documento_id=NEW.id)
    OR NEW.desconto_itens_centavos<>(SELECT sum(desconto_item_centavos) FROM itens_documento WHERE documento_id=NEW.id)
    OR NEW.desconto_global_centavos<>(SELECT sum(desconto_global_rateado_centavos) FROM itens_documento WHERE documento_id=NEW.id)
    OR NEW.frete_centavos<>(SELECT sum(frete_rateado_centavos) FROM itens_documento WHERE documento_id=NEW.id)
    OR NEW.despesas_diretas_centavos<>(SELECT sum(despesas_rateadas_centavos) FROM itens_documento WHERE documento_id=NEW.id)
    THEN RAISE(ABORT,'Totais comerciais invalidos') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM itens_documento i JOIN produtos p ON p.id=i.produto_id WHERE i.documento_id=NEW.id AND
    (p.ativo<>1 OR i.sku_historico IS NOT p.sku OR i.descricao_historica IS NOT p.nome
    OR (NEW.tipo='COMPRA' AND i.valor_custo_estoque_centavos<>i.valor_liquido_centavos+i.frete_rateado_centavos+i.despesas_rateadas_centavos)
    OR (NEW.tipo='COMPRA' AND i.valor_custo_estoque_centavos=0 AND i.motivo IS NULL)
    OR (NEW.tipo='VENDA' AND i.valor_liquido_centavos<i.valor_custo_estoque_centavos AND i.motivo IS NULL)
    OR (SELECT count(*) FROM vinculos_estoque_comercial v JOIN movimentacoes_estoque m ON m.id=v.movimentacao_id
      WHERE v.item_documento_id=i.id AND m.produto_id=i.produto_id AND m.natureza=NEW.tipo
      AND m.operacao_id=NEW.operacao_confirmacao_id AND abs(m.quantidade_delta)=i.quantidade
      AND abs(m.valor_delta_centavos)=i.valor_custo_estoque_centavos)<>1))
    OR (SELECT count(*) FROM movimentacoes_estoque WHERE operacao_id=NEW.operacao_confirmacao_id)<>
      (SELECT count(*) FROM itens_documento WHERE documento_id=NEW.id)
    THEN RAISE(ABORT,'Itens ou estoque inconsistentes') END;
  SELECT CASE WHEN
    coalesce((SELECT sum(valor_centavos) FROM movimentos_financeiros WHERE documento_id=NEW.id),0)<>
      CASE WHEN NEW.tipo='COMPRA' OR NEW.modalidade_venda='A_VISTA' THEN NEW.total_centavos ELSE 0 END
    OR coalesce((SELECT sum(valor_original_centavos) FROM parcelas_receber WHERE venda_id=NEW.id),0)<>
      CASE WHEN NEW.tipo='VENDA' THEN NEW.total_centavos ELSE 0 END
    OR (NEW.tipo='VENDA' AND NEW.modalidade_venda='A_VISTA' AND NEW.total_centavos>0 AND
      (SELECT count(*) FROM parcelas_receber WHERE venda_id=NEW.id AND numero=1 AND vencimento=NEW.data_comercial)<>1)
    OR EXISTS (SELECT 1 FROM movimentos_financeiros m WHERE m.documento_id=NEW.id AND m.natureza='RECEBIMENTO_CLIENTE'
      AND m.valor_centavos<>coalesce((SELECT sum(valor_centavos) FROM alocacoes_recebimento WHERE movimento_financeiro_id=m.id),0))
    THEN RAISE(ABORT,'Parcelas ou pagamentos inconsistentes') END;
END;
CREATE TRIGGER comercial_operacao_finalizar BEFORE UPDATE ON operacoes
WHEN NEW.tipo='COMERCIAL_CONFIRMAR' AND NEW.resultado_json<>'null' BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM documentos WHERE operacao_confirmacao_id=NEW.id AND estado='CONFIRMADO')<>1
    THEN RAISE(ABORT,'Confirmacao incompleta') END;
END;
CREATE TRIGGER operacoes_sem_substituicao BEFORE INSERT ON operacoes
WHEN EXISTS (SELECT 1 FROM operacoes WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Operacao existente'); END;
CREATE TRIGGER comercial_operacao_identidade BEFORE UPDATE ON operacoes
WHEN OLD.tipo LIKE 'COMERCIAL_%' AND (NEW.id<>OLD.id OR NEW.tipo<>OLD.tipo OR NEW.hash_entrada<>OLD.hash_entrada OR NEW.registrado_em<>OLD.registrado_em)
BEGIN SELECT RAISE(ABORT,'Identidade da operacao imutavel'); END;
CREATE TRIGGER auditoria_sem_substituicao BEFORE INSERT ON eventos_auditoria
WHEN NEW.id<>-1 BEGIN SELECT RAISE(ABORT,'ID de auditoria deve ser gerado'); END;
`,
} as const;
