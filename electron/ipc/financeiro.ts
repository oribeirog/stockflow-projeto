import type Database from 'better-sqlite3';
import { CANAIS_FINANCEIRO } from '../../shared/financeiro-ipc';
import { CANAIS_CORRECOES } from '../../shared/correcoes-ipc';
import { createFinancialQueryService } from '../services/financeiro-consulta';
import { erroCompra } from './compras';
import { ComercialError } from '../services/comercial';
export function criarHandlersConsultasFinanceiras(db: Database.Database, clock?: () => Date) {
  const query = createFinancialQueryService(db, clock);
  return new Map(
    Object.entries({ ...CANAIS_FINANCEIRO, ...CANAIS_CORRECOES }).map(([method, channel]) => [
      channel,
      (...args: unknown[]) => {
        try {
          if (args.length !== 1) throw new ComercialError('VALIDATION', 'Argumentos inválidos.');
          return { ok: true as const, data: query[method as keyof typeof query](args[0]) };
        } catch (error) {
          const result = erroCompra(error);
          if (!result.ok) {
            if (result.error.code === 'NOT_FOUND')
              result.error.message = 'Registro financeiro ou vínculo não encontrado.';
            if (result.error.code === 'VALIDATION')
              result.error.message =
                'Confira os filtros, datas, identificadores e limites da consulta.';
            if (result.error.code === 'INTERNAL_ERROR')
              result.error.message =
                'Não foi possível consultar os dados financeiros. Tente consultar novamente.';
            if (result.error.code === 'BUSY')
              result.error.message = 'Banco ocupado. Tente consultar novamente.';
            if (result.error.code === 'INTEGRITY')
              result.error.message =
                'Não foi possível consultar com segurança. Os dados foram preservados.';
          }
          return result;
        }
      },
    ]),
  );
}
