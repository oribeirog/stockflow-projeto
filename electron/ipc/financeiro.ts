import type Database from 'better-sqlite3';
import { CANAIS_FINANCEIRO } from '../../shared/financeiro-ipc';
import { CANAIS_CORRECOES } from '../../shared/correcoes-ipc';
import { createFinancialQueryService } from '../services/financeiro-consulta';
import { erroCompra } from './compras';
import { ComercialError } from '../services/comercial';
import { createReceiptService } from '../services/recebimentos';
import { EstoqueError } from '../services/estoque-validation';
import { createSaleCorrectionService } from '../services/correcoes-vendas';
export function criarHandlersConsultasFinanceiras(
  db: Database.Database,
  clock?: () => Date,
  version = 'test',
) {
  const query = createFinancialQueryService(db, clock);
  const receipts = createReceiptService(db, version, clock);
  const methods = { ...query, ...receipts, ...createSaleCorrectionService(db, version, clock) };
  return new Map(
    Object.entries({ ...CANAIS_FINANCEIRO, ...CANAIS_CORRECOES }).map(([method, channel]) => [
      channel,
      (...args: unknown[]) => {
        try {
          if (args.length !== 1) throw new ComercialError('VALIDATION', 'Argumentos inválidos.');
          return { ok: true as const, data: methods[method as keyof typeof methods](args[0]) };
        } catch (error) {
          const result = erroCompra(
            error instanceof EstoqueError
              ? new ComercialError('VALIDATION', 'Data ou valor inválido.')
              : error,
          );
          if (
            [
              'revisarDevolucaoVenda',
              'revisarCancelamentoVenda',
              'devolverVenda',
              'cancelarVenda',
            ].includes(method)
          ) {
            if (!result.ok) {
              const messages: Record<string, string> = {
                VALIDATION:
                  'Confira itens, quantidades disponíveis, unidades impróprias, motivo e data da correção.',
                INVALID_STATE:
                  'Venda indisponível para esta correção. Cancelamento exige venda confirmada sem devolução efetiva anterior.',
                VERSION_CONFLICT:
                  'A venda, o estoque ou o financeiro mudou. Consulte e revise novamente.',
                INTERNAL_ERROR:
                  'Resultado não confirmado. Repita a mesma intenção antes de editar ou sair.',
              };
              result.error.message = messages[result.error.code] ?? result.error.message;
            }
            return result;
          }
          if (method === 'revisarRecebimento' || method === 'registrarRecebimento') {
            if (!result.ok) {
              if (result.error.code === 'VALIDATION')
                result.error.message =
                  'Confira os valores, parcelas, formas, motivo e data do recebimento.';
              if (result.error.code === 'VALIDATION' && error instanceof ComercialError) {
                const messages: Record<string, string> = {
                  'Recebimento excedente ou vazio.':
                    'O pagamento excede o saldo exigível ou está vazio.',
                  'Alocações inválidas.':
                    'A soma das alocações deve corresponder ao valor recebido, sem parcelas repetidas.',
                  'Parcela inválida ou excedente.':
                    'Esta parcela pertence a outra venda ou o valor excede o saldo da parcela.',
                  'Recebimento anterior à venda.': 'Informe uma data igual ou posterior à venda.',
                };
                result.error.message = messages[error.message] ?? result.error.message;
              }
              if (result.error.code === 'VERSION_CONFLICT')
                result.error.message =
                  'O financeiro mudou após a revisão. Consulte e revise novamente.';
              if (result.error.code === 'INACTIVE_REFERENCE')
                result.error.message = 'Esta forma de pagamento está inativa ou não existe.';
              if (result.error.code === 'INVALID_STATE')
                result.error.message = 'Esta venda não permite registrar recebimento.';
            }
            return result;
          }
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
