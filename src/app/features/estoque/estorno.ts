import { Component, HostListener, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EstornosEstoqueService } from '../../core/estornos-estoque.service';
import type { DetalheAjuste, RevisaoEstornoAjuste } from '../../../../shared/estornos-estoque-ipc';
import type { ResultadoEstoque } from '../../../../shared/estoque';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { Confirm } from '../../shared/ui/confirm';
import { reais, hojeLocal } from './format';
@Component({
  selector: 'mnr-estorno-estoque',
  imports: [RouterLink, Button, Field, Confirm],
  templateUrl: './estorno.html',
  styleUrl: '../compras/correcao.scss',
})
export class EstornoEstoque implements OnInit, OnDestroy {
  private readonly service = inject(EstornosEstoqueService);
  private readonly route = inject(ActivatedRoute);
  readonly produtoId = Number(this.route.snapshot.paramMap.get('id'));
  readonly movimentoId = Number(this.route.snapshot.paramMap.get('movimentoId'));
  readonly contexto = signal<DetalheAjuste | null>(null);
  readonly reviewed = signal<RevisaoEstornoAjuste | null>(null);
  readonly result = signal<ResultadoEstoque | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly stale = signal(false);
  readonly dirty = signal(false);
  readonly readError = signal('');
  readonly message = signal('');
  readonly errors = signal<Record<string, string>>({});
  readonly motivo = signal('');
  readonly data = signal(hojeLocal());
  readonly dialog = signal<'confirm' | 'leave' | null>(null);
  readonly description = signal('');
  readonly reais = reais;
  private destroyed = false;
  private intention?: ReturnType<EstornosEstoqueService['novaIntencao']>;
  private leaveResolver?: (v: boolean) => void;
  get locked() {
    return this.loading() || this.busy() || this.uncertain() || this.blocked();
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
    const r = await this.service.consultar((api) =>
      api.obterAjuste({ produtoId: this.produtoId, movimentoId: this.movimentoId }),
    );
    if (this.destroyed) return;
    this.loading.set(false);
    if (!r.ok) {
      this.readError.set(r.error.message);
      return;
    }
    this.contexto.set(r.data);
    this.stale.set(false);
    if (!this.dirty() && !this.result() && r.data.elegivel) this.focus('estorno-motivo');
  }
  changed() {
    if (this.locked) return;
    this.dirty.set(true);
    this.reviewed.set(null);
    this.errors.set({});
    this.message.set('');
  }
  private focus(id = 'estorno-feedback') {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }
  async review() {
    if (
      this.locked ||
      this.result() ||
      !this.contexto()?.elegivel ||
      this.stale() ||
      this.readError()
    )
      return;
    const motivo = this.motivo().trim(),
      date = this.data(),
      parsed = new Date(`${date}T00:00:00Z`);
    let field = '';
    let error = '';
    if (!motivo || motivo.length > 4000) {
      field = 'estorno-motivo';
      error = 'Informe o motivo, com até 4.000 caracteres.';
    } else if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      date > hojeLocal() ||
      date < this.contexto()!.original.dataEfetiva
    ) {
      field = 'estorno-data';
      error = 'Informe uma data válida, não futura e igual ou posterior ao ajuste.';
    }
    if (error) {
      this.errors.set({ [field]: error });
      this.message.set(error);
      this.focus(field);
      return;
    }
    this.busy.set(true);
    this.reviewed.set(null);
    const r = await this.service.consultar((api) =>
      api.revisarEstorno({
        motivo,
        dados: { produtoId: this.produtoId, movimentoId: this.movimentoId, dataEfetiva: date },
      }),
    );
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.stale.set(
        ['INVALID_STATE', 'VERSION_CONFLICT', 'INSUFFICIENT_STOCK'].includes(r.error.code),
      );
      this.focus();
      return;
    }
    this.reviewed.set(r.data);
    this.focus('estorno-revisao');
  }
  prepareConfirm() {
    if (this.locked || !this.reviewed()) return;
    const r = this.reviewed()!;
    this.description.set(
      `Ajuste #${this.movimentoId} · ${r.contexto.produto.nome} / ${r.contexto.produto.sku}\nEstorno integral: ${r.quantidadeDelta} unidades / ${reais(r.valorDeltaCentavos)}\nSaldo previsto: ${r.quantidadeApos} / ${reais(r.valorAposCentavos)}\nData: ${r.dados.dataEfetiva}\nMotivo: ${r.motivo}\nO original será preservado e o movimento inverso vinculado. Sem movimento financeiro.`,
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
  private async execute() {
    this.busy.set(true);
    const r = await this.intention!.executar();
    if (this.destroyed) return;
    this.busy.set(false);
    this.reviewed.set(null);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.uncertain.set(['IPC_UNAVAILABLE', 'INTERNAL_ERROR', 'BUSY'].includes(r.error.code));
      this.blocked.set(r.error.code === 'IDEMPOTENCY_CONFLICT');
      this.stale.set(
        ['VERSION_CONFLICT', 'INVALID_STATE', 'INSUFFICIENT_STOCK'].includes(r.error.code),
      );
      if (!this.uncertain() && !this.blocked()) this.intention = undefined;
      this.focus();
      return;
    }
    this.result.set(r.data);
    this.dirty.set(false);
    this.uncertain.set(false);
    this.intention = undefined;
    this.message.set('Estorno confirmado. O ajuste original permanece no histórico.');
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
        () => document.querySelector<HTMLButtonElement>('#estorno-confirmar button')?.focus(),
        0,
      );
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked) {
      this.message.set('Esclareça o resultado antes de sair. Repita a mesma intenção pendente.');
      this.focus();
      return false;
    }
    if (!this.dirty()) return true;
    if (this.leaveResolver) return false;
    this.description.set(
      'Sair sem registrar este preenchimento? Estornos confirmados permanecem no histórico.',
    );
    this.dialog.set('leave');
    return new Promise((r) => (this.leaveResolver = r));
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(e: BeforeUnloadEvent) {
    if (this.locked || this.dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  }
}
