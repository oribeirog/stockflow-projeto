import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ElegibilidadeEstorno } from '../../../../shared/financeiro-ipc';
@Component({
  selector: 'mnr-estorno-elegibilidade',
  imports: [RouterLink],
  template: `@if (value(); as e) {
    <section aria-label="Elegibilidade e dependências do estorno">
      <p>{{ e.motivo }}</p>
      @for (d of e.dependencias; track d.tipo + ':' + d.id) {
        <p>
          <a
            [routerLink]="
              d.tipo === 'movimento'
                ? ['/financeiro/vendas', d.vendaId, 'movimentos', d.id]
                : d.tipo === 'correcao'
                  ? ['/vendas/correcoes', d.id]
                  : ['/estoque', d.produtoId]
            "
            [queryParams]="d.tipo === 'correcao' ? { vendaId: d.vendaId } : {}"
            >{{
              d.tipo === 'estoque'
                ? 'Movimentação de estoque'
                : d.tipo === 'movimento'
                  ? 'Movimento financeiro'
                  : 'Documento corretivo'
            }}
            {{ d.id }}</a
          >
        </p>
      }
    </section>
  }`,
})
export class EstornoElegibilidade {
  readonly value = input<ElegibilidadeEstorno>();
}
