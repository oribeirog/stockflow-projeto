import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ReembolsosEstornosService } from '../../core/reembolsos-estornos.service';
import { FormasPagamentoService } from '../../core/cadastros/formas-pagamento.service';
import type { Referencia } from '../../../../shared/catalogos';
import type {
  TipoOperacaoFinanceira,
  RevisaoOperacaoFinanceira,
  ResultadoOperacaoFinanceira,
  VendaFinanceira,
  DetalheReembolso,
  DetalheMovimentoFinanceiro,
  ElegibilidadeEstorno,
} from '../../../../shared/financeiro-ipc';
import type { DetalheCorrecao } from '../../../../shared/correcoes-ipc';
import { EstornoElegibilidade } from '../../shared/ui/estorno-elegibilidade';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { Confirm } from '../../shared/ui/confirm';
import { decimalInteger } from '../../../../shared/perfume-values';
import { reais, hojeLocal } from '../estoque/format';
@Component({
  selector: 'mnr-operacao-financeira',
  imports: [RouterLink, Button, Field, Confirm, EstornoElegibilidade],
  templateUrl: './operacao.html',
  styleUrl: './financeiro.scss',
})
export class OperacaoFinanceira implements OnInit, OnDestroy {
  private readonly service = inject(ReembolsosEstornosService);
  private readonly forms = inject(FormasPagamentoService);
  private readonly route = inject(ActivatedRoute);
  readonly summaryFields = [
    ['valorOriginalCentavos', 'Valor original'],
    ['valorComercialLiquidoCentavos', 'Comercial líquido'],
    ['recebimentosEfetivosCentavos', 'Recebimentos brutos'],
    ['estornosRecebimentoCentavos', 'Estornos de recebimento'],
    ['abatimentosDividaCentavos', 'Abatimentos líquidos'],
    ['saldoReceberCentavos', 'Saldo exigível'],
    ['reembolsosPagosCentavos', 'Reembolsos pagos brutos'],
    ['estornosReembolsoCentavos', 'Estornos de pagamentos'],
    ['reembolsosPendentesCentavos', 'Reembolso pendente'],
  ] as const;
  readonly id = Number(this.route.snapshot.paramMap.get('id'));
  readonly vendaId = Number(
    this.route.snapshot.paramMap.get('vendaId') ?? this.route.snapshot.queryParamMap.get('vendaId'),
  );
  readonly mode = this.route.snapshot.data['operacaoFinanceira'] as
    | 'pagar'
    | 'movimento'
    | 'devolucao';
  readonly venda = signal<VendaFinanceira | null>(null);
  readonly reembolso = signal<DetalheReembolso | null>(null);
  readonly movimento = signal<DetalheMovimentoFinanceiro | null>(null);
  readonly correcao = signal<DetalheCorrecao | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly stale = signal(false);
  readonly dirty = signal(false);
  readonly readError = signal('');
  readonly message = signal('');
  readonly errors = signal<Record<string, string>>({});
  readonly data = signal(hojeLocal());
  readonly motivo = signal('');
  readonly payments = signal<{ id: number; valor: string }[]>([{ id: 0, valor: '' }]);
  readonly formas = signal<Referencia[]>([]);
  readonly busca = signal('');
  readonly moreForms = signal(false);
  readonly formError = signal('');
  readonly reviewed = signal<RevisaoOperacaoFinanceira | null>(null);
  readonly result = signal<ResultadoOperacaoFinanceira | null>(null);
  readonly dialog = signal<'confirm' | 'leave' | null>(null);
  readonly description = signal('');
  readonly reais = reais;
  private intention?: ReturnType<ReembolsosEstornosService['novaIntencao']>;
  private destroyed = false;
  private sequence = 0;
  private formSequence = 0;
  private offset = 0;
  private leaveResolver?: (v: boolean) => void;
  private knownForms = new Map<number, string>();
  get tipo(): TipoOperacaoFinanceira {
    return this.mode === 'pagar'
      ? 'PAGAR_REEMBOLSO'
      : this.mode === 'devolucao'
        ? 'ESTORNAR_DEVOLUCAO'
        : this.movimento()?.natureza === 'RECEBIMENTO_CLIENTE'
          ? 'ESTORNAR_RECEBIMENTO'
          : 'ESTORNAR_REEMBOLSO';
  }
  get title() {
    return this.mode === 'pagar'
      ? 'Pagar reembolso'
      : this.mode === 'devolucao'
        ? 'Estornar devolução de venda'
        : this.tipo === 'ESTORNAR_RECEBIMENTO'
          ? 'Estornar recebimento'
          : 'Estornar pagamento de reembolso';
  }
  get locked() {
    return this.loading() || this.busy() || this.uncertain() || this.blocked();
  }
  get elegibilidade(): ElegibilidadeEstorno | undefined {
    return this.mode === 'devolucao'
      ? this.correcao()?.elegibilidadeEstorno
      : this.movimento()?.elegibilidadeEstorno;
  }
  get eligible() {
    return this.mode === 'pagar'
      ? !!this.reembolso()?.ativa && (this.reembolso()?.saldoExigivelCentavos ?? 0) > 0
      : !!this.elegibilidade?.permitido;
  }
  get minimumDate() {
    return (
      this.reembolso()?.dataEfetiva ??
      this.movimento()?.dataEfetiva ??
      this.correcao()?.dataEfetiva ??
      ''
    );
  }
  ngOnInit() {
    void this.load();
    if (this.mode === 'pagar') void this.findForms();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.sequence;
    ++this.formSequence;
    this.leaveResolver?.(false);
  }
  async load() {
    if (this.locked) return;
    const seq = ++this.sequence;
    this.loading.set(true);
    this.readError.set('');
    this.reviewed.set(null);
    const v = await this.service.financeiro((api) => api.obterVenda(this.vendaId));
    if (this.destroyed || seq !== this.sequence) return;
    if (!v.ok) {
      this.loading.set(false);
      this.readError.set(v.error.message);
      return;
    }
    this.venda.set(v.data);
    if (this.mode === 'pagar') {
      const r = await this.service.financeiro((api) =>
        api.obterReembolso({ vendaId: this.vendaId, reembolsoId: this.id }),
      );
      if (this.destroyed) return;
      if (r.ok) this.reembolso.set(r.data);
      else this.readError.set(r.error.message);
    } else if (this.mode === 'movimento') {
      const r = await this.service.financeiro((api) =>
        api.obterMovimento({ vendaId: this.vendaId, movimentoId: this.id }),
      );
      if (this.destroyed) return;
      if (r.ok) this.movimento.set(r.data);
      else this.readError.set(r.error.message);
    } else {
      const r = await this.service.correcoes((api) =>
        api.obterDocumento({ vendaId: this.vendaId, documentoId: this.id }),
      );
      if (this.destroyed) return;
      if (r.ok) this.correcao.set(r.data);
      else this.readError.set(r.error.message);
    }
    this.loading.set(false);
    if (!this.readError()) this.stale.set(false);
  }
  changed() {
    if (this.locked) return;
    this.dirty.set(true);
    this.reviewed.set(null);
    this.errors.set({});
    this.message.set('');
  }
  payment(n: number, key: 'id' | 'valor', value: string) {
    if (this.locked) return;
    this.payments.update((rows) =>
      rows.map((p, i) => (i === n ? { ...p, [key]: key === 'id' ? Number(value) : value } : p)),
    );
    this.changed();
  }
  addPayment() {
    if (this.locked || this.payments().length >= 200) return;
    this.payments.update((p) => [...p, { id: 0, valor: '' }]);
    this.changed();
  }
  removePayment(n: number) {
    if (this.locked) return;
    this.payments.update((p) => p.filter((_, i) => i !== n));
    this.changed();
  }
  formName(id: number) {
    return this.knownForms.get(id) ?? `Forma ${id}`;
  }
  containsForm(id: number) {
    return this.formas().some((f) => f.id === id);
  }
  async findForms(more = false) {
    const seq = ++this.formSequence,
      offset = more ? this.offset + 25 : 0;
    this.formError.set('');
    const r = await this.forms.listar({
      ativo: true,
      busca: this.busca(),
      limite: 26,
      deslocamento: offset,
    });
    if (this.destroyed || seq !== this.formSequence) return;
    if (!r.ok) {
      this.formError.set(r.error.message);
      return;
    }
    this.offset = offset;
    for (const f of r.data) this.knownForms.set(f.id, f.nome);
    this.formas.set([...(more ? this.formas() : []), ...r.data.slice(0, 25)]);
    this.moreForms.set(r.data.length > 25);
  }
  private fail(id: string, message: string): never {
    this.errors.set({ [id]: message });
    setTimeout(() => document.getElementById(id)?.focus(), 0);
    throw Error(message);
  }
  private input(): RevisaoOperacaoFinanceira['dados'] {
    const date = this.data(),
      parsed = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      date > hojeLocal() ||
      date < this.minimumDate
    )
      this.fail(
        'operacao-data',
        'Informe data válida, não futura e igual ou posterior à operação original.',
      );
    if (!this.motivo().trim() || this.motivo().length > 4000)
      this.fail('operacao-motivo', 'Informe o motivo, com até 4.000 caracteres.');
    const base = { vendaId: this.vendaId, dataEfetiva: date };
    if (this.mode === 'pagar') {
      if (!this.payments().length)
        this.fail('operacao-pagamentos', 'Adicione uma forma de pagamento.');
      return {
        ...base,
        reembolsoId: this.id,
        pagamentos: this.payments().map((p, n) => {
          if (!p.id) this.fail(`operacao-forma-${n}`, 'Selecione uma forma ativa.');
          const valorCentavos = decimalInteger(p.valor, 2, 1, 9_000_000_000_000);
          if (valorCentavos === null)
            this.fail(
              `operacao-valor-${n}`,
              'Informe valor positivo, com até duas casas decimais.',
            );
          return { formaPagamentoId: p.id, valorCentavos };
        }),
      };
    }
    return this.mode === 'devolucao'
      ? { ...base, documentoId: this.id }
      : { ...base, movimentoId: this.id };
  }
  async review() {
    if (this.locked || this.result()) return;
    if (!this.eligible || this.stale() || this.readError()) {
      this.message.set('Consulte o estado atual e resolva as dependências antes de revisar.');
      return;
    }
    let dados;
    try {
      dados = this.input();
    } catch (e) {
      this.message.set((e as Error).message);
      return;
    }
    this.reviewed.set(null);
    this.busy.set(true);
    const r = await this.service.revisar(this.tipo, this.motivo(), dados);
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      if (r.error.code === 'VALIDATION' || r.error.code === 'INACTIVE_REFERENCE')
        this.errors.set({ 'operacao-pagamentos': r.error.message });
      this.focus();
      return;
    }
    this.reviewed.set(r.data);
    setTimeout(() => document.getElementById('operacao-revisao')?.focus(), 0);
  }
  prepareConfirm() {
    if (this.locked || !this.reviewed()) return;
    const r = this.reviewed()!;
    this.description.set(
      `${this.title}\n${r.venda.vendaNumero} · ${r.venda.clienteNomeHistorico ?? 'Cliente não informado'}\nValor: ${reais(r.valorCentavos)}\nData: ${r.dados.dataEfetiva}\nMotivo: ${r.motivo}\nSaldo exigível previsto: ${reais(r.previsto.saldoReceberCentavos)}\nReembolso pendente previsto: ${reais(r.previsto.reembolsosPendentesCentavos)}\nSomente esta operação será executada. Os registros originais serão preservados.`,
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
    if (!this.busy() && this.uncertain() && this.intention) await this.execute();
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
    this.reviewed.set(null);
    this.intention = undefined;
    this.message.set('Operação confirmada. Os registros e vínculos foram preservados.');
    await this.load();
    if (this.readError())
      this.message.update(
        (m) => m + ' Falhou somente a atualização da consulta; consulte novamente.',
      );
    this.focus();
  }
  another() {
    if (
      this.mode !== 'pagar' ||
      this.locked ||
      !this.eligible ||
      this.readError() ||
      !this.result()
    )
      return;
    this.result.set(null);
    this.payments.set([{ id: 0, valor: '' }]);
    this.motivo.set('');
    this.data.set(hojeLocal());
    this.errors.set({});
    this.message.set('');
    this.dirty.set(false);
  }
  cancel() {
    const mode = this.dialog();
    this.dialog.set(null);
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
    if (mode === 'confirm')
      setTimeout(
        () => document.querySelector<HTMLButtonElement>('#operacao-confirmar button')?.focus(),
        0,
      );
  }
  private focus() {
    setTimeout(() => document.getElementById('operacao-feedback')?.focus(), 0);
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked) {
      this.message.set('Esclareça o resultado pendente antes de sair. Repita a mesma intenção.');
      this.focus();
      return false;
    }
    if (!this.dirty()) return true;
    if (this.leaveResolver) return false;
    this.description.set(
      'Sair sem registrar este preenchimento? Operações já confirmadas permanecem no histórico.',
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
