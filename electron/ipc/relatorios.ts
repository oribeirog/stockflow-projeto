import type Database from 'better-sqlite3';
import { CANAIS_RELATORIOS } from '../../shared/relatorios-ipc';
import type { Result } from '../../shared/contracts';
import { createReportService } from '../services/relatorios';
import { ComercialError } from '../services/comercial';
import { erroCompra } from './compras';
export function criarHandlersRelatorios(db: Database.Database, clock?: () => Date) {
  const s = createReportService(db, clock);
  const handle =
    <T>(query: (input: unknown) => T) =>
    (...args: unknown[]): Result<T> => {
      try {
        if (args.length !== 1) throw new ComercialError('VALIDATION', 'Argumentos inválidos.');
        return { ok: true, data: query(args[0]) };
      } catch (e) {
        const error = erroCompra(e);
        if (!error.ok)
          error.error.message =
            error.error.code === 'VALIDATION'
              ? 'Confira os filtros, o período e a paginação do relatório.'
              : error.error.code === 'NOT_FOUND'
                ? 'Referência de relatório não encontrada.'
                : 'Não foi possível consultar os indicadores com segurança. Tente novamente.';
        return error;
      }
    };
  return new Map<string, (...args: unknown[]) => Result<unknown>>([
    [CANAIS_RELATORIOS.listarMovimentacaoProdutos, handle(s.listarMovimentacaoProdutos)],
    [CANAIS_RELATORIOS.listarTotaisPorForma, handle(s.listarTotaisPorForma)],
    [CANAIS_RELATORIOS.obterResumoGerencial, handle(s.obterResumoGerencial)],
    [CANAIS_RELATORIOS.obterSeriesVendas, handle(s.obterSeriesVendas)],
    [CANAIS_RELATORIOS.obterSeriesRecebimentos, handle(s.obterSeriesRecebimentos)],
    [CANAIS_RELATORIOS.listarVendas, handle(s.listarVendas)],
    [CANAIS_RELATORIOS.listarProdutos, handle(s.listarProdutos)],
    [CANAIS_RELATORIOS.listarClientes, handle(s.listarClientes)],
    [CANAIS_RELATORIOS.listarMovimentos, handle(s.listarMovimentos)],
    [CANAIS_RELATORIOS.listarContasReceber, handle(s.listarContasReceber)],
    [CANAIS_RELATORIOS.listarReembolsos, handle(s.listarReembolsos)],
    [CANAIS_RELATORIOS.obterResumoEstoque, handle(s.obterResumoEstoque)],
    [CANAIS_RELATORIOS.listarSaldos, handle(s.listarSaldos)],
  ]);
}
