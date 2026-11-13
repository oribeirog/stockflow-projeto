import type Database from 'better-sqlite3';
import { CANAIS_ESTORNOS_ESTOQUE } from '../../shared/estornos-estoque-ipc';
import { createStockReversalService } from '../services/estornos-estoque';
import { ComercialError } from '../services/comercial';
import { EstoqueError } from '../services/estoque-validation';
import { erroCompra } from './compras';
export function criarHandlersEstornosEstoque(
  db: Database.Database,
  version: string,
  clock?: () => Date,
) {
  const service = createStockReversalService(db, version, clock);
  return new Map(
    Object.entries(CANAIS_ESTORNOS_ESTOQUE).map(([method, channel]) => [
      channel,
      (...args: unknown[]) => {
        try {
          if (args.length !== 1) throw new ComercialError('VALIDATION', 'Argumentos inválidos.');
          return { ok: true as const, data: service[method as keyof typeof service](args[0]) };
        } catch (e) {
          const result = erroCompra(
            e instanceof EstoqueError
              ? new ComercialError(
                  e.code === 'INSUFFICIENT_STOCK' ? 'INSUFFICIENT_STOCK' : 'VALIDATION',
                  'Dados inválidos.',
                )
              : e,
          );
          if (!result.ok) {
            const messages: Record<string, string> = {
              VALIDATION: 'Confira a data efetiva, o motivo e os identificadores do ajuste.',
              NOT_FOUND: 'Ajuste ou vínculo com o produto não encontrado.',
              INVALID_STATE:
                'Este movimento não permite estorno manual. Consulte o ajuste e as dependências.',
              VERSION_CONFLICT:
                'O ajuste, o produto ou o estoque mudou. Consulte e revise novamente.',
              INTERNAL_ERROR:
                'Resultado não confirmado. Repita a mesma intenção antes de editar ou sair.',
            };
            result.error.message = messages[result.error.code] ?? result.error.message;
          }
          return result;
        }
      },
    ]),
  );
}
