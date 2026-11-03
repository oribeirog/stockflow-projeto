import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FinanceiroService } from '../../core/financeiro.service';
import { ClientesService } from '../../core/cadastros/clientes.service';
import type { Pessoa } from '../../../../shared/catalogos';
import type {
  ParcelaConsulta,
  ReembolsoConsulta,
  ConsultaParcelas,
  ConsultaReembolsos,
} from '../../../../shared/financeiro-ipc';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { reais } from '../estoque/format';

@Component({
  selector: 'mnr-financeiro-lista',
  imports: [RouterLink, Button, Field],
  templateUrl: './lista.html',
  styleUrl: './financeiro.scss',
})
export class FinanceiroLista implements OnInit, OnDestroy {
  private readonly service = inject(FinanceiroService);
  private readonly clients = inject(ClientesService);
  private readonly route = inject(ActivatedRoute);
  readonly reembolsos = this.route.snapshot.data['financeiroTipo'] === 'reembolsos';
  readonly parcelas = signal<ParcelaConsulta[]>([]);
  readonly obrigacoes = signal<ReembolsoConsulta[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly loaded = signal(false);
  readonly reference = signal('');
  readonly more = signal(false);
  readonly clientOptions = signal<Pessoa[]>([]);
  readonly clientMore = signal(false);
  readonly clientError = signal('');
  readonly search = signal('');
  readonly client = signal('');
  readonly venda = signal(this.route.snapshot.queryParamMap.get('vendaId') ?? '');
  readonly state = signal(this.reembolsos ? 'ATIVAS' : 'EM_ABERTO');
  readonly de = signal('');
  readonly ate = signal('');
  readonly reais = reais;
  page = 0;
  private sequence = 0;
  private clientSequence = 0;
  private offset = 0;
  private destroyed = false;
  ngOnInit() {
    void this.load();
    void this.findClients();
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.sequence;
    ++this.clientSequence;
  }
  async findClients(more = false) {
    const seq = ++this.clientSequence,
      offset = more ? this.offset + 25 : 0;
    this.clientError.set('');
    const r = await this.clients.listar({ busca: this.search(), limite: 26, deslocamento: offset });
    if (this.destroyed || seq !== this.clientSequence) return;
    if (!r.ok) {
      this.clientError.set(r.error.message);
      return;
    }
    this.offset = offset;
    this.clientOptions.set([...(more ? this.clientOptions() : []), ...r.data.slice(0, 25)]);
    this.clientMore.set(r.data.length > 25);
  }
  async load(page = 0, focus = false) {
    const seq = ++this.sequence;
    this.loading.set(true);
    this.loaded.set(false);
    this.error.set('');
    const common = {
      clienteId: this.client() ? Number(this.client()) : undefined,
      vendaId: this.venda() ? Number(this.venda()) : undefined,
      limite: 25,
      deslocamento: page * 25,
    };
    const r = this.reembolsos
      ? await this.service.financeiro((api) =>
          api.listarReembolsos({
            ...common,
            situacao: this.state() as ConsultaReembolsos['situacao'],
          }),
        )
      : await this.service.financeiro((api) =>
          api.listarParcelas({
            ...common,
            situacao: this.state() as ConsultaParcelas['situacao'],
            vencimentoDe: this.de() || undefined,
            vencimentoAte: this.ate() || undefined,
          }),
        );
    if (this.destroyed || seq !== this.sequence) return;
    this.loading.set(false);
    if (!r.ok) {
      this.error.set(r.error.message);
      setTimeout(() => document.querySelector<HTMLElement>('.feedback')?.focus(), 0);
      return;
    }
    if (this.reembolsos) this.obrigacoes.set(r.data.itens as ReembolsoConsulta[]);
    else this.parcelas.set(r.data.itens as ParcelaConsulta[]);
    this.page = page;
    this.more.set(r.data.temMais);
    this.reference.set(r.data.dataReferencia);
    this.loaded.set(true);
    if (focus) setTimeout(() => document.getElementById('financeiro-resultados')?.focus(), 0);
  }
}
