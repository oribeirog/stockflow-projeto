import type Database from 'better-sqlite3';
import { CANAIS_VENDAS } from '../../shared/vendas-ipc';
import { createSalesService } from '../services/vendas';
import { ComercialError } from '../services/comercial';
import { erroCompra } from './compras';
export function criarHandlersVendas(db: Database.Database, version: string) {
  const service = createSalesService(db, version);
  return new Map(
    Object.entries(CANAIS_VENDAS).map(([method, channel]) => [
      channel,
      (...args: unknown[]) => {
        try {
          if (args.length !== 1) throw new ComercialError('VALIDATION', 'Argumentos inválidos.');
          return { ok: true as const, data: service[method as keyof typeof service](args[0]) };
        } catch (error) {
          const r = erroCompra(error);
          if (!r.ok) {
            const messages: Record<string, string> = {
              BELOW_COST:
                'Preço abaixo do custo atual. Informe motivo em cada item afetado, salve e revise novamente.',
              INSUFFICIENT_STOCK:
                'Estoque insuficiente. Ajuste as quantidades, salve e revise novamente.',
              INACTIVE_REFERENCE:
                'Cliente, produto ou forma de pagamento inativo. Escolha referências ativas e revise novamente.',
              NOT_FOUND: 'Venda ou referência não encontrada.',
              INVALID_STATE: 'Esta venda não permite a operação solicitada.',
            };
            r.error.message = messages[r.error.code] ?? r.error.message;
          }
          return r;
        }
      },
    ]),
  );
}
