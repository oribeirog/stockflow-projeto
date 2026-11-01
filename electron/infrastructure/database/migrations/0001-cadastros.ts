// Immutable after release. SQL is bundled by TypeScript, including inside app.asar.
const references = ['marcas', 'categorias', 'formas_pagamento'];
const people = ['clientes', 'fornecedores'];
const common = `
  ativo INTEGER NOT NULL CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL`;
const restrict = 'ON DELETE RESTRICT ON UPDATE RESTRICT';

export const cadastrosV1 = {
  version: 1,
  name: '0001-cadastros',
  sql: `
CREATE TABLE schema_migrations (
  versao INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  aplicada_em TEXT NOT NULL,
  versao_aplicativo TEXT NOT NULL
) STRICT;
CREATE TABLE metadados_banco (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  identificador TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL,
  moeda TEXT NOT NULL CHECK (moeda = 'BRL'),
  metodo_custeio TEXT NOT NULL CHECK (metodo_custeio = 'MEDIA_PONDERADA_MOVEL'),
  versao_regra_custeio INTEGER NOT NULL CHECK (versao_regra_custeio = 1)
) STRICT;
CREATE TABLE operacoes (
  id TEXT PRIMARY KEY NOT NULL,
  tipo TEXT NOT NULL,
  hash_entrada TEXT NOT NULL,
  resultado_json TEXT NOT NULL CHECK (json_valid(resultado_json)),
  registrado_em TEXT NOT NULL
) STRICT;
${references
  .map(
    (table) => `
CREATE TABLE ${table} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  nome_chave TEXT NOT NULL UNIQUE CHECK (length(nome_chave) > 0),
  ${common}
) STRICT;`,
  )
  .join('\n')}
${people
  .map(
    (table) => `
CREATE TABLE ${table} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  nome_chave TEXT NOT NULL CHECK (length(nome_chave) > 0),
  tipo_pessoa TEXT CHECK (tipo_pessoa IN ('PF','PJ')),
  documento TEXT CHECK (documento IS NULL OR
    (tipo_pessoa IS NOT NULL AND length(documento) IN (11,14))),
  telefone TEXT CHECK (telefone IS NULL OR length(telefone) BETWEEN 1 AND 40),
  email TEXT CHECK (email IS NULL OR length(email) BETWEEN 1 AND 254),
  endereco TEXT CHECK (endereco IS NULL OR length(endereco) BETWEEN 1 AND 4000),
  observacoes TEXT CHECK (observacoes IS NULL OR length(observacoes) BETWEEN 1 AND 4000),
  ${common}
) STRICT;
CREATE UNIQUE INDEX ${table}_documento ON ${table}(documento) WHERE documento IS NOT NULL;
CREATE INDEX ${table}_nome ON ${table}(nome_chave);`,
  )
  .join('\n')}
CREATE TABLE produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE CHECK (length(trim(sku)) BETWEEN 1 AND 64),
  codigo_barras TEXT UNIQUE CHECK (codigo_barras IS NULL OR length(codigo_barras) BETWEEN 1 AND 128),
  nome TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  marca_id INTEGER NOT NULL REFERENCES marcas(id) ${restrict},
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ${restrict},
  volume_microlitros INTEGER NOT NULL CHECK (volume_microlitros BETWEEN 1 AND 1000000000),
  concentracao TEXT CHECK (concentracao IS NULL OR length(concentracao) BETWEEN 1 AND 120),
  descricao TEXT CHECK (descricao IS NULL OR length(descricao) BETWEEN 1 AND 4000),
  preco_venda_centavos INTEGER NOT NULL CHECK (preco_venda_centavos BETWEEN 0 AND 9000000000000),
  estoque_minimo INTEGER NOT NULL CHECK (estoque_minimo BETWEEN 0 AND 1000000000),
  ${common}
) STRICT;
CREATE INDEX produtos_nome ON produtos(ativo, nome);
CREATE INDEX produtos_marca ON produtos(marca_id);
CREATE INDEX produtos_categoria ON produtos(categoria_id);
CREATE TABLE historico_precos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ${restrict},
  preco_anterior_centavos INTEGER CHECK (preco_anterior_centavos BETWEEN 0 AND 9000000000000),
  preco_novo_centavos INTEGER NOT NULL CHECK (preco_novo_centavos BETWEEN 0 AND 9000000000000),
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) BETWEEN 1 AND 4000),
  registrado_em TEXT NOT NULL,
  operacao_id TEXT NOT NULL REFERENCES operacoes(id) ${restrict}
) STRICT;
CREATE INDEX precos_produto ON historico_precos(produto_id, registrado_em, id);
CREATE INDEX precos_operacao ON historico_precos(operacao_id);
CREATE TABLE eventos_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operacao_id TEXT NOT NULL REFERENCES operacoes(id) ${restrict},
  produto_id INTEGER REFERENCES produtos(id) ${restrict},
  cliente_id INTEGER REFERENCES clientes(id) ${restrict},
  fornecedor_id INTEGER REFERENCES fornecedores(id) ${restrict},
  evento TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) BETWEEN 1 AND 4000),
  antes_json TEXT CHECK (antes_json IS NULL OR json_valid(antes_json)),
  depois_json TEXT NOT NULL CHECK (json_valid(depois_json)),
  registrado_em TEXT NOT NULL,
  versao_aplicativo TEXT NOT NULL
) STRICT;
CREATE INDEX auditoria_produto ON eventos_auditoria(produto_id, id);
CREATE INDEX auditoria_cliente ON eventos_auditoria(cliente_id);
CREATE INDEX auditoria_fornecedor ON eventos_auditoria(fornecedor_id);
CREATE INDEX auditoria_operacao ON eventos_auditoria(operacao_id);
${['historico_precos', 'eventos_auditoria', 'schema_migrations', 'metadados_banco']
  .map(
    (table) => `
CREATE TRIGGER ${table}_imutavel BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'Historico imutavel'); END;
CREATE TRIGGER ${table}_sem_exclusao BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'Historico imutavel'); END;`,
  )
  .join('\n')}
${[...references, ...people, 'produtos', 'operacoes']
  .map(
    (table) => `
CREATE TRIGGER ${table}_sem_exclusao BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'Use inativacao; exclusao proibida'); END;`,
  )
  .join('\n')}
CREATE TRIGGER operacoes_finalizadas BEFORE UPDATE ON operacoes
WHEN OLD.resultado_json <> 'null'
BEGIN SELECT RAISE(ABORT, 'Operacao finalizada'); END;
`,
} as const;
