import type Database from 'better-sqlite3';
import { CANAIS_CORRECOES_COMPRAS } from '../../shared/correcoes-compras-ipc';
import { createPurchaseCorrectionService } from '../services/correcoes-compras';
import { ComercialError } from '../services/comercial';
import { EstoqueError } from '../services/estoque-validation';
import { erroCompra } from './compras';
export function criarHandlersCorrecoesCompras(
  db: Database.Database,
  version: string,
  clock?: () => Date,
) {
  const service = createPurchaseCorrectionService(db, version, clock);
  return new Map(
    Object.entries(CANAIS_CORRECOES_COMPRAS).map(([method, channel]) => [
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
                  'Data ou valor inválido.',
                )
              : e,
          );
          if (!result.ok) {
            const messages: Record<string, string> = {
              VALIDATION:
                'Confira os itens, quantidades restantes e em estoque, data, motivo e o reembolso integral já recebido (sem frete/despesas).',
              INVALID_STATE:
                'Compra inelegível: exige confirmação; cancelamento exige ausência de correção efetiva e de movimentos posteriores. Consulte o contexto e as dependências.',
              VERSION_CONFLICT:
                'A compra, o estoque ou os pagamentos mudaram. Consulte e revise novamente, preservando os campos.',
              INACTIVE_REFERENCE:
                'Selecione uma forma de pagamento ativa para o reembolso recebido.',
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
