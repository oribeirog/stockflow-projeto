import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FinanceiroService } from '../../core/financeiro.service';
import type {
  VendaFinanceira,
  DetalheParcela,
  DetalheReembolso,
  DetalheMovimentoFinanceiro,
  MovimentoConsultaFinanceiro,
  ResultadoConsulta,
  VinculoVenda,
} from '../../../../shared/financeiro-ipc';
import type { DetalheCorrecao, DocumentoCorretivo } from '../../../../shared/correcoes-ipc';
import { Button } from '../../shared/ui/button';
import { reais } from '../estoque/format';
@Component({
  selector: 'mnr-financeiro-detalhe',
  imports: [RouterLink, Button],
  templateUrl: './detalhe.html',
  styleUrl: './financeiro.scss',
})
export class FinanceiroDetalhe implements OnInit, OnDestroy {
  private readonly service = inject(FinanceiroService);
  private readonly route = inject(ActivatedRoute);
  readonly kind = this.route.snapshot.data['financeiroTipo'] as string;
  readonly venda = signal<VendaFinanceira | null>(null);
  readonly parcela = signal<DetalheParcela | null>(null);
  readonly reembolso = signal<DetalheReembolso | null>(null);
  readonly movimento = signal<DetalheMovimentoFinanceiro | null>(null);
  readonly correcao = signal<DetalheCorrecao | null>(null);
  readonly header = signal<VinculoVenda | null>(null);
  readonly movements = signal<MovimentoConsultaFinanceiro[]>([]);
  readonly corrections = signal<DocumentoCorretivo[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly historyError = signal('');
  readonly historyLoading = signal(false);
  readonly historyMore = signal(false);
  readonly correctionsMore = signal(false);
  readonly correctionsLoading = signal(false);
  readonly reais = reais;
  readonly summaryLabels = [
    ['valorOriginalCentavos', 'Valor original da venda'],
    ['devolucoesCancelamentosCentavos', 'Devoluções e cancelamentos líquidos'],
    ['valorComercialLiquidoCentavos', 'Valor comercial líquido'],
    ['recebimentosEfetivosCentavos', 'Recebimentos registrados (brutos)'],
    ['estornosRecebimentoCentavos', 'Estornos de recebimento'],
    ['recebidoLiquidoCentavos', 'Recebido líquido'],
    ['abatimentosDividaCentavos', 'Abatimentos líquidos das parcelas'],
    ['saldoReceberCentavos', 'Saldo exigível atual'],
    ['obrigacoesAtivasCentavos', 'Valor original das obrigações ativas'],
    ['reembolsosPagosCentavos', 'Reembolsos pagos (brutos)'],
    ['estornosReembolsoCentavos', 'Estornos dos pagamentos de reembolso'],
    ['reembolsoPagoLiquidoCentavos', 'Reembolsos pagos líquidos'],
    ['reembolsosPendentesCentavos', 'Reembolsos pendentes'],
  ] as const;
  private sequence = 0;
  private historySeq = 0;
  private correctionSeq = 0;
  private destroyed = false;
  private cursors = [0];
  historyPage = 0;
  correctionPage = 0;
  ngOnInit() {
    void this.load();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.sequence;
    ++this.historySeq;
    ++this.correctionSeq;
  }
  private accept<T>(r: ResultadoConsulta<T>): T | null {
    if (!r.ok) {
      this.error.set(r.error.message);
      return null;
    }
    return r.data;
  }
  async load() {
    const seq = ++this.sequence,
      id = Number(this.route.snapshot.paramMap.get('id'));
    const saleId = Number(
      this.route.snapshot.paramMap.get('vendaId') ??
        this.route.snapshot.queryParamMap.get('vendaId'),
    );
    this.loading.set(true);
    ++this.historySeq;
    ++this.correctionSeq;
    this.historyLoading.set(false);
    this.correctionsLoading.set(false);
    this.historyMore.set(false);
    this.correctionsMore.set(false);
    this.historyPage = 0;
    this.correctionPage = 0;
    this.error.set('');
    this.historyError.set('');
    this.header.set(null);
    this.venda.set(null);
    this.parcela.set(null);
    this.reembolso.set(null);
    this.movimento.set(null);
    this.correcao.set(null);
    this.movements.set([]);
    this.corrections.set([]);
    this.cursors = [0];
    if (this.kind === 'venda') {
      const r = await this.service.financeiro((api) => api.obterVenda(id));
      if (this.destroyed || seq !== this.sequence) return;
      const d = this.accept(r);
      this.venda.set(d);
      this.header.set(d);
    } else if (this.kind === 'parcela') {
      const r = await this.service.financeiro((api) => api.obterParcela(id));
      if (this.destroyed || seq !== this.sequence) return;
      const d = this.accept(r);
      this.parcela.set(d);
      this.header.set(d);
    } else if (this.kind === 'reembolso') {
      const r = await this.service.financeiro((api) =>
        api.obterReembolso({ vendaId: saleId, reembolsoId: id }),
      );
      if (this.destroyed || seq !== this.sequence) return;
      const d = this.accept(r);
      this.reembolso.set(d);
      this.header.set(d);
    } else if (this.kind === 'movimento') {
      const r = await this.service.financeiro((api) =>
        api.obterMovimento({ vendaId: saleId, movimentoId: id }),
      );
      if (this.destroyed || seq !== this.sequence) return;
      const d = this.accept(r);
      this.movimento.set(d);
      if (d) {
        const h = await this.service.financeiro((api) => api.obterVenda(d.vendaId));
        if (this.destroyed || seq !== this.sequence) return;
        this.header.set(this.accept(h));
      }
    } else {
      const r = await this.service.correcoes((api) =>
        api.obterDocumento({ vendaId: saleId, documentoId: id }),
      );
      if (this.destroyed || seq !== this.sequence) return;
      const d = this.accept(r);
      this.correcao.set(d);
      this.header.set(d);
    }
    if (this.destroyed || seq !== this.sequence) return;
    this.loading.set(false);
    setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(this.error() ? '.feedback' : '#financeiro-detalhe-titulo')
          ?.focus(),
      0,
    );
    if (this.header() && this.kind !== 'movimento' && this.kind !== 'correcao') {
      await Promise.all([
        this.loadMovements(0),
        this.kind === 'venda' ? this.loadCorrections(0) : Promise.resolve(),
      ]);
    }
  }
  async loadMovements(page: number) {
    const h = this.header();
    if (!h || page < 0) return;
    const seq = ++this.historySeq;
    this.historyLoading.set(true);
    this.historyError.set('');
    const r = await this.service.financeiro((api) =>
      api.listarMovimentos({
        vendaId: h.vendaId,
        aposId: this.cursors[page],
        limite: 25,
        parcelaId: this.parcela()?.id,
        reembolsoId: this.reembolso()?.id,
      }),
    );
    if (this.destroyed || seq !== this.historySeq) return;
    this.historyLoading.set(false);
    if (!r.ok) {
      this.historyError.set(r.error.message);
      return;
    }
    this.movements.set(r.data.itens);
    this.historyMore.set(r.data.temMais);
    this.historyPage = page;
    this.cursors[page + 1] = r.data.itens.at(-1)?.id ?? this.cursors[page];
  }
  async loadCorrections(page: number) {
    const h = this.header();
    if (!h || page < 0) return;
    const seq = ++this.correctionSeq;
    this.correctionsLoading.set(true);
    const r = await this.service.correcoes((api) =>
      api.listarDocumentos({ vendaId: h.vendaId, limite: 25, deslocamento: page * 25 }),
    );
    if (this.destroyed || seq !== this.correctionSeq) return;
    this.correctionsLoading.set(false);
    if (!r.ok) {
      this.historyError.set(r.error.message);
      return;
    }
    this.corrections.set(r.data.itens);
    this.correctionsMore.set(r.data.temMais);
    this.correctionPage = page;
  }
}
