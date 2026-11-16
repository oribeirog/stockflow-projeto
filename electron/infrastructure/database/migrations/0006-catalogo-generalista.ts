import { cadastrosV1 } from './0001-cadastros';

// Reuse the released definition without modifying the historical migration.
const products = cadastrosV1.sql
  .slice(
    cadastrosV1.sql.indexOf('CREATE TABLE produtos ('),
    cadastrosV1.sql.indexOf('CREATE TABLE historico_precos ('),
  )
  .replace(
    'volume_microlitros INTEGER NOT NULL CHECK (volume_microlitros BETWEEN 1 AND 1000000000)',
    'volume_microlitros INTEGER CHECK (volume_microlitros IS NULL OR volume_microlitros BETWEEN 1 AND 1000000000)',
  )
  .replace(
    '  concentracao TEXT',
    "  unidade_comercial TEXT NOT NULL DEFAULT 'UN' CHECK (unidade_comercial IN ('UN','CX','PCT','KIT','PAR','FR')),\n  concentracao TEXT",
  );

export const catalogoV6 = {
  version: 6,
  name: '0006-catalogo-generalista',
  sql: `
CREATE TEMP TABLE mnr_produtos_0006 AS SELECT * FROM produtos;
CREATE TEMP TABLE mnr_produtos_seq_0006 AS SELECT seq FROM sqlite_sequence WHERE name='produtos';
DROP TABLE produtos;
${products}
INSERT INTO produtos (id,sku,codigo_barras,nome,marca_id,categoria_id,volume_microlitros,concentracao,descricao,preco_venda_centavos,estoque_minimo,ativo,criado_em,atualizado_em)
SELECT * FROM mnr_produtos_0006;
DELETE FROM sqlite_sequence WHERE name='produtos' AND NOT EXISTS(SELECT 1 FROM mnr_produtos_seq_0006);
UPDATE sqlite_sequence SET seq=(SELECT seq FROM mnr_produtos_seq_0006) WHERE name='produtos' AND EXISTS(SELECT 1 FROM mnr_produtos_seq_0006);
INSERT INTO sqlite_sequence(name,seq) SELECT 'produtos',seq FROM mnr_produtos_seq_0006 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='produtos');
DROP TABLE mnr_produtos_0006;
DROP TABLE mnr_produtos_seq_0006;
CREATE TRIGGER produtos_sem_exclusao BEFORE DELETE ON produtos
BEGIN SELECT RAISE(ABORT, 'Use inativacao; exclusao proibida'); END;
CREATE TRIGGER estoque_produto_criado AFTER INSERT ON produtos
BEGIN INSERT INTO saldos_estoque VALUES (NEW.id, 0, 0, 0); END;
CREATE TRIGGER produto_unidade_imutavel BEFORE UPDATE OF unidade_comercial ON produtos
WHEN NEW.unidade_comercial<>OLD.unidade_comercial
BEGIN SELECT RAISE(ABORT,'Unidade comercial imutavel'); END;
ALTER TABLE itens_documento ADD COLUMN unidade_historica TEXT NOT NULL DEFAULT 'UN'
CHECK(unidade_historica IN ('UN','CX','PCT','KIT','PAR','FR'));
`,
} as const;
