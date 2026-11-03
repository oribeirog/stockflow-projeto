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
import { ActivatedRoute, Router } from '@angular/router';
import { ComprasService, IntencaoCompra } from '../../core/compras.service';
import { FornecedoresService } from '../../core/cadastros/fornecedores.service';
import { ProdutosService } from '../../core/cadastros/produtos.service';
import { FormasPagamentoService } from '../../core/cadastros/formas-pagamento.service';
import type { Pessoa, Produto, Referencia } from '../../../../shared/catalogos';
import type {
  Compra,
  DetalheCompra,
  DadosRascunhoCompra,
  DadosConfirmacaoCompra,
  DadosDescarteCompra,
} from '../../../../shared/compras-ipc';
import type { Desconto, PagamentoConfirmacao } from '../../../../shared/comercial';
import { decimalInteger, decimalText } from '../../../../shared/perfume-values';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { Confirm } from '../../shared/ui/confirm';
import { FormasPagamento } from './formas';
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
  selector: 'mnr-compra-editor',
  imports: [Button, Field, Confirm, FormasPagamento],
  templateUrl: './editor.html',
  styleUrl: './compras.scss',
})
export class CompraEditor implements OnInit, OnDestroy {
  private readonly service = inject(ComprasService);
  private readonly suppliers = inject(FornecedoresService);
  private readonly products = inject(ProdutosService);
  private readonly forms = inject(FormasPagamentoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly manageDialog = viewChild<ElementRef<HTMLDialogElement>>('manageDialog');
  readonly doc = signal<Compra | DetalheCompra | null>(null);
  readonly reviewed = signal<Compra | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly stale = signal(false);
  readonly dirty = signal(false);
  readonly message = signal('');
  readonly readError = signal('');
  readonly operationId = signal('');
  readonly items = signal<ItemInput[]>([]);
  readonly payments = signal<PaymentInput[]>([]);
  readonly supplierOptions = signal<Pessoa[]>([]);
  readonly productOptions = signal<Produto[]>([]);
  readonly formOptions = signal<Referencia[]>([]);
  readonly supplierSearch = signal('');
  readonly productSearch = signal('');
  readonly formSearch = signal('');
  readonly supplierMore = signal(false);
  readonly productMore = signal(false);
  readonly formMore = signal(false);
  readonly managing = signal(false);
  readonly formPending = signal(false);
  readonly confirmation = signal<'confirm' | 'discard' | 'leave' | null>(null);
  readonly description = signal('');
  fornecedor = '';
  data = hojeLocal();
  frete = '0,00';
  despesas = '0,00';
  desconto = '0,00';
  descontoTipo: 'CENTAVOS' | 'PONTOS_BASE' = 'CENTAVOS';
  observacoes = '';
  motivo = '';
  readonly reais = reais;
  private intention?:
    | IntencaoCompra<DadosRascunhoCompra>
    | IntencaoCompra<DadosConfirmacaoCompra>
    | IntencaoCompra<DadosDescarteCompra>;
  private action: 'save' | 'confirm' | 'discard' = 'save';
  private reviewFingerprint = '';
  private savedCommercial = '';
  private destroyed = false;
  private sequence = 0;
  private optionSequences = { supplier: 0, product: 0, form: 0 };
  private offsets = { supplier: 0, product: 0, form: 0 };
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
      void this.options('supplier');
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
  private commercialFingerprint() {
    const data = this.draft();
    delete data.id;
    delete data.versaoEsperada;
    return JSON.stringify(data);
  }
  get confirmationReason() {
    return (
      this.motivo.trim() ||
      `Confirmação da compra ${this.doc()?.numero}, versão ${this.doc()?.versao}, após revisão explícita dos pagamentos.`
    );
  }
  invalidate() {
    this.reviewed.set(null);
    this.reviewFingerprint = '';
    if (this.confirmation() !== 'leave') this.confirmation.set(null);
  }
  private fingerprint() {
    return JSON.stringify({
      fornecedor: this.fornecedor,
      data: this.data,
      frete: this.frete,
      despesas: this.despesas,
      desconto: this.desconto,
      descontoTipo: this.descontoTipo,
      observacoes: this.observacoes,
      motivo: this.motivo,
      items: this.items(),
      payments: this.payments(),
    });
  }
  async options(kind: 'supplier' | 'product' | 'form', more = false) {
    const seq = ++this.optionSequences[kind],
      offset = more ? this.offsets[kind] + 25 : 0;
    const query = {
      busca:
        kind === 'supplier'
          ? this.supplierSearch()
          : kind === 'product'
            ? this.productSearch()
            : this.formSearch(),
      ativo: true,
      limite: 26,
      deslocamento: offset,
    };
    const r =
      kind === 'supplier'
        ? await this.suppliers.listar(query)
        : kind === 'product'
          ? await this.products.listar(query)
          : await this.forms.listar(query);
    if (this.destroyed || seq !== this.optionSequences[kind]) return;
    if (!r.ok) {
      this.message.set(r.error.message);
      return;
    }
    this.offsets[kind] = offset;
    if (kind === 'supplier') {
      this.supplierOptions.set([
        ...(more ? this.supplierOptions() : []),
        ...(r.data.slice(0, 25) as Pessoa[]),
      ]);
      this.supplierMore.set(r.data.length > 25);
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
  private adopt(d: Compra, preserve = false) {
    const pending = preserve
      ? {
          fornecedor: this.fornecedor,
          data: this.data,
          frete: this.frete,
          despesas: this.despesas,
          desconto: this.desconto,
          descontoTipo: this.descontoTipo,
          observacoes: this.observacoes,
        }
      : undefined;
    const pendingItems = this.items();
    this.doc.set(d);
    this.fornecedor = String(d.fornecedorId ?? '');
    this.data = d.dataComercial;
    this.frete = decimalText(d.freteCentavos, 2);
    this.despesas = decimalText(d.despesasDiretasCentavos, 2);
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
      await Promise.all([this.options('supplier'), this.options('product'), this.options('form')]);
    }
  }
  addProduct(raw: string) {
    if (this.locked || !raw) return;
    const p = this.productOptions().find((p) => p.id === Number(raw));
    if (!p) return;
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
        unitario: '0,00',
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
      this.invalidate();
    }
  }
  paymentChange(index: number, key: 'id' | 'valor', value: string) {
    if (this.locked) return;
    this.payments.update((p) =>
      p.map((v, n) => (n === index ? { ...v, [key]: key === 'id' ? Number(value) : value } : v)),
    );
    this.invalidate();
  }
  removePayment(index: number) {
    if (!this.locked) {
      this.payments.update((p) => p.filter((_, n) => n !== index));
      this.invalidate();
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
  private draft(): DadosRascunhoCompra {
    return {
      id: this.doc()?.id,
      versaoEsperada: this.doc()?.versao,
      fornecedorId: this.fornecedor ? Number(this.fornecedor) : null,
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
      freteCentavos: this.money(this.frete),
      despesasDiretasCentavos: this.money(this.despesas),
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
    if (this.doc() && !this.dirty()) {
      this.message.set(
        'Rascunho já salvo, sem alterações comerciais. Configure o pagamento e revise.',
      );
      return true;
    }
    try {
      this.validReason();
      this.intention = this.service.intencao('salvarRascunho', this.draft(), this.motivo);
    } catch (e) {
      this.message.set((e as Error).message);
      return false;
    }
    this.action = 'save';
    return this.execute();
  }
  private normalizedPayments(): PagamentoConfirmacao[] {
    const used = new Set<number>();
    return this.payments().map((p) => {
      const valorCentavos = this.money(p.valor);
      if (!p.id || !valorCentavos || used.has(p.id))
        throw Error('Escolha formas distintas e valores positivos para os pagamentos.');
      used.add(p.id);
      return { formaPagamentoId: p.id, valorCentavos };
    });
  }
  paymentSum() {
    try {
      return this.payments()
        .reduce((n, p) => n + BigInt(this.money(p.valor)), 0n)
        .toString();
    } catch {
      return null;
    }
  }
  paymentDifference() {
    const sum = this.paymentSum(),
      d = this.doc();
    return sum !== null && d ? (BigInt(d.totalCentavos) - BigInt(sum)).toString() : null;
  }
  async review() {
    if (this.locked || !this.editable || this.stale() || this.readError()) {
      this.message.set(
        this.uncertain()
          ? 'Repita o mesmo comando para esclarecer o resultado antes de revisar.'
          : 'Aguarde a operação pendente ou consulte a versão atual antes de revisar.',
      );
      return;
    }
    this.invalidate();
    if (this.dirty() || !this.doc()) {
      if (!(await this.save())) return;
    }
    const d = this.doc();
    if (!d || !this.editable) return;
    this.busy.set(true);
    try {
      const payments = this.normalizedPayments();
      if (payments.reduce((n, p) => n + BigInt(p.valorCentavos), 0n) !== BigInt(d.totalCentavos))
        throw Error('A soma dos pagamentos deve corresponder exatamente ao total oficial.');
      if (!d.fornecedorId || !d.itens.length)
        throw Error('Inclua fornecedor e pelo menos um produto.');
      const supplier = await this.suppliers.obter(d.fornecedorId);
      if (!supplier.ok || !supplier.data.ativo) throw Error('Fornecedor indisponível ou inativo.');
      const products = await Promise.all(d.itens.map((i) => this.products.obter(i.produtoId)));
      if (products.some((p) => !p.ok || !p.data.ativo))
        throw Error('Produto indisponível ou inativo.');
      for (const payment of payments) {
        const f = await this.forms.obter(payment.formaPagamentoId);
        if (!f.ok || !f.data.ativo)
          throw Error('Forma de pagamento indisponível ou inativa. Escolha uma forma ativa.');
        this.formOptions.update((rows) => [...rows.filter((row) => row.id !== f.data.id), f.data]);
      }
      if (this.destroyed) return;
      this.reviewed.set(structuredClone(d));
      this.reviewFingerprint = this.fingerprint();
      this.message.set('Revisão oficial pronta. Confira os valores e confirme explicitamente.');
    } catch (e) {
      this.message.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
  prepareConfirm() {
    if (this.locked || !this.reviewed() || this.fingerprint() !== this.reviewFingerprint) {
      this.invalidate();
      this.message.set(
        'Os pagamentos mudaram ou não foram revisados. Revise novamente antes de confirmar.',
      );
      return;
    }
    this.description.set(
      `Compra ${this.doc()!.numero} · versão ${this.reviewed()!.versao}\nTotal oficial: ${reais(this.reviewed()!.totalCentavos)}\n${this.payments()
        .map(
          (p) =>
            `${this.formOptions().find((f) => f.id === p.id)?.nome ?? p.id}: ${reais(this.money(p.valor))}`,
        )
        .join(
          '\n',
        )}\nMotivo da confirmação: ${this.confirmationReason}\nA confirmação registra o pagamento integral e a entrada no estoque.`,
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
        this.doc()!.versao !== this.reviewed()!.versao
      ) {
        this.invalidate();
        this.message.set(
          'O documento ou os pagamentos mudaram. Revise novamente antes de confirmar.',
        );
        return;
      }
      this.intention = this.service.intencao(
        'confirmar',
        {
          id: this.doc()!.id,
          versaoEsperada: this.reviewed()!.versao,
          pagamentos: this.normalizedPayments(),
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
          ? 'Compra confirmada. Estoque e pagamentos registrados.'
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
        fresh.ok ? 'A compra mudou após a gravação. Consulte novamente.' : fresh.error.message,
      );
      this.message.update(
        (m) => m + ' Gravação concluída; falhou somente a atualização da consulta.',
      );
    }
    if (this.action !== 'save') this.payments.set([]);
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
    this.confirmation.set(null);
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked || this.managing()) {
      this.message.set('Conclua a operação pendente antes de sair.');
      return false;
    }
    if (!this.dirty() && !this.payments().length) return true;
    if (this.leaveResolver) return false;
    this.description.set(
      'Sair da edição? O rascunho salvo permanece. Os pagamentos desta sessão precisarão ser preenchidos novamente.',
    );
    this.confirmation.set('leave');
    return new Promise((resolve) => (this.leaveResolver = resolve));
  }
  async back() {
    await this.router.navigate(['/compras']);
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.payments().length || this.locked || this.managing()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
