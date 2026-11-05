import { Injectable, inject } from '@angular/core';
import { FinanceiroService } from './financeiro.service';
import type {
  RevisaoCorrecao,
  ResultadoCorrecao,
  ComandoCorrecao,
  DadosDevolucaoVenda,
} from '../../../shared/correcoes-ipc';
import type { ResultadoConsulta } from '../../../shared/financeiro-ipc';

@Injectable({ providedIn: 'root' })
export class CorrecoesService {
  private readonly service = inject(FinanceiroService);
  readonly consultar = this.service.correcoes.bind(this.service);
  novaIntencao(revisao: RevisaoCorrecao) {
    const cancelamento = revisao.cancelamento;
    const command = structuredClone({
      operacaoId: crypto.randomUUID(),
      motivo: revisao.motivo,
      dados: revisao.dados,
      revisao: revisao.revisao,
    });
    let pending: Promise<ResultadoConsulta<ResultadoCorrecao>> | undefined;
    return {
      operacaoId: command.operacaoId,
      executar: () =>
        (pending ??= this.consultar((api) =>
          cancelamento
            ? api.cancelarVenda(structuredClone(command))
            : api.devolverVenda(structuredClone(command) as ComandoCorrecao<DadosDevolucaoVenda>),
        )
          .then((result) => {
            if (!result.ok && result.error.code === 'IPC_UNAVAILABLE')
              return {
                ok: false as const,
                error: {
                  ...result.error,
                  message:
                    'Resposta não confirmada. Repita a mesma correção antes de editar ou sair.',
                },
              };
            return result;
          })
          .finally(() => (pending = undefined))),
    };
  }
}
