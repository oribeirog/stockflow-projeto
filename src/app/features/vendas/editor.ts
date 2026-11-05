import {
  Component,
  HostListener,
  OnInit,
  OnDestroy,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CorrecoesService } from '../../core/correcoes.service';
import type { ContextoVendaConsulta } from '../../../../shared/correcoes-ipc';
import { VendasService, IntencaoVenda } from '../../core/vendas.service';
import { EstoqueService } from '../../core/estoque.service';
import { ClientesService } from '../../core/cadastros/clientes.service';
import { ProdutosService } from '../../core/cadastros/produtos.service';
import { FormasPagamentoService } from '../../core/cadastros/formas-pagamento.service';
import type { Pessoa, Produto, Referencia } from '../../../../shared/catalogos';
import type { Venda, DadosRascunhoVenda } from '../../../../shared/vendas-ipc';
import type { RevisaoVenda } from '../../../../shared/vendas-ipc';
import type { DadosConfirmacao as DadosConfirmacaoVenda } from '../../../../shared/comercial';
type DadosDescarteVenda = { id: number; versaoEsperada: number };
type DetalheVenda = Venda;
import type { Desconto, PagamentoConfirmacao } from '../../../../shared/comercial';
import { decimalInteger, decimalText } from '../../../../shared/perfume-values';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { Confirm } from '../../shared/ui/confirm';
import { FormasPagamento } from '../compras/formas';
import { reais, hojeLocal } from '../estoque/format';

