import {
  Component,
  HostListener,
  OnInit,
  OnDestroy,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EstoqueService, IntencaoEstoque } from '../../core/estoque.service';
import type {
  AcaoEstoque,
  DadosOperacaoEstoque,
  ProdutoEstoque,
  PaginaMovimentacoes,
} from '../../../../shared/estoque-ipc';
import type { ResultadoEstoque, NaturezaEstoque } from '../../../../shared/estoque';
import { decimalInteger } from '../../../../shared/perfume-values';
import { textoInvalido } from '../pessoas/formulario';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { ContentState } from '../../shared/ui/content-state';
import { Confirm } from '../../shared/ui/confirm';
import { reais, hojeLocal } from './format';

export const acoesEstoque: Record<AcaoEstoque, string> = {
  entrada: 'Entrada manual',
  saida: 'Saída manual',
  perda: 'Registro de perda',
  contagem: 'Contagem física',
};
const naturezas: Record<NaturezaEstoque, string> = {
  AJUSTE_ENTRADA: 'Entrada manual',
  AJUSTE_SAIDA: 'Saída manual',
  PERDA: 'Perda',
  COMPRA: 'Compra',
  VENDA: 'Venda',
  DEV_VENDA: 'Devolução de venda',
  DEV_COMPRA: 'Devolução de compra',
  REVERSAO_ENTRADA: 'Reversão de entrada',
  REVERSAO_SAIDA: 'Reversão de saída',
  PERDA_DEVOLUCAO: 'Perda vinculada à devolução',
};
@Component({
  selector: 'mnr-estoque-detalhe',
  imports: [RouterLink, Button, Field, ContentState, Confirm],
  templateUrl: './detalhe.html',
  styleUrl: './detalhe.scss',
})
export class EstoqueDetalhe implements OnInit, OnDestroy {
  private readonly service = inject(EstoqueService);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly produto = signal<ProdutoEstoque | null>(null);
  readonly history = signal<PaginaMovimentacoes | null>(null);
  readonly loading = signal(false);
  readonly historyLoading = signal(false);
  readonly readError = signal('');
  readonly historyError = signal('');
  readonly message = signal('');
  readonly success = signal(false);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly stale = signal(false);
  readonly dirty = signal(false);
  readonly acao = signal<AcaoEstoque | null>(null);
  readonly quantidade = signal('');
  readonly custo = signal('');
  readonly data = signal(hojeLocal());
  readonly motivo = signal('');
  readonly errors = signal<Record<string, string>>({});
  readonly confirmation = signal<'write' | 'leave' | null>(null);
  readonly review = signal('');
  readonly concluido = signal<ResultadoEstoque | null>(null);
  readonly operationId = signal('');
  readonly labels = acoesEstoque;
  readonly naturezas = naturezas;
  readonly actions = Object.keys(acoesEstoque) as AcaoEstoque[];
  readonly reais = reais;
  readonly today = hojeLocal;
  readonly cursorPage = signal(0);
  private cursors = [0];
  private readSequence = 0;
  private historySequence = 0;
  private destroyed = false;
  private intention?: IntencaoEstoque;
  private prepared?: DadosOperacaoEstoque;
  private leaveResolver?: (answer: boolean) => void;
  get locked() {
    return this.busy() || this.uncertain() || this.blocked();
  }
  get requiresCost() {
    const p = this.produto();
    return (
      this.acao() === 'entrada' ||
      (this.acao() === 'contagem' && !!p && Number(this.quantidade()) > p.quantidade)
    );
  }
  get diferenca() {
    const p = this.produto();
    const q = decimalInteger(this.quantidade(), 0, 0, 1_000_000_000);
    return p && q !== null ? q - p.quantidade : null;
  }
  ngOnInit() {
    void this.refresh();
    void this.loadHistory();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.readSequence;
    ++this.historySequence;
    this.leaveResolver?.(false);
  }
  private id() {
    return Number(this.route.snapshot.paramMap.get('id'));
  }
  private focus(selector: string) {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), 0);
  }
  async refresh() {
    if (this.locked) return;
    const seq = ++this.readSequence;
    this.loading.set(true);
    this.readError.set('');
    const result = await this.service.obter(this.id());
    if (this.destroyed || seq !== this.readSequence) return;
    this.loading.set(false);
    if (!result.ok) {
      this.readError.set(result.error.message);
      return;
    }
    this.produto.set(result.data);
    this.stale.set(false);
    if (this.acao() && !this.concluido()) {
      this.message.set(
        'Saldo atualizado. Confira a quantidade, o custo da sobra e a versão antes de confirmar.',
      );
      this.success.set(false);
    }
  }
  async loadHistory(page = 0) {
    const seq = ++this.historySequence;
    this.historyLoading.set(true);
    this.historyError.set('');
    const result = await this.service.movimentos({
      produtoId: this.id(),
      aposId: this.cursors[page] ?? 0,
      limite: 25,
    });
    if (this.destroyed || seq !== this.historySequence) return;
    this.historyLoading.set(false);
    if (!result.ok) {
      this.historyError.set(result.error.message);
      return;
    }
    this.cursorPage.set(page);
    this.history.set(result.data);
    this.cursors[page + 1] = result.data.proximoId;
  }
  start(action: AcaoEstoque) {
    if (this.locked || this.dirty()) return;
    this.acao.set(action);
    this.quantidade.set('');
    this.custo.set('');
    this.data.set(hojeLocal());
    this.motivo.set('');
    this.errors.set({});
    this.message.set('');
    this.success.set(false);
    this.concluido.set(null);
    this.operationId.set('');
    this.focus('#estoque-quantidade');
  }
  changed(field: 'quantidade' | 'custo' | 'data' | 'motivo', value: string) {
    this[field].set(value);
    this.dirty.set(true);
  }
  prepare() {
    if (this.locked || this.concluido() || this.stale() || this.readError()) return;
    const p = this.produto(),
      action = this.acao();
    if (!p || !action) return;
    const errors: Record<string, string> = {};
    const q = decimalInteger(this.quantidade(), 0, action === 'contagem' ? 0 : 1, 1_000_000_000);
    if (q === null)
      errors['quantidade'] = 'Informe uma quantidade inteira dentro do limite de 1 bilhão.';
    if (q !== null && (action === 'saida' || action === 'perda') && q > p.quantidade)
      errors['quantidade'] = 'Quantidade maior que o saldo disponível.';
    const cost = this.requiresCost
      ? decimalInteger(this.custo(), 2, 0, 9_000_000_000_000)
      : undefined;
    if (cost === null)
      errors['custo'] = 'Informe o custo total em reais, com até duas casas decimais.';
    const date = this.data();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date ||
      date > hojeLocal()
    )
      errors['data'] = 'Informe uma data real, não futura.';
    if (textoInvalido(this.motivo(), 4000, true))
      errors['motivo'] = 'Informe uma justificativa válida de até 4.000 caracteres.';
    this.errors.set(errors);
    if (Object.keys(errors).length) {
      this.focus('[aria-invalid="true"]');
      return;
    }
    this.prepared =
      action === 'contagem'
        ? {
            produtoId: p.produtoId,
            quantidadeContada: q!,
            versaoEsperada: p.versao,
            ...(cost !== undefined ? { custoTotalCentavos: cost! } : {}),
          }
        : {
            produtoId: p.produtoId,
            quantidade: q!,
            ...(cost !== undefined ? { custoTotalCentavos: cost! } : {}),
          };
    this.review.set(
      `${this.labels[action]} · ${p.nome} · SKU ${p.sku}\n${action === 'contagem' ? `Contagem: ${q} · saldo consultado: ${p.quantidade} · diferença: ${this.diferenca} · versão: ${p.versao}` : `Quantidade: ${q} · saldo consultado: ${p.quantidade}`}\n${cost !== undefined ? 'Custo total da entrada: ' + reais(cost!) : action === 'contagem' && this.diferenca === 0 ? 'Sem diferença: somente auditoria, sem movimentação.' : 'Custo definido pelo aplicativo na gravação.'}\nData efetiva: ${date}\nJustificativa: ${this.motivo()}\n${action === 'contagem' && this.diferenca === 0 ? 'O saldo não será alterado.' : 'Esta operação altera o estoque e não registra compra ou pagamento.'}`,
    );
    this.confirmation.set('write');
  }
  async confirm() {
    if (this.confirmation() === 'leave') {
      this.confirmation.set(null);
      this.dirty.set(false);
      this.leaveResolver?.(true);
      this.leaveResolver = undefined;
      return;
    }
    if (this.locked || !this.prepared || !this.acao() || this.confirmation() !== 'write') return;
    this.confirmation.set(null);
    this.intention = this.service.novaIntencao(
      this.acao()!,
      this.prepared,
      this.motivo(),
      this.data(),
    );
    this.operationId.set(this.intention.operacaoId);
    await this.execute();
  }
  async retry() {
    if (this.busy() || !this.uncertain() || !this.intention) return;
    await this.execute();
  }
  private async execute() {
    this.busy.set(true);
    this.message.set('');
    this.success.set(false);
    const result = await this.intention!.executar();
    if (this.destroyed) return;
    this.busy.set(false);
    if (!result.ok) {
      this.message.set(result.error.message);
      this.uncertain.set(['IPC_UNAVAILABLE', 'BUSY', 'INTERNAL_ERROR'].includes(result.error.code));
      this.blocked.set(result.error.code === 'IDEMPOTENCY_CONFLICT');
      this.stale.set(result.error.code === 'VERSION_CONFLICT');
      if (!this.uncertain() && !this.blocked()) this.intention = undefined;
      this.focus('.feedback');
      return;
    }
    this.uncertain.set(false);
    this.intention = undefined;
    this.concluido.set(result.data);
    this.dirty.set(false);
    this.success.set(true);
    this.message.set(
      result.data.movimentacaoId === null
        ? 'Contagem registrada em auditoria, sem diferença e sem movimentação de estoque.'
        : `Operação concluída. Movimento ${result.data.movimentacaoId}. Saldo resultante: ${result.data.saldo.quantidade}.`,
    );
    await this.refresh();
    this.cursors = [0];
    await this.loadHistory();
    if (this.readError())
      this.message.update(
        (v) =>
          v +
          ' Não foi possível atualizar a leitura. A operação já foi concluída; tente somente consultar novamente.',
      );
    this.focus('.feedback');
  }
  cancelConfirm() {
    const leaving = this.confirmation() === 'leave';
    this.confirmation.set(null);
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
    this.focus(leaving ? '#estoque-quantidade' : '[data-review] button');
  }
  cancelEdit() {
    if (this.locked) return;
    this.acao.set(null);
    this.dirty.set(false);
    this.errors.set({});
    this.focus('[data-actions] button');
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked) {
      this.message.set('Resolva a operação pendente repetindo o mesmo comando antes de sair.');
      this.focus('.feedback');
      return false;
    }
    if (!this.dirty()) return true;
    if (this.leaveResolver) return false;
    this.confirmation.set('leave');
    return new Promise((resolve) => (this.leaveResolver = resolve));
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.locked) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
