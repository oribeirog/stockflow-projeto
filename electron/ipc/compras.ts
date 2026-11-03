import type Database from 'better-sqlite3';
import {
  CANAIS_COMPRAS,
  MENSAGENS_COMPRAS,
  type CodigoErroCompra,
  type ResultadoCompra,
} from '../../shared/compras-ipc';
import { createPurchaseService } from '../services/compras';
import { ComercialError } from '../services/comercial';
import { CadastroError } from '../services/catalog-validation';

export function erroCompra(error: unknown): ResultadoCompra<never> {
  let code: CodigoErroCompra = 'INTERNAL_ERROR';
  if (error instanceof ComercialError) code = error.code;
  else if (error instanceof CadastroError)
    code = error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION';
  else if (error instanceof RangeError) code = 'VALIDATION';
  else {
    const sql = (error as { code?: string } | null)?.code;
    if (typeof sql === 'string' && /^SQLITE_(BUSY|LOCKED)/.test(sql)) code = 'BUSY';
    else if (
      typeof sql === 'string' &&
      /^SQLITE_(CONSTRAINT|CORRUPT|NOTADB|ERROR|TOOBIG)/.test(sql)
    )
      code = 'INTEGRITY';
  }
  return { ok: false, error: { code, message: MENSAGENS_COMPRAS[code] } };
}
export function criarHandlersCompras(db: Database.Database, version: string) {
  const service = createPurchaseService(db, version);
  const handlers = new Map<string, (...args: unknown[]) => ResultadoCompra<unknown>>();
  for (const method of Object.keys(CANAIS_COMPRAS) as (keyof typeof CANAIS_COMPRAS)[]) {
    handlers.set(CANAIS_COMPRAS[method], (...args) => {
      try {
        if (args.length !== 1) throw new ComercialError('VALIDATION', 'Argumentos inválidos.');
        return { ok: true, data: service[method](args[0]) };
      } catch (error) {
        return erroCompra(error);
      }
    });
  }
  return handlers;
}
