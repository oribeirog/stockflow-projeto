import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FinanceiroService, IntencaoRecebimento } from '../../core/financeiro.service';
import { FormasPagamentoService } from '../../core/cadastros/formas-pagamento.service';
import type { Referencia } from '../../../../shared/catalogos';
import type {
  ParcelaConsulta,
  RevisaoRecebimento,
  ResultadoRecebimento,
  VendaFinanceira,
} from '../../../../shared/financeiro-ipc';
import type { DadosRecebimento } from '../../../../shared/financeiro';
import { decimalInteger } from '../../../../shared/perfume-values';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { Confirm } from '../../shared/ui/confirm';
import { reais, hojeLocal } from '../estoque/format';

@Component({
  selector: 'mnr-recebimento',
  imports: [RouterLink, Button, Field, Confirm],
  templateUrl: './receber.html',
  styleUrl: './financeiro.scss',
})
export class Receber implements OnInit, OnDestroy {
  private readonly service = inject(FinanceiroService);
  private readonly forms = inject(FormasPagamentoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly id = Number(this.route.snapshot.paramMap.get('id'));
  readonly venda = signal<VendaFinanceira | null>(null);
  readonly parcelas = signal<ParcelaConsulta[]>([]);
  readonly formas = signal<Referencia[]>([]);
  readonly busca = signal('');
  readonly moreForms = signal(false);
  readonly formError = signal('');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly stale = signal(false);
  readonly dirty = signal(false);
  readonly readError = signal('');
  readonly message = signal('');
  readonly errors = signal<Record<string, string>>({});
  readonly payments = signal<{ id: number; valor: string }[]>([{ id: 0, valor: '' }]);
  readonly allocations = signal<Record<number, { selected: boolean; valor: string }>>({});
  readonly manual = signal(!!this.route.snapshot.queryParamMap.get('parcelaId'));
  readonly data = signal(hojeLocal());
  readonly motivo = signal('');
  readonly reviewed = signal<RevisaoRecebimento | null>(null);
  readonly result = signal<ResultadoRecebimento | null>(null);
  readonly operationId = signal('');
  readonly dialog = signal<'confirm' | 'leave' | null>(null);
  readonly description = signal('');
  readonly reais = reais;
  private readonly knownForms = new Map<number, string>();
  formName(id: number) {
    return (
      this.reviewed()?.formas.find((f) => f.id === id)?.nome ??
      this.knownForms.get(id) ??
      `Forma ${id}`
    );
  }
  parcelaName(id: number) {
    return this.parcelas().find((p) => p.id === id)?.numero ?? id;
  }
  private intention?: IntencaoRecebimento;
  private fingerprint = '';
  private destroyed = false;
  private sequence = 0;
  private formSequence = 0;
  private formOffset = 0;
  private leaveResolver?: (value: boolean) => void;
  get locked() {
    return this.loading() || this.busy() || this.uncertain() || this.blocked();
  }
  get eligible() {
    return (
      this.venda()?.vendaEstado === 'CONFIRMADO' &&
      (this.venda()?.resumo.saldoReceberCentavos ?? 0) > 0
    );
  }
  ngOnInit() {
    void this.load();
    void this.findForms();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.sequence;
    ++this.formSequence;
    this.leaveResolver?.(false);
  }
  changed() {
    if (this.locked) return;
    this.dirty.set(true);
    this.reviewed.set(null);
    this.fingerprint = '';
    this.errors.set({});
    this.message.set('');
  }
  private current() {
    return JSON.stringify({
      payments: this.payments(),
      allocations: this.allocations(),
      manual: this.manual(),
      data: this.data(),
      motivo: this.motivo(),
    });
  }
  payment(n: number, key: 'id' | 'valor', value: string) {
    if (this.locked) return;
    this.payments.update((rows) =>
      rows.map((p, i) => (i === n ? { ...p, [key]: key === 'id' ? Number(value) : value } : p)),
    );
    this.changed();
  }
  addPayment() {
    if (this.locked) return;
    this.payments.update((p) => [...p, { id: 0, valor: '' }]);
    this.changed();
  }
  removePayment(n: number) {
    if (this.locked) return;
    this.payments.update((p) => p.filter((_, i) => i !== n));
    this.changed();
  }
  allocation(id: number, key: 'selected' | 'valor', value: boolean | string) {
    if (this.locked) return;
    this.allocations.update((a) => ({
      ...a,
      [id]: { ...(a[id] ?? { selected: false, valor: '' }), [key]: value },
    }));
    this.changed();
  }
  async findForms(more = false) {
    const seq = ++this.formSequence,
      offset = more ? this.formOffset + 25 : 0;
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
    this.formOffset = offset;
    for (const form of r.data) this.knownForms.set(form.id, form.nome);
    this.formas.set([...(more ? this.formas() : []), ...r.data.slice(0, 25)]);
    this.moreForms.set(r.data.length > 25);
  }
  async load() {
    if (this.locked) return;
    const seq = ++this.sequence;
    this.loading.set(true);
    this.readError.set('');
    this.reviewed.set(null);
    this.fingerprint = '';
    const [v, p] = await Promise.all([
      this.service.financeiro((api) => api.obterVenda(this.id)),
      this.allParcelas(),
    ]);
    if (this.destroyed || seq !== this.sequence) return;
    this.loading.set(false);
    if (!v.ok || !p.ok) {
      this.readError.set(!v.ok ? v.error.message : !p.ok ? p.error.message : 'Falha de consulta.');
      return;
    }
    this.venda.set(v.data);
    this.parcelas.set(p.data);
    this.stale.set(false);
    const selected = this.route.snapshot.queryParamMap.get('parcelaId');
    if (selected && !this.dirty()) {
      const row = p.data.find((p) => p.id === Number(selected));
      if (!row) {
        this.readError.set(
          'Esta parcela não pertence à venda. Abra o recebimento pela parcela correta.',
        );
        return;
      }
      this.allocations.set({ [row.id]: { selected: row.saldoCentavos > 0, valor: '' } });
    }
  }
  private async allParcelas() {
    const rows: ParcelaConsulta[] = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const r = await this.service.financeiro((api) =>
        api.listarParcelas({
          vendaId: this.id,
          situacao: 'TODAS',
          limite: 200,
          deslocamento: offset,
        }),
      );
      if (!r.ok) return r;
      rows.push(...r.data.itens);
      if (!r.data.temMais) return { ok: true as const, data: rows };
    }
    return {
      ok: false as const,
      error: {
        code: 'INTEGRITY' as const,
        message: 'Não foi possível carregar todas as parcelas. Consulte novamente.',
      },
    };
  }
  private fail(id: string, message: string): never {
    this.errors.set({ [id]: message });
    setTimeout(() => document.getElementById(id)?.focus(), 0);
    throw Error(message);
  }
  private money(value: string, id: string) {
    const n = decimalInteger(value, 2, 1, 9_000_000_000_000);
    if (n === null) this.fail(id, 'Informe um valor maior que zero, com até duas casas decimais.');
    return n;
  }
  private input(): DadosRecebimento {
    const date = this.data(),
      parsed = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      date > hojeLocal() ||
      date < (this.venda()?.dataComercial ?? '')
    )
      this.fail(
        'receber-data',
        'Informe uma data válida, não futura e igual ou posterior à venda.',
      );
    if (!this.motivo().trim() || this.motivo().length > 4000)
      this.fail('receber-motivo', 'Informe o motivo deste recebimento, com até 4.000 caracteres.');
    if (!this.payments().length)
      this.fail('receber-pagamentos', 'Adicione uma forma de pagamento.');
    const pagamentos = this.payments().map((p, n) => {
      if (!p.id) this.fail(`receber-forma-${n}`, 'Selecione uma forma de pagamento ativa.');
      return { formaPagamentoId: p.id, valorCentavos: this.money(p.valor, `receber-valor-${n}`) };
    });
    const selected = this.parcelas().filter((p) => this.allocations()[p.id]?.selected);
    if (this.manual() && !selected.length)
      this.fail('receber-modalidade', 'Selecione pelo menos uma parcela para a alocação manual.');
    return {
      vendaId: this.id,
      dataEfetiva: date,
      pagamentos,
      ...(this.manual()
        ? {
            alocacoes: selected.map((p) => ({
              parcelaId: p.id,
              valorCentavos: this.money(this.allocations()[p.id].valor, `receber-alocacao-${p.id}`),
            })),
          }
        : {}),
    };
  }
  async review() {
    if (this.locked || this.result()) return;
    if (this.stale() || this.readError()) {
      this.message.set('Consulte os saldos atuais antes de revisar.');
      return;
    }
    if (!this.eligible) {
      this.message.set('Esta venda não possui saldo a receber disponível.');
      return;
    }
    this.reviewed.set(null);
    this.errors.set({});
    let dados: DadosRecebimento;
    try {
      dados = this.input();
    } catch (e) {
      this.message.set((e as Error).message);
      return;
    }
    this.busy.set(true);
    const r = await this.service.financeiro((api) =>
      api.revisarRecebimento({ motivo: this.motivo(), dados }),
    );
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.errors.set({
        [this.manual() ? 'receber-alocacoes' : 'receber-pagamentos']: r.error.message,
      });
      this.focusFeedback();
      return;
    }
    this.reviewed.set(r.data);
    this.fingerprint = this.current();
    this.message.set('Revisão oficial pronta. Confira a distribuição antes de confirmar.');
    setTimeout(() => document.getElementById('receber-revisao')?.focus(), 0);
  }
  prepareConfirm() {
    if (this.locked) return;
    const r = this.reviewed();
    if (!r || this.current() !== this.fingerprint) {
      this.reviewed.set(null);
      this.message.set('O preenchimento mudou. Revise novamente antes de confirmar.');
      return;
    }
    this.description.set(
      `${r.venda.numero} · ${r.venda.cliente ?? 'Cliente não informado'}\nRecebimento: ${reais(r.plano.totalCentavos)}\nData: ${r.dados.dataEfetiva}\nMotivo: ${r.motivo}\n${r.dados.pagamentos.map((p) => `${r.formas.find((f) => f.id === p.formaPagamentoId)?.nome}: ${reais(p.valorCentavos)}`).join('\n')}\nSaldo previsto da venda: ${reais(r.saldoPrevistoCentavos)}\nA confirmação registra dinheiro recebido e suas alocações.`,
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
    if (
      mode !== 'confirm' ||
      this.locked ||
      !this.reviewed() ||
      this.current() !== this.fingerprint
    )
      return;
    this.intention = this.service.novaIntencao(this.reviewed()!);
    this.operationId.set(this.intention.operacaoId);
    await this.execute();
  }
  async retry() {
    if (!this.busy() && this.uncertain() && this.intention) await this.execute();
  }
  another() {
    if (this.locked || !this.result() || !this.eligible || this.readError()) return;
    this.result.set(null);
    this.operationId.set('');
    this.message.set('');
    this.payments.set([{ id: 0, valor: '' }]);
    this.allocations.set({});
    this.manual.set(false);
    this.motivo.set('');
    this.data.set(hojeLocal());
    this.errors.set({});
    this.dirty.set(false);
    setTimeout(() => document.getElementById('receber-data')?.focus(), 0);
  }
  private async execute() {
    this.busy.set(true);
    this.message.set('');
    const r = await this.intention!.executar();
    if (this.destroyed) return;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.uncertain.set(['IPC_UNAVAILABLE', 'INTERNAL_ERROR', 'BUSY'].includes(r.error.code));
      this.blocked.set(r.error.code === 'IDEMPOTENCY_CONFLICT');
      this.stale.set(r.error.code === 'VERSION_CONFLICT');
      this.reviewed.set(null);
      this.fingerprint = '';
      if (!this.uncertain() && !this.blocked()) this.intention = undefined;
      this.focusFeedback();
      return;
    }
    this.result.set(r.data);
    this.uncertain.set(false);
    this.intention = undefined;
    this.dirty.set(false);
    this.reviewed.set(null);
    this.message.set('Recebimento registrado. Dinheiro e alocações confirmados.');
    await this.load(); // Failed reads never replay a committed write.
    if (this.readError())
      this.message.update(
        (m) => m + ' Falhou apenas a atualização da consulta; consulte novamente.',
      );
    this.focusFeedback();
  }
  private focusFeedback() {
    setTimeout(() => document.querySelector<HTMLElement>('.receipt-feedback')?.focus(), 0);
  }
  cancel() {
    const mode = this.dialog();
    this.dialog.set(null);
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
    if (mode === 'confirm')
      setTimeout(
        () => document.querySelector<HTMLButtonElement>('#receber-confirmar button')?.focus(),
        0,
      );
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked) {
      this.message.set('Esclareça o resultado ou conclua a operação pendente antes de sair.');
      this.focusFeedback();
      return false;
    }
    if (!this.dirty()) return true;
    if (this.leaveResolver) return false;
    this.description.set(
      'Sair sem registrar este preenchimento? Recebimentos já confirmados permanecem no histórico.',
    );
    this.dialog.set('leave');
    return new Promise((resolve) => (this.leaveResolver = resolve));
  }
  back() {
    void this.router.navigate(['/financeiro/vendas', this.id]);
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.locked || this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
