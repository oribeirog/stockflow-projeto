import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  Referencia,
  Pessoa,
  Produto,
  TipoReferencia,
  TipoPessoaCadastro,
  HistoricoPreco,
} from '../../shared/catalogos';
import {
  CadastroError,
  MAX_MONEY,
  MAX_QUANTITY,
  record,
  text,
  optionalText,
  integer,
  identifier,
  active,
  nameKey,
  documentNumber,
  canonical,
  invalid,
} from './catalog-validation';

const referenceTables = {
  MARCA: 'marcas',
  CATEGORIA: 'categorias',
  FORMA_PAGAMENTO: 'formas_pagamento',
} as const;
const personTables = { CLIENTE: 'clientes', FORNECEDOR: 'fornecedores' } as const;
const commonFields = 'id, nome, ativo, criado_em AS criadoEm, atualizado_em AS atualizadoEm';
const personFields = `${commonFields}, tipo_pessoa AS tipoPessoa, documento, telefone, email, endereco, observacoes`;
const productFields = `${commonFields}, sku, codigo_barras AS codigoBarras, marca_id AS marcaId,
  categoria_id AS categoriaId, volume_microlitros AS volumeMicrolitros, concentracao, descricao,
  preco_venda_centavos AS precoVendaCentavos, estoque_minimo AS estoqueMinimo`;
const baseKeys = ['id', 'nome', 'ativo'];

type Stored<T> = Omit<T, 'ativo'> & { ativo: number };
function mapped<T extends Referencia>(row: unknown): T {
  const stored = row as Stored<T>;
  return { ...stored, ativo: stored.ativo === 1 } as unknown as T;
}
function choose<T extends Record<string, string>>(tables: T, kind: unknown): T[keyof T] {
  if (typeof kind !== 'string' || !Object.hasOwn(tables, kind)) invalid('tipo de cadastro');
  return tables[kind as keyof T];
}
function base(value: Record<string, unknown>, nameMax: number) {
  const nome = text(value['nome'], 'nome', nameMax);
  if (!nameKey(nome)) invalid('nome');
  return {
    id: value['id'] === undefined ? undefined : identifier(value['id']),
    nome,
    ativo: active(value['ativo']),
  };
}

