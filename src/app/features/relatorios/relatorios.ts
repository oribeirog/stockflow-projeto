import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  MODELOS_RELATORIO,
  LIMITES_EXPORTACAO,
  type ModeloRelatorio,
  type PedidoExportacao,
  type ResultadoExportacao,
} from '../../../../shared/exportacoes';
import { ExportacoesService } from '../../core/exportacoes.service';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ContentState } from '../../shared/ui/content-state';
import { presetPeriod, validPeriod } from '../dashboard/presentation';
@Component({
  selector: 'mnr-relatorios',
  imports: [Button, Card, ContentState],
  templateUrl: './relatorios.html',
  styleUrl: './relatorios.scss',
})
export class Relatorios {
  readonly service = inject(ExportacoesService);
  readonly modelos = MODELOS_RELATORIO;
  readonly modelo = signal<ModeloRelatorio>('GERENCIAL');
  readonly formato = signal<'xlsx' | 'pdf'>('xlsx');
  readonly inicio = signal(presetPeriod('month').dataInicio);
  readonly fim = signal(presetPeriod('month').dataFim);
  readonly cliente = signal('');
  readonly produto = signal('');
  readonly forma = signal('');
  readonly venda = signal('');
  readonly situacao = signal('');
  readonly ativo = signal('');
  readonly natureza = signal('');
  readonly ordem = signal('');
  readonly vencimentoDe = signal('');
  readonly vencimentoAte = signal('');
  readonly erro = signal('');
  readonly mensagem = signal('');
  readonly revisao = signal<{
    pedido: PedidoExportacao;
    formato: 'xlsx' | 'pdf';
    criterios: string[];
  } | null>(null);
  readonly resultado = signal<Exclude<ResultadoExportacao, { cancelado: true }> | null>(null);
  readonly contexto = signal('');
  readonly periodo = computed(() =>
    ['GERENCIAL', 'VENDAS', 'MOVIMENTOS', 'DESEMPENHO'].includes(this.modelo()),
  );
  readonly clientePermitido = computed(() => this.modelo() !== 'ESTOQUE');
  readonly produtoPermitido = computed(() => ['VENDAS', 'ESTOQUE'].includes(this.modelo()));
  readonly descricao = computed(() => this.modelos.find((m) => m.id === this.modelo())!.descricao);
  readonly situacoes = computed(() =>
    this.modelo() === 'CONTAS'
      ? ['TODAS', 'ABERTAS', 'VENCIDAS', 'A_VENCER', 'QUITADAS']
      : this.modelo() === 'REEMBOLSOS'
        ? ['TODAS', 'PENDENTES', 'QUITADAS', 'ANULADAS']
        : this.modelo() === 'ESTOQUE'
          ? ['TODOS', 'SEM_ESTOQUE', 'BAIXO']
          : [],
  );
  readonly limite = LIMITES_EXPORTACAO.linhas;
  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const a = params.get('de'),
      b = params.get('ate'),
      c = params.get('cliente');
    if (
      a &&
      b &&
      validPeriod({ dataInicio: a, dataFim: b }) &&
      (!c || (/^[1-9]\d*$/.test(c) && Number.isSafeInteger(Number(c))))
    ) {
      this.inicio.set(a);
      this.fim.set(b);
      this.cliente.set(c ?? '');
      this.contexto.set(
        'Período e cliente recebidos do Dashboard para o modelo Gerencial. O estoque permanece global. Revise os critérios antes de exportar.',
      );
    }
  }
  trocarModelo(value: string) {
    this.modelo.set(value as ModeloRelatorio);
    this.situacao.set('');
    this.ordem.set('');
    this.ativo.set('');
    this.natureza.set('');
    this.produto.set('');
    this.forma.set('');
    this.venda.set('');
    this.vencimentoDe.set('');
    this.vencimentoAte.set('');
    this.contexto.set(
      'Ao trocar o modelo, somente filtros compatíveis são utilizados. Período não se aplica a posições atuais de Estoque ou Reembolsos, nem substitui o filtro de vencimento de Contas.',
    );
    this.invalidar();
  }
  invalidar() {
    this.revisao.set(null);
    this.erro.set('');
    this.mensagem.set('');
    this.resultado.set(null);
  }
  preparar() {
    this.invalidar();
    const filtros: Record<string, string | number | boolean> = {},
      criterios: string[] = [];
    const add = (key: string, label: string, v: string) => {
      if (v) {
        filtros[key] = v;
        criterios.push(`${label}: ${v}`);
      }
    };
    if (this.periodo()) {
      if (!validPeriod({ dataInicio: this.inicio(), dataFim: this.fim() })) {
        this.erro.set('Informe um período válido, em ordem, com até 366 dias inclusivos.');
        return;
      }
      add('dataInicio', 'De', this.inicio());
      add('dataFim', 'Até', this.fim());
    }
    const ids: [string, string, string, boolean][] = [
      ['clienteId', 'Cliente ID', this.cliente(), this.clientePermitido()],
      ['produtoId', 'Produto ID', this.produto(), this.produtoPermitido()],
      ['formaPagamentoId', 'Forma ID', this.forma(), this.modelo() === 'MOVIMENTOS'],
      ['vendaId', 'Venda ID', this.venda(), ['CONTAS', 'REEMBOLSOS'].includes(this.modelo())],
    ];
    for (const [key, label, value, allowed] of ids) {
      if (allowed && value) {
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
          this.erro.set(`${label}: informe um inteiro positivo ou deixe em branco.`);
          return;
        }
        filtros[key] = Number(value);
        criterios.push(`${label}: ${value}`);
      }
    }
    if (this.situacoes().length) add('situacao', 'Situação', this.situacao());
    if (this.modelo() === 'CONTAS') {
      for (const [key, label, value] of [
        ['vencimentoDe', 'Vencimento de', this.vencimentoDe()],
        ['vencimentoAte', 'Vencimento até', this.vencimentoAte()],
      ]) {
        if (value && !validPeriod({ dataInicio: value!, dataFim: value! })) {
          this.erro.set('Informe vencimentos válidos.');
          return;
        }
        add(key!, label!, value!);
      }
      if (
        this.vencimentoDe() &&
        this.vencimentoAte() &&
        this.vencimentoDe() > this.vencimentoAte()
      ) {
        this.erro.set('O vencimento inicial deve ser anterior ou igual ao final.');
        return;
      }
    }
    if (this.modelo() === 'MOVIMENTOS') add('natureza', 'Natureza', this.natureza());
    if (['VENDAS', 'MOVIMENTOS', 'ESTOQUE'].includes(this.modelo()))
      add('ordem', 'Ordenação', this.ordem());
    if (this.modelo() === 'ESTOQUE' && this.ativo()) {
      filtros['ativo'] = this.ativo() === 'true';
      criterios.push(`Cadastro: ${filtros['ativo'] ? 'Ativos' : 'Inativos'}`);
    }
    if (!criterios.length)
      criterios.push('Todos os registros permitidos pelo modelo, inclusive inativos.');
    this.revisao.set({
      pedido: { modelo: this.modelo(), filtros } as PedidoExportacao,
      formato: this.formato(),
      criterios,
    });
    setTimeout(() => document.getElementById('export-review-title')?.focus());
  }
  async exportar() {
    const review = this.revisao();
    if (!review || this.service.busy()) return;
    this.erro.set('');
    this.mensagem.set('');
    this.resultado.set(null);
    const r = await this.service.exportar(review.pedido, review.formato);
    if (!r.ok) this.erro.set(r.error.message);
    else if (r.data.cancelado)
      this.mensagem.set('Salvamento cancelado. Nenhum arquivo foi gravado.');
    else {
      this.resultado.set(r.data);
      this.revisao.set(null);
    }
    setTimeout(() => document.getElementById('export-result')?.focus());
  }
  canLeave() {
    return !this.service.busy();
  }
}
