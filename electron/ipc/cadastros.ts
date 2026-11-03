import type Database from 'better-sqlite3';
import {
  CANAIS_CADASTROS,
  MENSAGENS_CADASTRO,
  type ResultadoCadastro,
  type CodigoErroDesktopCadastro,
} from '../../shared/cadastros-ipc';
import { createCatalogService } from '../services/catalogos';
import { CadastroError, identifier } from '../services/catalog-validation';
import { FotoError } from '../services/foto-validation';

export function erroCadastro(error: unknown): ResultadoCadastro<never> {
  let code: CodigoErroDesktopCadastro = 'INTERNAL_ERROR';
  if (error instanceof CadastroError || error instanceof FotoError) code = error.code;
  else if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    if (/^SQLITE_(BUSY|LOCKED)(_|$)/.test(error.code)) code = 'DATABASE_BUSY';
    else if (/^SQLITE_(CORRUPT|NOTADB)(_|$)/.test(error.code)) code = 'INTEGRITY';
    else if (error.code.startsWith('SQLITE_CONSTRAINT')) code = 'CONFLICT';
  }
  return { ok: false, error: { code, message: MENSAGENS_CADASTRO[code] } };
}

// Only these closed-over operations are registered. No renderer-controlled kind/table.
export function criarHandlersCadastros(db: Database.Database, version: string) {
  const service = createCatalogService(db, version);
  const handlers = new Map<string, (...args: unknown[]) => ResultadoCadastro<unknown>>();
  function add(channel: string, operation: (input: unknown) => unknown) {
    handlers.set(channel, (...args) => {
      try {
        if (args.length !== 1) throw new CadastroError('VALIDATION', 'Argumentos inválidos.');
        return { ok: true, data: operation(args[0]) };
      } catch (error) {
        return erroCadastro(error);
      }
    });
  }
  const p = CANAIS_CADASTROS.produtos;
  add(p.listar, (input) => service.listProducts(input === undefined ? null : input));
  add(p.obter, (id) => service.getProduct(identifier(id)));
  add(p.salvar, (input) => service.saveProduct(input));
  for (const [name, kind] of [
    ['marcas', 'MARCA'],
    ['categorias', 'CATEGORIA'],
  ] as const) {
    const c = CANAIS_CADASTROS[name];
    add(c.listar, (input) => service.listReferences(kind, input === undefined ? null : input));
    add(c.obter, (id) => service.getReference(kind, identifier(id)));
    add(c.salvar, (input) => service.saveReference(kind, input));
  }
  for (const [name, kind] of [
    ['clientes', 'CLIENTE'],
    ['fornecedores', 'FORNECEDOR'],
  ] as const) {
    const c = CANAIS_CADASTROS[name];
    add(c.listar, (input) => service.listPeople(kind, input === undefined ? null : input));
    add(c.obter, (id) => service.getPerson(kind, identifier(id)));
    add(c.salvar, (input) => service.savePerson(kind, input));
  }
  return handlers;
}
