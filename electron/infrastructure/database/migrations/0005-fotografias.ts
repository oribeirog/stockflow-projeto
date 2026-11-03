export const fotografiasV5 = {
  version: 5,
  name: '0005-fotografias',
  sql: `
CREATE TABLE foto_arquivos (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
  largura INTEGER NOT NULL CHECK(largura BETWEEN 1 AND 2048),
  altura INTEGER NOT NULL CHECK(altura BETWEEN 1 AND 2048),
  tamanho INTEGER NOT NULL CHECK(tamanho BETWEEN 1 AND 8388608),
  hash TEXT NOT NULL CHECK(length(hash)=64),
  miniatura_tamanho INTEGER NOT NULL CHECK(miniatura_tamanho BETWEEN 1 AND 262144),
  miniatura_hash TEXT NOT NULL CHECK(length(miniatura_hash)=64),
  miniatura_largura INTEGER NOT NULL CHECK(miniatura_largura BETWEEN 1 AND 160),
  miniatura_altura INTEGER NOT NULL CHECK(miniatura_altura BETWEEN 1 AND 160),
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  estado TEXT NOT NULL CHECK(estado IN ('PREPARADA','PUBLICADA','RETIRADA'))
) STRICT;
CREATE TABLE produto_fotos (
  produto_id INTEGER PRIMARY KEY REFERENCES produtos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  foto_id TEXT NOT NULL UNIQUE REFERENCES foto_arquivos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  atualizado_em TEXT NOT NULL
) STRICT;
CREATE TRIGGER foto_metadados_imutaveis BEFORE UPDATE ON foto_arquivos
WHEN NEW.id<>OLD.id OR NEW.mime<>OLD.mime OR NEW.largura<>OLD.largura OR NEW.altura<>OLD.altura
 OR NEW.tamanho<>OLD.tamanho OR NEW.hash<>OLD.hash OR NEW.miniatura_tamanho<>OLD.miniatura_tamanho
 OR NEW.miniatura_hash<>OLD.miniatura_hash OR NEW.miniatura_largura<>OLD.miniatura_largura
 OR NEW.miniatura_altura<>OLD.miniatura_altura OR NEW.criado_em<>OLD.criado_em OR NEW.expira_em<>OLD.expira_em
BEGIN SELECT RAISE(ABORT, 'Metadados de arquivo imutaveis'); END;
CREATE TRIGGER foto_vinculo_publicado BEFORE INSERT ON produto_fotos
WHEN (SELECT estado FROM foto_arquivos WHERE id=NEW.foto_id)<>'PUBLICADA'
BEGIN SELECT RAISE(ABORT, 'Arquivo nao publicado'); END;
CREATE TRIGGER foto_vinculo_atualizado BEFORE UPDATE ON produto_fotos
WHEN (SELECT estado FROM foto_arquivos WHERE id=NEW.foto_id)<>'PUBLICADA'
BEGIN SELECT RAISE(ABORT, 'Arquivo nao publicado'); END;
CREATE TRIGGER foto_retirada_segura BEFORE UPDATE OF estado ON foto_arquivos
WHEN NEW.estado<>'PUBLICADA' AND EXISTS(SELECT 1 FROM produto_fotos WHERE foto_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'Arquivo ainda vinculado'); END;
`,
} as const;
