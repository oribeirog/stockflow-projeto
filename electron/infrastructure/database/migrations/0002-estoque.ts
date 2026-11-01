// Immutable after release. No application-defined functions in schema expressions.
const restrict = 'ON DELETE RESTRICT ON UPDATE RESTRICT';
export const estoqueV2 = {
  version: 2,
  name: '0002-estoque',
  sql: `
CREATE TABLE saldos_estoque (
  produto_id INTEGER PRIMARY KEY REFERENCES produtos(id) ${restrict},
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 0 AND 1000000000),
  valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos BETWEEN 0 AND 9000000000000),
  versao INTEGER NOT NULL CHECK (versao BETWEEN 0 AND 9007199254740991),
  CHECK (quantidade > 0 OR valor_total_centavos = 0)
) STRICT;
CREATE TABLE movimentacoes_estoque (
  id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ${restrict},
  natureza TEXT NOT NULL CHECK (natureza IN ('AJUSTE_ENTRADA','AJUSTE_SAIDA','PERDA')),
  quantidade_delta INTEGER NOT NULL CHECK (quantidade_delta BETWEEN -1000000000 AND 1000000000 AND quantidade_delta <> 0),
  valor_delta_centavos INTEGER NOT NULL CHECK (valor_delta_centavos BETWEEN -9000000000000 AND 9000000000000),
  quantidade_apos INTEGER NOT NULL CHECK (quantidade_apos BETWEEN 0 AND 1000000000),
  valor_apos_centavos INTEGER NOT NULL CHECK (valor_apos_centavos BETWEEN 0 AND 9000000000000),
  versao_apos INTEGER NOT NULL CHECK (versao_apos BETWEEN 1 AND 9007199254740991),
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) BETWEEN 1 AND 4000),
  data_efetiva TEXT NOT NULL,
  registrado_em TEXT NOT NULL,
  operacao_id TEXT NOT NULL REFERENCES operacoes(id) ${restrict},
  movimentacao_origem_id INTEGER REFERENCES movimentacoes_estoque(id) ${restrict},
  UNIQUE (produto_id, versao_apos),
  CHECK ((natureza = 'AJUSTE_ENTRADA' AND quantidade_delta > 0 AND valor_delta_centavos >= 0)
    OR (natureza IN ('AJUSTE_SAIDA','PERDA') AND quantidade_delta < 0 AND valor_delta_centavos <= 0)),
  CHECK (quantidade_apos > 0 OR valor_apos_centavos = 0)
) STRICT;
CREATE INDEX estoque_produto ON movimentacoes_estoque(produto_id, id);
CREATE INDEX estoque_operacao ON movimentacoes_estoque(operacao_id);
CREATE INDEX estoque_origem ON movimentacoes_estoque(movimentacao_origem_id);
INSERT INTO saldos_estoque SELECT id, 0, 0, 0 FROM produtos;
CREATE TRIGGER estoque_saldo_inicial BEFORE INSERT ON saldos_estoque
BEGIN
  SELECT CASE WHEN NEW.quantidade <> 0 OR NEW.valor_total_centavos <> 0 OR NEW.versao <> 0
    OR EXISTS (SELECT 1 FROM saldos_estoque WHERE produto_id = NEW.produto_id)
    OR EXISTS (SELECT 1 FROM movimentacoes_estoque WHERE produto_id = NEW.produto_id)
    THEN RAISE(ABORT, 'Saldo inicial invalido') END;
END;
CREATE TRIGGER estoque_produto_criado AFTER INSERT ON produtos
BEGIN INSERT INTO saldos_estoque VALUES (NEW.id, 0, 0, 0); END;
CREATE TRIGGER estoque_saldo_sem_exclusao BEFORE DELETE ON saldos_estoque
BEGIN SELECT RAISE(ABORT, 'Saldo nao pode ser excluido'); END;
CREATE TRIGGER estoque_saldo_protegido BEFORE UPDATE ON saldos_estoque
BEGIN
  SELECT CASE WHEN NEW.produto_id <> OLD.produto_id OR NEW.versao <> OLD.versao + 1
    OR NOT EXISTS (
      SELECT 1 FROM movimentacoes_estoque m WHERE m.produto_id = OLD.produto_id
      AND m.versao_apos = NEW.versao
      AND m.quantidade_apos = NEW.quantidade AND m.valor_apos_centavos = NEW.valor_total_centavos
      AND m.quantidade_apos - m.quantidade_delta = OLD.quantidade
      AND m.valor_apos_centavos - m.valor_delta_centavos = OLD.valor_total_centavos
    ) THEN RAISE(ABORT, 'Saldo somente por movimentacao') END;
END;
CREATE TRIGGER estoque_movimento_imutavel BEFORE UPDATE ON movimentacoes_estoque
BEGIN SELECT RAISE(ABORT, 'Historico imutavel'); END;
CREATE TRIGGER estoque_movimento_sem_exclusao BEFORE DELETE ON movimentacoes_estoque
BEGIN SELECT RAISE(ABORT, 'Historico imutavel'); END;
CREATE TRIGGER estoque_movimento_validar BEFORE INSERT ON movimentacoes_estoque
BEGIN
  SELECT CASE WHEN NEW.id <> -1 THEN RAISE(ABORT, 'ID de movimento deve ser gerado') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM operacoes WHERE id = NEW.operacao_id AND resultado_json = 'null')
    THEN RAISE(ABORT, 'Operacao de estoque invalida') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM saldos_estoque s WHERE s.produto_id = NEW.produto_id
    AND NEW.versao_apos = s.versao + 1
    AND NEW.quantidade_apos = s.quantidade + NEW.quantidade_delta
    AND NEW.valor_apos_centavos = s.valor_total_centavos + NEW.valor_delta_centavos
    AND NEW.quantidade_apos BETWEEN 0 AND 1000000000
    AND NEW.valor_apos_centavos BETWEEN 0 AND 9000000000000
  ) THEN RAISE(ABORT, 'Saldo ou versao de movimento invalido') END;
  SELECT CASE WHEN NEW.movimentacao_origem_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM movimentacoes_estoque WHERE id = NEW.movimentacao_origem_id AND produto_id = NEW.produto_id
  ) THEN RAISE(ABORT, 'Origem de movimento invalida') END;
  -- Validate domains before arithmetic: no division by zero or overflow path.
  SELECT CASE WHEN NEW.quantidade_delta NOT BETWEEN -1000000000 AND 1000000000
    OR NEW.quantidade_delta = 0 OR NEW.valor_delta_centavos NOT BETWEEN -9000000000000 AND 9000000000000
    THEN RAISE(ABORT, 'Delta invalido') END;
  SELECT CASE WHEN (CASE WHEN NEW.quantidade_delta < 0 THEN (
    SELECT CASE WHEN s.quantidade < -NEW.quantidade_delta OR s.quantidade = 0 THEN 1
    ELSE -NEW.valor_delta_centavos <>
      (-NEW.quantidade_delta) * (s.valor_total_centavos / s.quantidade)
      + ((s.valor_total_centavos % s.quantidade) * (-NEW.quantidade_delta)) / s.quantidade
      + CASE WHEN (((s.valor_total_centavos % s.quantidade) * (-NEW.quantidade_delta)) % s.quantidade)
          >= (s.quantidade / 2 + s.quantidade % 2) THEN 1 ELSE 0 END
    END FROM saldos_estoque s WHERE s.produto_id = NEW.produto_id
  ) ELSE 0 END) THEN RAISE(ABORT, 'Custo de saida invalido') END;
END;
CREATE TRIGGER estoque_movimento_aplicar AFTER INSERT ON movimentacoes_estoque
BEGIN
  UPDATE saldos_estoque SET quantidade = NEW.quantidade_apos,
    valor_total_centavos = NEW.valor_apos_centavos, versao = NEW.versao_apos
    WHERE produto_id = NEW.produto_id;
END;
`,
} as const;
