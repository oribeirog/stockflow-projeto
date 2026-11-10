import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RelatoriosService } from '../../core/relatorios.service';
import { ClientesService } from '../../core/cadastros/clientes.service';
import type { Pessoa } from '../../../../shared/catalogos';
import type { RelatoriosApi, PeriodoRelatorio } from '../../../../shared/relatorios-ipc';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ContentState } from '../../shared/ui/content-state';
import { DashboardChart } from './chart';
import {
  dateLabel,
  instantLabel,
  percentLabel,
  quantityLabel,
  presetPeriod,
  validPeriod,
} from './presentation';
import { reais } from '../estoque/format';

type Data<M extends keyof RelatoriosApi> = Extract<
  Awaited<ReturnType<RelatoriosApi[M]>>,
  { ok: true }
>['data'];
interface DashboardData {
  summary: Data<'obterResumoGerencial'>;
  sales: Data<'obterSeriesVendas'>;
  receipts: Data<'obterSeriesRecebimentos'>;
  products: Data<'listarProdutos'>;
  clients: Data<'listarClientes'>;
  stock: Data<'obterResumoEstoque'>;
  low: Data<'listarSaldos'>;
  emptyStock: Data<'listarSaldos'>;
  period: PeriodoRelatorio;
  clientLabel: string;
}

