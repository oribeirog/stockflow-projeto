import { Injectable, inject } from '@angular/core';
import { FinanceiroService } from './financeiro.service';
import type {
  RevisaoOperacaoFinanceira,
  TipoOperacaoFinanceira,
  DadosPagamentoReembolsoPublico,
  DadosEstornoPublico,
  ResultadoOperacaoFinanceira,
  ResultadoConsulta,
} from '../../../shared/financeiro-ipc';
import type { DadosEstornoDevolucaoPublico } from '../../../shared/correcoes-ipc';
type Dados = RevisaoOperacaoFinanceira['dados'];
@Injectable({ providedIn: 'root' })
export class ReembolsosEstornosService {
  private readonly service = inject(FinanceiroService);
  readonly financeiro = this.service.financeiro.bind(this.service);
  readonly correcoes = this.service.correcoes.bind(this.service);
  revisar(tipo: TipoOperacaoFinanceira, motivo: string, dados: Dados) {
    if (tipo === 'PAGAR_REEMBOLSO')
      return this.financeiro((api) =>
        api.revisarPagamentoReembolso({ motivo, dados: dados as DadosPagamentoReembolsoPublico }),
      );
    if (tipo === 'ESTORNAR_RECEBIMENTO')
      return this.financeiro((api) =>
        api.revisarEstornoRecebimento({ motivo, dados: dados as DadosEstornoPublico }),
      );
    if (tipo === 'ESTORNAR_REEMBOLSO')
      return this.financeiro((api) =>
        api.revisarEstornoReembolso({ motivo, dados: dados as DadosEstornoPublico }),
      );
    return this.correcoes((api) =>
      api.revisarEstornoDevolucaoVenda({ motivo, dados: dados as DadosEstornoDevolucaoPublico }),
    );
  }
  novaIntencao(r: RevisaoOperacaoFinanceira) {
    const command = structuredClone({
        operacaoId: crypto.randomUUID(),
        motivo: r.motivo,
        dados: r.dados,
        revisao: r.revisao,
      }),
      tipo = r.tipo;
    let pending: Promise<ResultadoConsulta<ResultadoOperacaoFinanceira>> | undefined;
    const send = () => {
      if (tipo === 'PAGAR_REEMBOLSO')
        return this.financeiro((api) =>
          api.pagarReembolso({
            ...structuredClone(command),
            dados: structuredClone(command.dados) as DadosPagamentoReembolsoPublico,
          }),
        );
      if (tipo === 'ESTORNAR_RECEBIMENTO')
        return this.financeiro((api) =>
          api.estornarRecebimento({
            ...structuredClone(command),
            dados: structuredClone(command.dados) as DadosEstornoPublico,
          }),
        );
      if (tipo === 'ESTORNAR_REEMBOLSO')
        return this.financeiro((api) =>
          api.estornarReembolso({
            ...structuredClone(command),
            dados: structuredClone(command.dados) as DadosEstornoPublico,
          }),
        );
      return this.correcoes((api) =>
        api.estornarDevolucaoVenda({
          ...structuredClone(command),
          dados: structuredClone(command.dados) as DadosEstornoDevolucaoPublico,
        }),
      );
    };
    return {
      operacaoId: command.operacaoId,
      executar: () =>
        (pending ??= send()
          .then((r) =>
            !r.ok && r.error.code === 'IPC_UNAVAILABLE'
              ? {
                  ok: false as const,
                  error: {
                    ...r.error,
                    message:
                      'Resposta não confirmada. Repita a mesma intenção antes de editar ou sair.',
                  },
                }
              : r,
          )
          .finally(() => (pending = undefined))),
    };
  }
}
