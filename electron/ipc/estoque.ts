import type Database from 'better-sqlite3';
import {
  CANAIS_ESTOQUE,
  MENSAGENS_ESTOQUE,
  type CodigoErroDesktopEstoque,
  type ResultadoDesktopEstoque,
} from '../../shared/estoque-ipc';
import { CadastroError, record } from '../services/catalog-validation';
import { EstoqueError } from '../services/estoque-validation';
import { createStockService } from '../services/estoque';
import { createStockQueryService } from '../services/estoque-consulta';

export function erroEstoque(error: unknown): ResultadoDesktopEstoque<never> {
  let code: CodigoErroDesktopEstoque = 'INTERNAL_ERROR';
  if (error instanceof EstoqueError) code = error.code;
  else if (error instanceof CadastroError) code = 'VALIDATION';
  else {
    const native = (error as { code?: string } | null)?.code;
    if (typeof native === 'string') {
      if (/^SQLITE_(BUSY|LOCKED)/.test(native)) code = 'BUSY';
      else if (/^SQLITE_(CORRUPT|NOTADB|CONSTRAINT)/.test(native)) code = 'INTEGRITY';
    }
  }
  return { ok: false, error: { code, message: MENSAGENS_ESTOQUE[code] } };
}
export function criarHandlersEstoque(db: Database.Database, version: string) {
  const stock = createStockService(db, version);
  const query = createStockQueryService(db, version);
  const handlers = new Map<string, (...args: unknown[]) => ResultadoDesktopEstoque<unknown>>();
  function add(channel: string, operation: (input: unknown) => unknown) {
    handlers.set(channel, (...args) => {
      try {
        if (args.length !== 1) throw new EstoqueError('VALIDATION', 'Argumentos inválidos.');
        return { ok: true, data: operation(args[0]) };
      } catch (error) {
        return erroEstoque(error);
      }
    });
  }
  add(CANAIS_ESTOQUE.listar, query.listar);
  add(CANAIS_ESTOQUE.obter, query.obter);
  add(CANAIS_ESTOQUE.listarMovimentacoes, query.listarMovimentacoes);
  for (const [method, keys] of [
    ['registrarEntrada', ['produtoId', 'quantidade', 'custoTotalCentavos']],
    ['registrarSaida', ['produtoId', 'quantidade']],
    ['registrarPerda', ['produtoId', 'quantidade']],
    [
      'registrarContagem',
      ['produtoId', 'quantidadeContada', 'versaoEsperada', 'custoTotalCentavos'],
    ],
  ] as const)
    add(CANAIS_ESTOQUE[method], (input) => {
      const envelope = record(input, ['operacaoId', 'motivo', 'dataEfetiva', 'dados']);
      record(envelope['dados'], keys);
      return stock[method](input);
    });
  return handlers;
}
