import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CorrecoesService } from '../../core/correcoes.service';
import type {
  ContextoVendaConsulta,
  DadosDevolucaoVenda,
  RevisaoCorrecao,
  ResultadoCorrecao,
} from '../../../../shared/correcoes-ipc';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { Confirm } from '../../shared/ui/confirm';
import { reais, hojeLocal } from '../estoque/format';

@Component({
  selector: 'mnr-correcao-venda',
  imports: [RouterLink, Button, Field, Confirm],
  templateUrl: './correcao.html',
  styleUrl: './correcao.scss',
})
export class CorrecaoVenda implements OnInit, OnDestroy {
  private readonly service = inject(CorrecoesService);
  private readonly route = inject(ActivatedRoute);
  readonly id = Number(this.route.snapshot.paramMap.get('id'));
  readonly cancelamento = this.route.snapshot.data['cancelamento'] === true;
  readonly contexto = signal<ContextoVendaConsulta | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly stale = signal(false);
  readonly dirty = signal(false);
  readonly readError = signal('');
  readonly message = signal('');
  readonly errors = signal<Record<string, string>>({});
  readonly selecao = signal<
    Record<number, { selected: boolean; quantidade: string; perda: string }>
  >({});
  readonly data = signal(hojeLocal());
  readonly motivo = signal('');
  readonly reviewed = signal<RevisaoCorrecao | null>(null);
  readonly result = signal<ResultadoCorrecao | null>(null);
  readonly dialog = signal<'confirm' | 'leave' | null>(null);
  readonly description = signal('');
  readonly reais = reais;
  private intention?: ReturnType<CorrecoesService['novaIntencao']>;
  private destroyed = false;
  private leaveResolver?: (v: boolean) => void;
  get locked() {
    return this.loading() || this.busy() || this.uncertain() || this.blocked();
  }
  get eligible() {
    const c = this.contexto();
    return (
      c?.vendaEstado === 'CONFIRMADO' &&
      (this.cancelamento ? c.cancelavel : c.itens.some((i) => i.quantidadeDisponivel > 0))
    );
  }
  ngOnInit() {
    void this.load();
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.leaveResolver?.(false);
  }
  async load() {
    if (this.locked) return;
    this.loading.set(true);
    this.readError.set('');
    this.reviewed.set(null);
    const r = await this.service.consultar((api) => api.obterContextoVenda(this.id));
    if (this.destroyed) return;
    this.loading.set(false);
    if (!r.ok) {
      this.readError.set(r.error.message);
      return;
    }
    this.contexto.set(r.data);
    this.stale.set(false);
  }
  changed() {
    if (this.locked) return;
    this.dirty.set(true);
    this.reviewed.set(null);
    this.errors.set({});
    this.message.set('');
  }
  item(id: number, key: 'selected' | 'quantidade' | 'perda', value: string | boolean) {
    if (this.locked) return;
    this.selecao.update((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { selected: false, quantidade: '', perda: '0' }), [key]: value },
    }));
    this.changed();
  }
  integral() {
    if (this.locked) return;
    this.selecao.set(
      Object.fromEntries(
        this.contexto()!
          .itens.filter((i) => i.quantidadeDisponivel > 0)
          .map((i) => [
            i.id,
            {
              selected: true,
              quantidade: String(i.quantidadeDisponivel),
              perda: this.selecao()[i.id]?.perda ?? '0',
            },
          ]),
      ),
    );
    this.changed();
  }
  private fail(id: string, message: string): never {
    this.errors.set({ [id]: message });
    setTimeout(() => document.getElementById(id)?.focus(), 0);
    throw Error(message);
  }
  private input() {
    const dataEfetiva = this.data(),
      parsed = new Date(`${dataEfetiva}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dataEfetiva) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== dataEfetiva ||
      dataEfetiva > hojeLocal() ||
      dataEfetiva < this.contexto()!.dataComercial
    )
      this.fail(
        'correcao-data',
        'Informe uma data válida, não futura e igual ou posterior à venda.',
      );
    if (!this.motivo().trim() || this.motivo().length > 4000)
      this.fail('correcao-motivo', 'Informe o motivo da correção, com até 4.000 caracteres.');
    const base = { documentoId: this.id, dataEfetiva };
    if (this.cancelamento) return base;
    const itens = this.contexto()!
      .itens.filter((i) => this.selecao()[i.id]?.selected)
      .map((i) => {
        const s = this.selecao()[i.id];
        const quantidade = Number(s.quantidade),
          quantidadePerda = Number(s.perda);
        if (
          !/^\d+$/.test(s.quantidade) ||
          !Number.isSafeInteger(quantidade) ||
          quantidade < 1 ||
          quantidade > i.quantidadeDisponivel
        )
          this.fail(
            `correcao-q-${i.id}`,
            'Informe uma quantidade inteira dentro do disponível para devolução.',
          );
        if (
          !/^\d+$/.test(s.perda) ||
          !Number.isSafeInteger(quantidadePerda) ||
          quantidadePerda < 0 ||
          quantidadePerda > quantidade
        )
          this.fail(
            `correcao-p-${i.id}`,
            'As unidades impróprias devem estar entre zero e a quantidade devolvida.',
          );
        return { itemId: i.id, quantidade, quantidadePerda };
      });
    if (!itens.length) this.fail('correcao-selecao', 'Selecione pelo menos um item para devolver.');
    return { ...base, itens };
  }
  async review() {
    if (this.locked || this.result()) return;
    if (this.stale() || this.readError()) {
      this.message.set('Consulte os dados atuais antes de revisar.');
      return;
    }
    if (!this.eligible) {
      this.message.set(
        'Esta venda não permite esta correção. Use devolução para quantidades restantes ou unidades impróprias.',
      );
      return;
    }
    let dados;
    try {
      dados = this.input();
    } catch (e) {
      this.message.set((e as Error).message);
      return;
    }
    this.busy.set(true);
    this.reviewed.set(null);
    const r = await this.service.consultar((api) =>
      this.cancelamento
        ? api.revisarCancelamentoVenda({ motivo: this.motivo(), dados })
        : api.revisarDevolucaoVenda({ motivo: this.motivo(), dados: dados as DadosDevolucaoVenda }),
    );
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.focus();
      return;
    }
    this.reviewed.set(r.data);
    setTimeout(() => document.getElementById('correcao-revisao')?.focus(), 0);
  }
  prepareConfirm() {
    if (this.locked || !this.reviewed()) return;
    const r = this.reviewed()!;
    this.description.set(
      `${r.venda.numero} · ${r.venda.cliente ?? 'Cliente não informado'}\n${this.cancelamento ? 'Cancelamento integral' : 'Devolução'}: ${reais(r.valorCentavos)}\nData: ${r.dados.dataEfetiva}\nMotivo: ${r.motivo}\nSaldo previsto: ${reais(r.saldoPrevistoCentavos)}\nObrigação de reembolso criada: ${reais(r.reembolsoCriadoCentavos)}\nNenhum reembolso será pago. O documento original será preservado.`,
    );
    this.dialog.set('confirm');
  }
  async confirm() {
    const mode = this.dialog();
    this.dialog.set(null);
    if (mode === 'leave') {
      this.dirty.set(false);
      this.leaveResolver?.(true);
      this.leaveResolver = undefined;
      return;
    }
    if (mode !== 'confirm' || this.locked || !this.reviewed()) return;
    this.intention = this.service.novaIntencao(this.reviewed()!);
    await this.execute();
  }
  async retry() {
    if (this.uncertain() && !this.busy() && this.intention) await this.execute();
  }
  another() {
    if (this.locked || !this.result() || !this.eligible || this.readError()) return;
    this.result.set(null);
    this.selecao.set({});
    this.motivo.set('');
    this.data.set(hojeLocal());
    this.errors.set({});
    this.message.set('');
    this.dirty.set(false);
    setTimeout(() => document.getElementById('correcao-data')?.focus(), 0);
  }
  private async execute() {
    this.busy.set(true);
    const r = await this.intention!.executar();
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.uncertain.set(['IPC_UNAVAILABLE', 'INTERNAL_ERROR', 'BUSY'].includes(r.error.code));
      this.blocked.set(r.error.code === 'IDEMPOTENCY_CONFLICT');
      this.stale.set(r.error.code === 'VERSION_CONFLICT');
      this.reviewed.set(null);
      if (!this.uncertain() && !this.blocked()) this.intention = undefined;
      this.focus();
      return;
    }
    this.result.set(r.data);
    this.uncertain.set(false);
    this.dirty.set(false);
    this.intention = undefined;
    this.reviewed.set(null);
    this.message.set('Correção confirmada. Estoque e financeiro registrados na mesma operação.');
    await this.load();
    if (this.readError())
      this.message.update(
        (m) => m + ' Falhou somente a atualização da consulta. Consulte novamente.',
      );
    this.focus();
  }
  cancel() {
    const mode = this.dialog();
    this.dialog.set(null);
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
    if (mode === 'confirm')
      setTimeout(
        () => document.querySelector<HTMLButtonElement>('#correcao-confirmar button')?.focus(),
        0,
      );
  }
  private focus() {
    setTimeout(() => document.getElementById('correcao-feedback')?.focus(), 0);
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked) {
      this.message.set(
        'Esclareça o resultado da operação antes de sair. Repita a mesma intenção pendente.',
      );
      this.focus();
      return false;
    }
    if (!this.dirty()) return true;
    if (this.leaveResolver) return false;
    this.description.set(
      'Sair sem registrar este preenchimento? Correções já confirmadas permanecem no histórico.',
    );
    this.dialog.set('leave');
    return new Promise((resolve) => (this.leaveResolver = resolve));
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.locked || this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