@Component({
  selector: 'mnr-dashboard',
  imports: [RouterLink, Button, Card, ContentState, DashboardChart],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit, OnDestroy {
  private readonly reports = inject(RelatoriosService);
  private readonly clients = inject(ClientesService);
  readonly preset = signal('month');
  readonly start = signal(presetPeriod('month').dataInicio);
  readonly end = signal(presetPeriod('month').dataFim);
  readonly grouping = signal<'DIARIO' | 'MENSAL'>('DIARIO');
  readonly client = signal('');
  readonly search = signal('');
  readonly options = signal<Pessoa[]>([]);
  readonly selectedClientMissing = computed(
    () => !!this.client() && !this.options().some((c) => String(c.id) === this.client()),
  );
  readonly clientLoading = signal(false);
  readonly clientError = signal('');
  readonly clientMore = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly filterError = signal('');
  readonly data = signal<DashboardData | null>(null);
  readonly reais = reais;
  readonly date = dateLabel;
  readonly instant = instantLabel;
  readonly quantity = quantityLabel;
  readonly percent = percentLabel;
  private sequence = 0;
  private clientSequence = 0;
  private clientOffset = 0;
  readonly salesPoints = computed(
    () =>
      this.data()?.sales.itens.map((r) => ({
        label: r.competencia,
        value: r.faturamentoLiquidoCentavos,
      })) ?? [],
  );
  readonly receiptPoints = computed(
    () =>
      this.data()?.receipts.itens.map((r) => ({
        label: r.competencia,
        value: r.recebidoLiquidoCentavos,
      })) ?? [],
  );
  readonly commercialCards = computed(() => {
    const d = this.data();
    if (!d) return [];
    const c = d.summary.fluxoComercial;
    return [
      {
        id: 'revenue',
        label: 'Faturamento comercial líquido',
        value: reais(c.faturamentoLiquidoCentavos),
        hint: 'Fluxo do período · após correções',
        link: '/vendas',
      },
      {
        id: 'sales',
        label: 'Vendas confirmadas',
        value: quantityLabel(c.vendasConfirmadas),
        hint: 'Originais confirmados no período',
        link: '/vendas',
      },
      {
        id: 'result',
        label: 'Resultado bruto comercial estimado',
        value: reais(c.resultadoBrutoEstimadoCentavos),
        hint: 'Fluxo do período · não é lucro líquido',
        link: '/vendas',
      },
      {
        id: 'margin',
        label: 'Margem bruta estimada',
        value: percentLabel(c.margemBrutaPontosBase),
        hint: 'Fluxo do período · denominador positivo',
        link: '/vendas',
      },
      {
        id: 'ticket',
        label: 'Ticket médio da coorte',
        value:
          d.summary.coorteVendas.ticketMedioCentavos === null
            ? 'Não aplicável'
            : reais(d.summary.coorteVendas.ticketMedioCentavos),
        hint: 'Valor líquido atual das vendas do período',
        link: '/vendas',
      },
    ];
  });
  readonly financialCards = computed(() => {
    const d = this.data();
    if (!d) return [];
    const s = d.summary;
    return [
      {
        id: 'receipts',
        label: 'Recebimentos líquidos',
        value: reais(s.fluxoFinanceiro.recebidoLiquidoCentavos),
        hint: 'Fluxo do período · dinheiro recebido',
        link: '/financeiro/parcelas',
      },
      {
        id: 'debt',
        label: 'Saldo a receber',
        value: reais(s.posicaoAtual.contas.exigivelCentavos),
        hint: 'Posição atual · todo o histórico',
        link: '/financeiro/parcelas',
      },
      {
        id: 'overdue',
        label: 'Total vencido',
        value: reais(s.posicaoAtual.contas.vencidoCentavos),
        hint: 'Posição atual · vencimento anterior a hoje',
        link: '/financeiro/parcelas',
      },
      {
        id: 'refund',
        label: 'Reembolsos pendentes',
        value: reais(s.posicaoAtual.reembolsos.pendenteCentavos),
        hint: 'Posição atual · obrigações ativas',
        link: '/financeiro/reembolsos',
      },
    ];
  });
  readonly stockCards = computed(() => {
    const s = this.data()?.stock.posicaoAtual;
    return s
      ? [
          { id: 'stock-value', label: 'Valor do estoque', value: reais(s.valorCentavos) },
          { id: 'stock-units', label: 'Unidades disponíveis', value: quantityLabel(s.unidades) },
          { id: 'stock-empty', label: 'Produtos sem estoque', value: quantityLabel(s.semEstoque) },
          {
            id: 'stock-low',
            label: 'Produtos abaixo do mínimo',
            value: quantityLabel(s.abaixoMinimo),
          },
        ]
      : [];
  });
  ngOnInit() {
    void this.load();
    void this.findClients();
  }
  ngOnDestroy() {
    ++this.sequence;
    ++this.clientSequence;
  }
  invalidate() {
    ++this.sequence;
    this.data.set(null);
    this.loading.set(false);
    this.error.set('');
    this.filterError.set('');
  }
  selectPreset(value: string) {
    this.preset.set(value);
    this.invalidate();
    if (value === 'custom') return;
    const p = presetPeriod(value);
    this.start.set(p.dataInicio);
    this.end.set(p.dataFim);
    void this.load();
  }
  async findClients(more = false) {
    const seq = ++this.clientSequence;
    const offset = more ? this.clientOffset + 25 : 0;
    this.clientLoading.set(true);
    this.clientError.set('');
    const r = await this.clients.listar({ busca: this.search(), limite: 26, deslocamento: offset });
    if (seq !== this.clientSequence) return;
    this.clientLoading.set(false);
    if (!r.ok) {
      this.clientError.set(r.error.message);
      return;
    }
    this.clientOffset = offset;
    this.options.set([...(more ? this.options() : []), ...r.data.slice(0, 25)]);
    this.clientMore.set(r.data.length > 25);
  }
  async load() {
    this.invalidate();
    const seq = this.sequence;
    const period = { dataInicio: this.start(), dataFim: this.end() };
    if (!validPeriod(period)) {
      this.filterError.set('Informe datas válidas, em ordem, com no máximo 366 dias inclusivos.');
      return;
    }
    const clientId = this.client() ? Number(this.client()) : undefined;
    if (clientId !== undefined && (!Number.isSafeInteger(clientId) || clientId < 1)) {
      this.filterError.set('Selecione um cliente válido.');
      return;
    }
    const filter = { ...period, ...(clientId === undefined ? {} : { clienteId: clientId }) };
    const clientLabel =
      clientId === undefined
        ? 'Todos os clientes (inclui vendas sem identificação)'
        : (this.options().find((c) => c.id === clientId)?.nome ?? `Cliente ${clientId}`);
    this.loading.set(true);
    const [summary, sales, receipts, products, clients, stock, low, emptyStock] = await Promise.all(
      [
        this.reports.obterResumoGerencial(filter),
        this.reports.obterSeriesVendas({ ...filter, agrupamento: this.grouping() }),
        this.reports.obterSeriesRecebimentos({ ...filter, agrupamento: this.grouping() }),
        this.reports.listarProdutos({ ...filter, limite: 5, ordem: 'UNIDADES_DESC' }),
        this.reports.listarClientes({ ...filter, limite: 5 }),
        this.reports.obterResumoEstoque(period),
        this.reports.listarSaldos({ situacao: 'BAIXO', limite: 5, ordem: 'ID' }),
        this.reports.listarSaldos({ situacao: 'SEM_ESTOQUE', limite: 5, ordem: 'ID' }),
      ],
    );
    if (seq !== this.sequence) return;
    this.loading.set(false);
    if (
      !summary.ok ||
      !sales.ok ||
      !receipts.ok ||
      !products.ok ||
      !clients.ok ||
      !stock.ok ||
      !low.ok ||
      !emptyStock.ok
    ) {
      this.error.set(
        'Não foi possível atualizar todas as consultas do Dashboard. Nenhum indicador desta atualização foi exibido. Tente novamente.',
      );
      return;
    }
    this.data.set({
      summary: summary.data,
      sales: sales.data,
      receipts: receipts.data,
      products: products.data,
      clients: clients.data,
      stock: stock.data,
      low: low.data,
      emptyStock: emptyStock.data,
      period,
      clientLabel,
    });
  }
}