export function createCatalogService(db: Database.Database, appVersion: string) {
  function get<T extends Referencia>(table: string, fields: string, id: unknown): T {
    const row = db.prepare(`SELECT ${fields} FROM ${table} WHERE id = ?`).get(identifier(id));
    if (!row) throw new CadastroError('NOT_FOUND', 'Cadastro não encontrado.');
    return mapped<T>(row);
  }
  function list<T extends Referencia>(table: string, fields: string, input: unknown): T[] {
    const value = record(input, ['busca', 'ativo', 'limite', 'deslocamento']);
    const search = optionalText(value['busca'], 'busca', 200) ?? '';
    const isActive = active(value['ativo']);
    const limit = value['limite'] === undefined ? 50 : integer(value['limite'], 'limite', 1, 200);
    const offset =
      value['deslocamento'] === undefined
        ? 0
        : integer(value['deslocamento'], 'deslocamento', 0, 1_000_000_000);
    // Product search includes SKU, using the same accent-insensitive normalization as names.
    const expression =
      table === 'produtos' ? 'mnr_nome_chave(nome || char(32) || sku)' : 'nome_chave';
    return db
      .prepare(
        `SELECT ${fields} FROM ${table}
      WHERE instr(${expression}, ?) > 0 AND (? IS NULL OR ativo = ?)
      ORDER BY nome, id LIMIT ? OFFSET ?`,
      )
      .all(
        nameKey(search),
        isActive === undefined ? null : Number(isActive),
        isActive === undefined ? null : Number(isActive),
        limit,
        offset,
      )
      .map((row) => mapped<T>(row));
  }
  // Function is per connection; it is only used for read-side product search.
  db.function('mnr_nome_chave', { deterministic: true }, nameKey);

  function write<T extends Referencia>(
    kind: string,
    command: unknown,
    normalize: (value: unknown) => object,
    save: (
      data: Record<string, unknown>,
      operationId: string,
      reason: string,
      now: string,
    ) => { before: T | null; after: T },
  ): T {
    const envelope = record(command, ['operacaoId', 'motivo', 'dados']);
    const operationId = text(envelope['operacaoId'], 'operacaoId', 100);
    if (!/^[A-Za-z0-9_-]+$/.test(operationId)) invalid('operacaoId');
    const reason = text(envelope['motivo'], 'motivo', 4000);
    const data = normalize(envelope['dados']) as Record<string, unknown>;
    const hash = createHash('sha256')
      .update(canonical({ version: 1, kind, data, reason }))
      .digest('hex');
    try {
      return db
        .transaction(() => {
          const previous = db
            .prepare('SELECT tipo, hash_entrada, resultado_json FROM operacoes WHERE id = ?')
            .get(operationId) as
            | { tipo: string; hash_entrada: string; resultado_json: string }
            | undefined;
          if (previous) {
            if (previous.tipo !== kind || previous.hash_entrada !== hash)
              throw new CadastroError(
                'IDEMPOTENCY_CONFLICT',
                'Chave de operação já usada com outro conteúdo.',
              );
            return JSON.parse(previous.resultado_json) as T;
          }
          const now = new Date().toISOString();
          db.prepare('INSERT INTO operacoes VALUES (?, ?, ?, ?, ?)').run(
            operationId,
            kind,
            hash,
            'null',
            now,
          );
          const { before, after } = save(data, operationId, reason, now);
          db.prepare(
            `INSERT INTO eventos_auditoria
          (operacao_id, produto_id, cliente_id, fornecedor_id, evento, motivo, antes_json, depois_json, registrado_em, versao_aplicativo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            operationId,
            kind === 'PRODUTO' ? after.id : null,
            kind === 'CLIENTE' ? after.id : null,
            kind === 'FORNECEDOR' ? after.id : null,
            `${kind}_${before ? 'ATUALIZADO' : 'CRIADO'}`,
            reason,
            before === null ? null : JSON.stringify(before),
            JSON.stringify(after),
            now,
            appVersion,
          );
          db.prepare('UPDATE operacoes SET resultado_json = ? WHERE id = ?').run(
            JSON.stringify(after),
            operationId,
          );
          return after;
        })
        .immediate();
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('SQLITE_CONSTRAINT')
      ) {
        throw new CadastroError(
          'CONFLICT',
          'Cadastro conflita com uma restrição de integridade ou unicidade.',
        );
      }
      throw error;
    }
  }

  function saveReference(kind: TipoReferencia, command: unknown): Referencia {
    const table = choose(referenceTables, kind);
    return write(
      kind,
      command,
      (input) => base(record(input, baseKeys), 120),
      (data, _operationId, _reason, now) => {
        const before =
          data['id'] === undefined ? null : get<Referencia>(table, commonFields, data['id']);
        const values = [
          data['nome'],
          nameKey(data['nome'] as string),
          Number(data['ativo'] ?? before?.ativo ?? true),
        ];
        let id = before?.id;
        if (before)
          db.prepare(
            `UPDATE ${table} SET nome = ?, nome_chave = ?, ativo = ?, atualizado_em = ? WHERE id = ?`,
          ).run(...values, now, before.id);
        else
          id = Number(
            db
              .prepare(
                `INSERT INTO ${table} (nome, nome_chave, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)`,
              )
              .run(...values, now, now).lastInsertRowid,
          );
        return { before, after: get<Referencia>(table, commonFields, id) };
      },
    );
  }
  function savePerson(kind: TipoPessoaCadastro, command: unknown): Pessoa {
    const table = choose(personTables, kind);
    return write(
      kind,
      command,
      (input) => {
        const value = record(input, [
          ...baseKeys,
          'tipoPessoa',
          'documento',
          'telefone',
          'email',
          'endereco',
          'observacoes',
        ]);
        const type = value['tipoPessoa'] ?? null;
        if (type !== null && type !== 'PF' && type !== 'PJ') invalid('tipoPessoa');
        const email = optionalText(value['email'], 'email', 254);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('email');
        return {
          ...base(value, 200),
          tipoPessoa: type,
          documento: documentNumber(value['documento'], type),
          telefone: optionalText(value['telefone'], 'telefone', 40),
          email,
          endereco: optionalText(value['endereco'], 'endereco', 4000),
          observacoes: optionalText(value['observacoes'], 'observacoes', 4000),
        };
      },
      (data, _operationId, _reason, now) => {
        const before =
          data['id'] === undefined ? null : get<Pessoa>(table, personFields, data['id']);
        const values = [
          data['nome'],
          nameKey(data['nome'] as string),
          data['tipoPessoa'],
          data['documento'],
          data['telefone'],
          data['email'],
          data['endereco'],
          data['observacoes'],
          Number(data['ativo'] ?? before?.ativo ?? true),
        ];
        let id = before?.id;
        if (before)
          db.prepare(
            `UPDATE ${table} SET nome = ?, nome_chave = ?, tipo_pessoa = ?, documento = ?,
        telefone = ?, email = ?, endereco = ?, observacoes = ?, ativo = ?, atualizado_em = ? WHERE id = ?`,
          ).run(...values, now, id);
        else
          id = Number(
            db
              .prepare(
                `INSERT INTO ${table} (nome, nome_chave, tipo_pessoa, documento, telefone, email,
        endereco, observacoes, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(...values, now, now).lastInsertRowid,
          );
        return { before, after: get<Pessoa>(table, personFields, id) };
      },
    );
  }
  function saveProduct(command: unknown): Produto {
    return write(
      'PRODUTO',
      command,
      (input) => {
        const value = record(input, [
          ...baseKeys,
          'sku',
          'codigoBarras',
          'marcaId',
          'categoriaId',
          'volumeMicrolitros',
          'concentracao',
          'descricao',
          'precoVendaCentavos',
          'estoqueMinimo',
        ]);
        return {
          ...base(value, 200),
          sku: text(value['sku'], 'sku', 64).toUpperCase(),
          codigoBarras: optionalText(value['codigoBarras'], 'codigoBarras', 128),
          marcaId: identifier(value['marcaId']),
          categoriaId: identifier(value['categoriaId']),
          volumeMicrolitros: integer(
            value['volumeMicrolitros'],
            'volumeMicrolitros',
            1,
            MAX_QUANTITY,
          ),
          concentracao: optionalText(value['concentracao'], 'concentracao', 120),
          descricao: optionalText(value['descricao'], 'descricao', 4000),
          precoVendaCentavos: integer(
            value['precoVendaCentavos'],
            'precoVendaCentavos',
            0,
            MAX_MONEY,
          ),
          estoqueMinimo: integer(value['estoqueMinimo'], 'estoqueMinimo', 0, MAX_QUANTITY),
        };
      },
      (data, operationId, reason, now) => {
        const before =
          data['id'] === undefined ? null : get<Produto>('produtos', productFields, data['id']);
        // A referenced inactive classification may be retained when editing an existing product.
        for (const [table, field] of [
          ['marcas', 'marcaId'],
          ['categorias', 'categoriaId'],
        ] as const) {
          const reference = get<Referencia>(table, commonFields, data[field]);
          if (!reference.ativo && (!before || before[field] !== reference.id))
            throw new CadastroError(
              'INACTIVE_REFERENCE',
              'Marca/categoria inativa para nova associação.',
            );
        }
        if (before && data['sku'] !== before.sku)
          throw new CadastroError(
            'VALIDATION',
            'SKU é imutável; inative e cadastre outra apresentação.',
          );
        const values = [
          data['sku'],
          data['codigoBarras'],
          data['nome'],
          data['marcaId'],
          data['categoriaId'],
          data['volumeMicrolitros'],
          data['concentracao'],
          data['descricao'],
          data['precoVendaCentavos'],
          data['estoqueMinimo'],
          Number(data['ativo'] ?? before?.ativo ?? true),
        ];
        let id = before?.id;
        if (before)
          db.prepare(
            `UPDATE produtos SET sku = ?, codigo_barras = ?, nome = ?, marca_id = ?, categoria_id = ?,
        volume_microlitros = ?, concentracao = ?, descricao = ?, preco_venda_centavos = ?, estoque_minimo = ?, ativo = ?, atualizado_em = ? WHERE id = ?`,
          ).run(...values, now, id);
        else
          id = Number(
            db
              .prepare(
                `INSERT INTO produtos (sku, codigo_barras, nome, marca_id, categoria_id, volume_microlitros,
        concentracao, descricao, preco_venda_centavos, estoque_minimo, ativo, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(...values, now, now).lastInsertRowid,
          );
        const after = get<Produto>('produtos', productFields, id);
        if (!before || before.precoVendaCentavos !== after.precoVendaCentavos)
          db.prepare(
            `INSERT INTO historico_precos (produto_id, preco_anterior_centavos, preco_novo_centavos, motivo, registrado_em, operacao_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            after.id,
            before?.precoVendaCentavos ?? null,
            after.precoVendaCentavos,
            reason,
            now,
            operationId,
          );
        return { before, after };
      },
    );
  }
  return {
    saveReference,
    savePerson,
    saveProduct,
    getReference: (kind: TipoReferencia, id: number) =>
      get<Referencia>(choose(referenceTables, kind), commonFields, id),
    getPerson: (kind: TipoPessoaCadastro, id: number) =>
      get<Pessoa>(choose(personTables, kind), personFields, id),
    getProduct: (id: number) => get<Produto>('produtos', productFields, id),
    listReferences: (kind: TipoReferencia, input: unknown = {}) =>
      list<Referencia>(choose(referenceTables, kind), commonFields, input),
    listPeople: (kind: TipoPessoaCadastro, input: unknown = {}) =>
      list<Pessoa>(choose(personTables, kind), personFields, input),
    listProducts: (input: unknown = {}) => list<Produto>('produtos', productFields, input),
    priceHistory: (productId: number): HistoricoPreco[] => {
      get<Produto>('produtos', productFields, productId);
      return db
        .prepare(
          `SELECT id, produto_id AS produtoId, preco_anterior_centavos AS precoAnteriorCentavos,
        preco_novo_centavos AS precoNovoCentavos, motivo, registrado_em AS registradoEm, operacao_id AS operacaoId
        FROM historico_precos WHERE produto_id = ? ORDER BY id`,
        )
        .all(productId) as HistoricoPreco[];
    },
  };
}