interface ItemInput {
  produtoId: number;
  nome: string;
  quantidade: string;
  unitario: string;
  descontoTipo: 'CENTAVOS' | 'PONTOS_BASE';
  desconto: string;
  motivo: string;
}
interface PaymentInput {
  id: number;
  valor: string;
}
@Component({
  selector: 'mnr-venda-editor',
  imports: [Button, Field, Confirm, FormasPagamento, RouterLink],
  templateUrl: './editor.html',
  styleUrl: './vendas.scss',
})
export class VendaEditor implements OnInit, OnDestroy {
  private readonly service = inject(VendasService);
  get podeDevolver() {
    return (
      this.correctionContext()?.vendaEstado === 'CONFIRMADO' &&
      this.correctionContext()!.itens.some((i) => i.quantidadeDisponivel > 0)
    );
  }
  private readonly correctionsService = inject(CorrecoesService);
  readonly correctionContext = signal<ContextoVendaConsulta | null>(null);
  private readonly stock = inject(EstoqueService);
  readonly saldos = signal<Record<number, number>>({});
  private readonly clients = inject(ClientesService);
  private readonly products = inject(ProdutosService);
  private readonly forms = inject(FormasPagamentoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly manageDialog = viewChild<ElementRef<HTMLDialogElement>>('manageDialog');
  readonly doc = signal<Venda | DetalheVenda | null>(null);
  readonly reviewed = signal<RevisaoVenda | null>(null);
  modalidade: 'A_VISTA' | 'A_PRAZO' = 'A_VISTA';
  entrada = false;
  readonly parcelas = signal<{ valor: string; vencimento: string }[]>([]);
  addParcela() {
    if (this.locked) return;
    this.parcelas.update((p) => [...p, { valor: '', vencimento: hojeLocal() }]);
    this.financialTouch();
  }
  parcelaChange(n: number, key: 'valor' | 'vencimento', value: string) {
    if (this.locked) return;
    this.parcelas.update((p) => p.map((v, i) => (i === n ? { ...v, [key]: value } : v)));
    this.financialTouch();
  }
  removeParcela(n: number) {
    if (this.locked) return;
    this.parcelas.update((p) => p.filter((_, i) => i !== n));
    this.financialTouch();
  }
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly stale = signal(false);
  readonly dirty = signal(false);
  readonly message = signal('');
  readonly financialErrors = signal<Record<string, string>>({});
  readonly readError = signal('');
  readonly operationId = signal('');
  readonly items = signal<ItemInput[]>([]);
  readonly payments = signal<PaymentInput[]>([]);
  readonly clientOptions = signal<Pessoa[]>([]);
  readonly productOptions = signal<Produto[]>([]);
  readonly formOptions = signal<Referencia[]>([]);
  readonly clientSearch = signal('');
  readonly productSearch = signal('');
  readonly formSearch = signal('');
  readonly clientMore = signal(false);
  readonly productMore = signal(false);
  readonly formMore = signal(false);
  readonly managing = signal(false);
  readonly formPending = signal(false);
  readonly confirmation = signal<'confirm' | 'discard' | 'leave' | null>(null);
  readonly description = signal('');
  cliente = '';
  data = hojeLocal();
  desconto = '0,00';
  descontoTipo: 'CENTAVOS' | 'PONTOS_BASE' = 'CENTAVOS';
  observacoes = '';
  motivo = '';
  readonly reais = reais;
  private intention?:
    | IntencaoVenda<DadosRascunhoVenda>
    | IntencaoVenda<DadosConfirmacaoVenda & { revisao: string }>
    | IntencaoVenda<DadosDescarteVenda>;
  private action: 'save' | 'confirm' | 'discard' = 'save';
  private reviewFingerprint = '';
  private savedCommercial = '';
  private destroyed = false;
  private sequence = 0;
  private optionSequences = { client: 0, product: 0, form: 0 };
  private offsets = { client: 0, product: 0, form: 0 };
  private leaveResolver?: (value: boolean) => void;
  get locked() {
    return (
      this.busy() || this.loading() || this.uncertain() || this.blocked() || this.formPending()
    );
  }
  get editable() {
    return !this.doc() || this.doc()!.estado === 'RASCUNHO';
  }
  get historicPayments() {
    const d = this.doc();
    return d && 'pagamentos' in d ? d.pagamentos : [];
  }
  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) void this.load(Number(id));
    else {
      void this.options('client');
      void this.options('product');
      void this.options('form');
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.sequence;
    this.leaveResolver?.(false);
  }
  touch() {
    if (this.locked) return;
    try {
      this.dirty.set(this.commercialFingerprint() !== this.savedCommercial);
    } catch {
      this.dirty.set(true);
    }
    this.invalidate();
  }
  financialTouch() {
    if (this.locked) return;
    this.message.set('');
    this.invalidate();
  }
  changeMode(value: 'A_VISTA' | 'A_PRAZO') {
    if (this.locked || value === this.modalidade) return;
    this.modalidade = value;
    this.entrada = false;
    this.payments.set([]);
    this.parcelas.set([]);
    this.financialTouch();
  }
  changeEntry(value: boolean) {
    if (this.locked) return;
    this.entrada = value;
    if (!value) this.payments.set([]);
    this.financialTouch();
  }
  private commercialFingerprint() {
    const data = this.draft();
    delete data.id;
    delete data.versaoEsperada;
    delete data.modalidadeVenda;
    return JSON.stringify(data);
  }
  get confirmationReason() {
    return (
      this.motivo.trim() ||
      `Confirmação da venda ${this.doc()?.numero}, versão ${this.doc()?.versao}, após revisão explícita do plano financeiro.`
    );
  }
  invalidate() {
    this.financialErrors.set({});
    this.reviewed.set(null);
    this.reviewFingerprint = '';
    if (this.confirmation() !== 'leave') this.confirmation.set(null);
  }
  private fingerprint() {
    return JSON.stringify({
      modalidade: this.modalidade,
      entrada: this.entrada,
      parcelas: this.parcelas(),
      cliente: this.cliente,
      data: this.data,
      desconto: this.desconto,
      descontoTipo: this.descontoTipo,
      observacoes: this.observacoes,
      motivo: this.motivo,
      items: this.items(),
      payments: this.payments(),
    });
  }
  async options(kind: 'client' | 'product' | 'form', more = false) {
    const seq = ++this.optionSequences[kind],
      offset = more ? this.offsets[kind] + 25 : 0;
    const query = {
      busca:
        kind === 'client'
          ? this.clientSearch()
          : kind === 'product'
            ? this.productSearch()
            : this.formSearch(),
      ativo: true,
      limite: 26,
      deslocamento: offset,
    };
    const r =
      kind === 'client'
        ? await this.clients.listar(query)
        : kind === 'product'
          ? await this.products.listar(query)
          : await this.forms.listar(query);
    if (this.destroyed || seq !== this.optionSequences[kind]) return;
    if (!r.ok) {
      this.message.set(r.error.message);
      return;
    }
    this.offsets[kind] = offset;
    if (kind === 'client') {
      this.clientOptions.set([
        ...(more ? this.clientOptions() : []),
        ...(r.data.slice(0, 25) as Pessoa[]),
      ]);
      this.clientMore.set(r.data.length > 25);
    }
    if (kind === 'product') {
      this.productOptions.set([
        ...(more ? this.productOptions() : []),
        ...(r.data.slice(0, 25) as Produto[]),
      ]);
      this.productMore.set(r.data.length > 25);
    }
    if (kind === 'form') {
      this.formOptions.set([...(more ? this.formOptions() : []), ...r.data.slice(0, 25)]);
      this.formMore.set(r.data.length > 25);
    }
  }
  private adopt(d: Venda, preserve = false) {
    this.correctionContext.set(null);
    if (d.estado === 'CONFIRMADO')
      void this.correctionsService
        .consultar((api) => api.obterContextoVenda(d.id))
        .then((r) => {
          if (!this.destroyed && this.doc()?.id === d.id && r.ok)
            this.correctionContext.set(r.data);
        });
    const pending = preserve
      ? {
          cliente: this.cliente,
          data: this.data,
          modalidade: this.modalidade,
          desconto: this.desconto,
          descontoTipo: this.descontoTipo,
          observacoes: this.observacoes,
        }
      : undefined;
    const pendingItems = this.items();
    this.doc.set(d);
    this.cliente = String(d.clienteId ?? '');
    this.data = d.dataComercial;
    this.modalidade = d.modalidadeVenda ?? 'A_VISTA';
    this.desconto = decimalText(d.descontoGlobalCentavos, 2);
    this.descontoTipo = 'CENTAVOS';
    this.observacoes = d.observacoes ?? '';
    this.items.set(
      d.itens.map((i) => ({
        produtoId: i.produtoId,
        nome: i.descricaoHistorica ?? `Produto ${i.produtoId}`,
        quantidade: String(i.quantidade),
        unitario: decimalText(i.valorUnitarioCentavos, 2),
        descontoTipo: 'CENTAVOS',
        desconto: decimalText(i.descontoItemCentavos, 2),
        motivo: i.motivo ?? '',
      })),
    );
    this.savedCommercial = this.commercialFingerprint();
    this.dirty.set(false);
    if (pending) {
      Object.assign(this, pending);
      this.items.set(pendingItems);
      this.touch();
    }
  }
  async load(id = this.doc()?.id ?? Number(this.route.snapshot.paramMap.get('id'))) {
    if (this.locked) return;
    if (this.dirty() && !this.stale()) {
      this.message.set('Salve o preenchimento ou saia da edição antes de recarregar.');
      return;
    }
    const seq = ++this.sequence;
    this.loading.set(true);
    this.readError.set('');
    this.invalidate();
    const r = await this.service.obter(id);
    if (this.destroyed || seq !== this.sequence) return;
    this.loading.set(false);
    if (!r.ok) {
      this.readError.set(r.error.message);
      return;
    }
    if (this.stale() && this.dirty()) {
      if (r.data.estado !== 'RASCUNHO') {
        this.adopt(r.data);
        this.dirty.set(false);
        this.payments.set([]);
      } else {
        this.adopt(r.data, true);
        this.message.set(
          this.dirty()
            ? 'Versão atual consultada. Seu preenchimento foi preservado; confira e salve para revisar novamente.'
            : 'Versão atual consultada. Dados comerciais já salvos; revise novamente.',
        );
      }
    } else this.adopt(r.data);
    this.stale.set(false);
    if (this.editable) {
      await Promise.all([this.options('client'), this.options('product'), this.options('form')]);
    }
  }
  addProduct(raw: string) {
    if (this.locked || !raw) return;
    const p = this.productOptions().find((p) => p.id === Number(raw));
    if (!p) return;
    void this.stock.obter(p.id).then((r) => {
      if (!this.destroyed && r.ok) this.saldos.update((s) => ({ ...s, [p.id]: r.data.quantidade }));
    });
    if (this.items().some((i) => i.produtoId === p.id)) {
      this.message.set('Produto já incluído. Edite sua quantidade.');
      return;
    }
    this.items.update((items) => [
      ...items,
      {
        produtoId: p.id,
        nome: `${p.nome} · ${p.sku}`,
        quantidade: '1',
        unitario: decimalText(p.precoVendaCentavos, 2),
        descontoTipo: 'CENTAVOS',
        desconto: '0,00',
        motivo: '',
      },
    ]);
    this.touch();
  }
  itemChange(index: number, key: keyof Omit<ItemInput, 'produtoId' | 'nome'>, value: string) {
    if (this.locked) return;
    this.items.update((items) => items.map((i, n) => (n === index ? { ...i, [key]: value } : i)));
    this.touch();
  }
  remove(index: number) {
    if (!this.locked) {
      this.items.update((items) => items.filter((_, n) => n !== index));
      this.touch();
    }
  }
  addPayment() {
    if (!this.locked) {
      this.payments.update((p) => [...p, { id: 0, valor: '' }]);
      this.financialTouch();
    }
  }
  paymentChange(index: number, key: 'id' | 'valor', value: string) {
    if (this.locked) return;
    this.payments.update((p) =>
      p.map((v, n) => (n === index ? { ...v, [key]: key === 'id' ? Number(value) : value } : v)),
    );
    this.financialTouch();
  }
  removePayment(index: number) {
    if (!this.locked) {
      this.payments.update((p) => p.filter((_, n) => n !== index));
      this.financialTouch();
    }
  }
  private money(raw: string) {
    const v = decimalInteger(raw, 2, 0, 9_000_000_000_000);
    if (v === null)
      throw Error(
        'Informe valores em reais com até duas casas decimais, dentro do limite permitido.',
      );
    return v;
  }
  private discount(raw: string, tipo: Desconto['tipo']): Desconto {
    const valor = tipo === 'CENTAVOS' ? this.money(raw) : decimalInteger(raw, 2, 0, 10000);
    if (valor === null)
      throw Error('Informe um percentual de 0 a 100, com até duas casas decimais.');
    return { tipo, valor };
  }
  private draft(): DadosRascunhoVenda {
    return {
      id: this.doc()?.id,
      versaoEsperada: this.doc()?.versao,
      clienteId: this.cliente ? Number(this.cliente) : null,
      dataComercial: this.data,
      itens: this.items().map((i) => {
        const quantidade = decimalInteger(i.quantidade, 0, 1, 1_000_000_000);
        if (quantidade === null) throw Error('Informe quantidades inteiras positivas.');
        return {
          produtoId: i.produtoId,
          quantidade,
          valorUnitarioCentavos: this.money(i.unitario),
          desconto: this.discount(i.desconto, i.descontoTipo),
          motivo: i.motivo || null,
        };
      }),
      descontoGlobal: this.discount(this.desconto, this.descontoTipo),
      modalidadeVenda: this.modalidade,
      observacoes: this.observacoes || null,
    };
  }
  private validReason() {
    if (!this.motivo.trim() || this.motivo.length > 4000)
      throw Error('Informe justificativa de até 4.000 caracteres.');
  }
  async save() {
    if (this.locked || !this.editable || this.stale() || this.readError()) return false;
    this.invalidate();
    if (this.doc() && !this.dirty() && this.doc()!.modalidadeVenda === this.modalidade) {
      this.message.set(
        'Rascunho já salvo, sem alterações comerciais. Configure o pagamento e revise.',
      );
      return true;
    }
    try {
      const modeOnly = !!this.doc() && !this.dirty();
      if (!modeOnly) this.validReason();
      this.intention = this.service.intencao(
        'salvarRascunho',
        this.draft(),
        modeOnly
          ? `Atualização da modalidade da venda ${this.doc()!.numero} para ${this.modalidade}, preservando os dados comerciais salvos.`
          : this.motivo,
      );
    } catch (e) {
      this.message.set((e as Error).message);
      return false;
    }
    this.action = 'save';
    return this.execute();
  }
  private normalizedPayments(): PagamentoConfirmacao[] {
    const used = new Set<number>();
    return this.payments().map((p, n) => {
      const valorCentavos = decimalInteger(p.valor, 2, 1, 9_000_000_000_000);
      if (valorCentavos === null)
        this.financialError(
          `pagamento-valor-${n}`,
          `Pagamento ${n + 1}: informe um valor positivo em reais, com até duas casas decimais.`,
        );
      if (!p.id || !valorCentavos || used.has(p.id))
        this.financialError(
          `pagamento-forma-${n}`,
          `Pagamento ${n + 1}: escolha uma forma ativa distinta das demais.`,
        );
      used.add(p.id);
      return { formaPagamentoId: p.id, valorCentavos };
    });
  }
  private financialError(id: string, message: string): never {
    this.financialErrors.set({ [id]: message });
    setTimeout(() => document.getElementById(id)?.focus(), 0);
    throw Error(message);
  }
  private futureDates() {
    if (!this.parcelas().length)
      this.financialError('venda-modalidade', 'A prazo: adicione as parcelas e seus vencimentos.');
    return this.parcelas().map((p, n) => {
      const date = new Date(`${p.vencimento}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== p.vencimento ||
        p.vencimento < this.data
      )
        this.financialError(
          `parcela-data-${n}`,
          `Parcela ${n + 1}: informe um vencimento válido (AAAA-MM-DD), igual ou posterior à data comercial.`,
        );
      return p.vencimento;
    });
  }
  private planForDivision() {
    return {
      id: this.doc()!.id,
      versaoEsperada: this.doc()!.versao,
      comEntrada: this.modalidade === 'A_PRAZO' && this.entrada,
      pagamentos: this.normalizedPayments(),
    };
  }
  private plan() {
    return {
      id: this.doc()!.id,
      versaoEsperada: this.doc()!.versao,
      comEntrada: this.modalidade === 'A_PRAZO' && this.entrada,
      pagamentos: this.normalizedPayments(),
      parcelas:
        this.modalidade === 'A_VISTA'
          ? []
          : this.parcelas().map((p, n) => {
              const valorCentavos = decimalInteger(p.valor, 2, 1, 9_000_000_000_000);
              if (valorCentavos === null)
                this.financialError(
                  `parcela-valor-${n}`,
                  `Parcela ${n + 1}: informe um valor positivo em reais, com até duas casas decimais.`,
                );
              return { valorCentavos, vencimento: p.vencimento };
            }),
    };
  }
  async review(dividir = false) {
    if (this.locked || !this.editable || this.stale() || this.readError()) {
      this.message.set(
        this.uncertain()
          ? 'Repita o mesmo comando para esclarecer o resultado antes de revisar.'
          : 'Aguarde a operação pendente ou consulte a versão atual antes de revisar.',
      );
      return;
    }
    this.invalidate();
    try {
      if (this.dirty() || !this.doc()) {
        if (!(await this.save())) return;
      } else if (this.doc()!.modalidadeVenda !== this.modalidade) {
        if (!(await this.save())) return;
      }
      const dates = this.modalidade === 'A_PRAZO' ? this.futureDates() : [];
      if (this.modalidade === 'A_PRAZO' && !this.cliente)
        this.financialError('venda-cliente', 'A prazo: selecione um cliente antes de revisar.');
      const input = dividir ? { ...this.planForDivision(), parcelas: [] } : this.plan();
      const paid = input.pagamentos.reduce((n, p) => n + BigInt(p.valorCentavos), 0n);
      const total = BigInt(this.doc()!.totalCentavos);
      if (
        this.modalidade === 'A_VISTA'
          ? paid !== total
          : this.entrada
            ? paid <= 0n || paid >= total
            : paid !== 0n
      )
        this.financialError(
          'venda-modalidade',
          this.modalidade === 'A_VISTA'
            ? 'À vista: a soma dos pagamentos deve ser exatamente igual ao total oficial.'
            : this.entrada
              ? 'A entrada deve ser positiva e inferior ao total. Informe as formas de recebimento da entrada.'
              : 'A prazo sem entrada: remova os pagamentos iniciais ou marque Com entrada inicial.',
        );
      if (
        !dividir &&
        this.modalidade === 'A_PRAZO' &&
        input.parcelas.reduce((n, p) => n + BigInt(p.valorCentavos), 0n) !== total - paid
      )
        this.financialError(
          'parcela-valor-0',
          'A soma das parcelas deve corresponder exatamente ao saldo futuro (total menos entrada).',
        );
      this.busy.set(true);
      const r = await this.service.revisarPlano(
        dividir
          ? {
              ...input,
              parcelas: [],
              dividir: { vencimentos: dates },
            }
          : input,
      );
      if (this.destroyed) return;
      if (!r.ok) {
        this.message.set(r.error.message);
        this.stale.set(r.error.code === 'VERSION_CONFLICT');
        return;
      }
      this.parcelas.set(
        r.data.plano.parcelas!.map((p) => ({
          valor: decimalText(p.valorCentavos, 2),
          vencimento: p.vencimento,
        })),
      );
      this.reviewed.set(r.data);
      this.reviewFingerprint = this.fingerprint();
      this.message.set('Revisão oficial pronta. Estoque e custo serão revalidados na confirmação.');
    } catch (e) {
      this.message.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
  prepareConfirm() {
    if (this.locked || !this.reviewed() || this.fingerprint() !== this.reviewFingerprint) {
      this.invalidate();
      this.message.set('O plano mudou ou não foi revisado. Revise novamente antes de confirmar.');
      return;
    }
    this.description.set(
      `Venda ${this.doc()!.numero} · versão ${this.reviewed()!.plano.versaoEsperada}\nTotal vendido: ${reais(this.reviewed()!.totalCentavos)}\nRecebido na confirmação: ${reais(this.reviewed()!.recebidoConfirmacaoCentavos)}\nSaldo a receber: ${reais(this.reviewed()!.saldoFuturoCentavos)}\n${this.reviewed()!
        .plano.parcelas!.map(
          (p, n) => `Parcela futura ${n + 1}: ${reais(p.valorCentavos)} · ${p.vencimento}`,
        )
        .join('\n')}\n${this.payments()
        .map(
          (p) =>
            `${this.formOptions().find((f) => f.id === p.id)?.nome ?? p.id}: ${reais(this.money(p.valor))}`,
        )
        .join(
          '\n',
        )}\nMotivo da confirmação: ${this.confirmationReason}\nA confirmação registra os pagamentos informados, as parcelas e a baixa do estoque.`,
    );
    this.confirmation.set('confirm');
  }
  prepareDiscard() {
    if (this.locked || !this.doc() || !this.editable || this.stale()) return;
    try {
      this.validReason();
    } catch (e) {
      this.message.set((e as Error).message);
      return;
    }
    this.description.set(
      'O rascunho salvo será descartado, preservando histórico e auditoria. Alterações não salvas não serão incorporadas.\n' +
        this.motivo,
    );
    this.confirmation.set('discard');
  }
  async confirm() {
    const mode = this.confirmation();
    this.confirmation.set(null);
    if (mode === 'leave') {
      this.dirty.set(false);
      this.leaveResolver?.(true);
      this.leaveResolver = undefined;
      return;
    }
    if (this.locked || !this.doc() || !this.editable) return;
    if (mode === 'confirm') {
      if (
        !this.reviewed() ||
        this.fingerprint() !== this.reviewFingerprint ||
        this.doc()!.versao !== this.reviewed()!.plano.versaoEsperada
      ) {
        this.invalidate();
        this.message.set('O documento ou plano mudou. Revise novamente antes de confirmar.');
        return;
      }
      this.intention = this.service.intencao(
        this.reviewed()!.plano.comEntrada ? 'confirmarComEntrada' : 'confirmar',
        {
          id: this.reviewed()!.plano.id,
          versaoEsperada: this.reviewed()!.plano.versaoEsperada,
          pagamentos: structuredClone(this.reviewed()!.plano.pagamentos),
          parcelas: structuredClone(this.reviewed()!.plano.parcelas),
          revisao: this.reviewed()!.revisao,
        },
        this.confirmationReason,
      );
      this.action = 'confirm';
    } else if (mode === 'discard') {
      this.intention = this.service.intencao(
        'descartarRascunho',
        { id: this.doc()!.id, versaoEsperada: this.doc()!.versao },
        this.motivo,
      );
      this.action = 'discard';
    } else return;
    await this.execute();
  }
  async retry() {
    if (!this.busy() && this.uncertain() && this.intention) await this.execute();
  }
  private async execute(): Promise<boolean> {
    this.busy.set(true);
    this.operationId.set(this.intention!.operacaoId);
    this.message.set('');
    const r = await this.intention!.executar();
    if (this.destroyed) return false;
    this.busy.set(false);
    if (!r.ok) {
      this.message.set(r.error.message);
      this.uncertain.set(['IPC_UNAVAILABLE', 'BUSY', 'INTERNAL_ERROR'].includes(r.error.code));
      this.blocked.set(r.error.code === 'IDEMPOTENCY_CONFLICT');
      this.stale.set(r.error.code === 'VERSION_CONFLICT');
      this.invalidate();
      if (!this.uncertain() && !this.blocked()) this.intention = undefined;
      return false;
    }
    this.uncertain.set(false);
    this.intention = undefined;
    this.doc.set(r.data);
    this.dirty.set(false);
    this.invalidate();
    this.message.set(
      this.action === 'save'
        ? 'Rascunho salvo.'
        : this.action === 'confirm'
          ? 'Venda confirmada. Estoque e pagamentos registrados.'
          : 'Rascunho descartado com histórico e auditoria.',
    );
    // A failed refresh must never repeat a successful write.
    this.busy.set(true);
    const fresh = await this.service.obter(r.data.id);
    this.busy.set(false);
    if (fresh.ok && fresh.data.versao === r.data.versao) {
      this.adopt(fresh.data);
    } else {
      this.readError.set(
        fresh.ok ? 'A venda mudou após a gravação. Consulte novamente.' : fresh.error.message,
      );
      this.message.update(
        (m) => m + ' Gravação concluída; falhou somente a atualização da consulta.',
      );
    }
    if (this.action !== 'save') {
      this.payments.set([]);
      this.parcelas.set([]);
    }
    return !this.readError();
  }
  async openForms() {
    if (this.locked) return;
    this.invalidate();
    this.managing.set(true);
    setTimeout(() => this.manageDialog()?.nativeElement.showModal(), 0);
  }
  async closeForms() {
    if (this.formPending()) return;
    this.manageDialog()?.nativeElement.close();
    this.managing.set(false);
    this.invalidate();
    setTimeout(
      () => document.querySelector<HTMLButtonElement>('#gerenciar-formas button')?.focus(),
      0,
    );
    await this.options('form');
  }
  cancelConfirmation() {
    const wasConfirm = this.confirmation() === 'confirm';
    this.confirmation.set(null);
    if (wasConfirm)
      setTimeout(
        () => document.querySelector<HTMLButtonElement>('#confirmar-venda button')?.focus(),
        0,
      );
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked || this.managing()) {
      this.message.set('Conclua a operação pendente antes de sair.');
      return false;
    }
    if (!this.dirty() && !this.financialPending) return true;
    if (this.leaveResolver) return false;
    this.description.set(
      'Sair da edição? O rascunho salvo permanece. Pagamentos e vencimentos desta sessão precisarão ser preenchidos novamente.',
    );
    this.confirmation.set('leave');
    return new Promise((resolve) => (this.leaveResolver = resolve));
  }
  async back() {
    await this.router.navigate(['/vendas']);
  }
  private get financialPending() {
    return (
      this.editable &&
      (this.payments().length ||
        this.parcelas().length ||
        this.entrada ||
        this.modalidade !== (this.doc()?.modalidadeVenda ?? 'A_VISTA'))
    );
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.financialPending || this.locked || this.managing()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
