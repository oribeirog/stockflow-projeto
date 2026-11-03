import { Component, ElementRef, HostListener, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { EntradaPessoa, Pessoa } from '../../../../shared/catalogos';
import { GravacaoEstado } from '../../core/cadastros/estado';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { ContentState } from '../../shared/ui/content-state';
import { Confirm } from '../../shared/ui/confirm';
import { Badge } from '../../shared/ui/badge';
import { contextoPessoa } from './contexto';
import {
  camposPessoa,
  entradaPessoa,
  formularioPessoa,
  FormularioPessoa,
  textoInvalido,
  validarPessoa,
} from './formulario';

@Component({
  selector: 'mnr-pessoa-editor',
  imports: [RouterLink, Button, Field, ContentState, Confirm, Badge],
  templateUrl: './editor.html',
  styleUrl: './editor.scss',
})
export class PessoaEditor implements OnDestroy {
  readonly contexto = contextoPessoa();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly id = this.route.snapshot.paramMap.has('id')
    ? Number(this.route.snapshot.paramMap.get('id'))
    : undefined;
  readonly pessoa = signal<Pessoa | null>(null);
  readonly form = signal(formularioPessoa());
  readonly loading = signal(this.id !== undefined);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly blocked = signal(false);
  readonly refreshFailed = signal(false);
  readonly statusError = signal('');
  readonly dirty = signal(false);
  readonly message = signal('');
  readonly success = signal(false);
  readonly errors = signal<Record<string, string>>({});
  readonly confirmation = signal<'discard' | 'status' | null>(null);
  readonly groups = [
    { title: 'Identificação', keys: ['nome', 'documento'] },
    { title: 'Contato', keys: ['telefone', 'email'] },
    { title: 'Endereço', keys: ['endereco'] },
    { title: 'Observações', keys: ['observacoes'] },
  ].map((group) => ({ ...group, fields: camposPessoa.filter((f) => group.keys.includes(f.key)) }));
  private intention?: GravacaoEstado<Pessoa, EntradaPessoa>;
  private leaveResolver?: (value: boolean) => void;
  private generation = 0;
  private destroyed = false;
  private desiredActive = true;

  constructor() {
    const state = this.router.currentNavigation()?.extras.state;
    const confirmed = state?.['pessoaConfirmada'] as Pessoa | undefined;
    if (confirmed && confirmed.id === this.id) this.apply(confirmed);
    const message = state?.['pessoaMensagem'];
    if (typeof message === 'string') {
      this.message.set(message);
      this.success.set(true);
    }
    if (this.id !== undefined) void this.load();
  }
  get locked() {
    return this.busy() || this.uncertain() || this.blocked();
  }
  update(key: keyof FormularioPessoa, value: string) {
    if (this.locked) return;
    this.form.update((f) => ({ ...f, [key]: value }));
    this.dirty.set(true);
    this.success.set(false);
    this.message.set('');
  }
  async load() {
    const generation = ++this.generation;
    this.loading.set(true);
    if (!Number.isSafeInteger(this.id) || this.id! < 1) {
      this.message.set('Identificador de cadastro inválido.');
      this.loading.set(false);
      return;
    }
    const result = await this.contexto.service.obter(this.id!);
    if (this.destroyed || generation !== this.generation) return;
    if (result.ok) {
      this.apply(result.data);
      this.refreshFailed.set(false);
    } else if (this.pessoa()) {
      this.message.set(
        'Cadastro salvo. Não foi possível atualizar sua leitura. Tente consultar novamente.',
      );
      this.refreshFailed.set(true);
      this.success.set(true);
    } else {
      this.message.set(result.error.message);
      this.success.set(false);
    }
    this.loading.set(false);
    if (result.ok && this.route.snapshot.queryParamMap.get('acao') === 'situacao')
      this.openStatus();
  }
  private apply(pessoa: Pessoa) {
    this.pessoa.set(pessoa);
    this.form.set(formularioPessoa(pessoa));
    this.dirty.set(false);
    this.errors.set({});
  }
  private focus(selector: string) {
    setTimeout(() => {
      if (!this.destroyed) this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }
  async save() {
    if (
      this.busy() ||
      this.blocked() ||
      this.loading() ||
      (this.id !== undefined && !this.pessoa())
    )
      return;
    if (!this.intention) {
      if (this.pessoa() && !this.dirty()) return;
      const { errors, dados } = validarPessoa(this.form(), this.pessoa());
      this.errors.set(errors);
      if (Object.keys(errors).length) {
        this.message.set('Confira os campos indicados.');
        this.success.set(false);
        this.focus('[aria-invalid="true"]');
        return;
      }
      this.intention = this.contexto.service.novaGravacao(
        dados,
        this.pessoa() ? this.form().motivo : `Cadastro de ${this.contexto.singular}`,
      );
    }
    await this.execute();
  }
  private async execute() {
    this.busy.set(true);
    this.message.set('');
    this.success.set(false);
    const result = await this.intention!.executar();
    if (this.destroyed) return;
    if (!result.ok) {
      this.busy.set(false);
      this.message.set(result.error.message);
      const uncertain = ['IPC_UNAVAILABLE', 'DATABASE_BUSY', 'INTERNAL_ERROR'].includes(
        result.error.code,
      );
      this.uncertain.set(uncertain);
      this.blocked.set(result.error.code === 'IDEMPOTENCY_CONFLICT');
      if (!uncertain) this.intention = undefined;
      this.focus('.feedback');
      return;
    }
    this.intention = undefined;
    this.uncertain.set(false);
    this.apply(result.data);
    const current = await this.contexto.service.obter(result.data.id);
    if (this.destroyed) return;
    if (current.ok) this.apply(current.data);
    this.refreshFailed.set(!current.ok);
    this.success.set(true);
    this.message.set(
      current.ok
        ? `${this.contexto.singular === 'cliente' ? 'Cliente' : 'Fornecedor'} salvo com sucesso.`
        : 'Cadastro salvo. Não foi possível atualizar sua leitura. Tente consultar novamente.',
    );
    this.busy.set(false);
    if (this.id === undefined) {
      await this.router.navigate([this.contexto.path, result.data.id, 'editar'], {
        replaceUrl: true,
        state: { pessoaMensagem: this.message(), pessoaConfirmada: this.pessoa() },
      });
    } else this.focus('.feedback');
  }
  async refresh() {
    if (this.locked || this.dirty() || !this.pessoa()) return;
    this.busy.set(true);
    const result = await this.contexto.service.obter(this.pessoa()!.id);
    if (this.destroyed) return;
    this.busy.set(false);
    if (result.ok) {
      this.apply(result.data);
      this.refreshFailed.set(false);
      this.message.set('Cadastro atualizado.');
      this.success.set(true);
    } else {
      this.message.set(
        'Cadastro salvo. Não foi possível atualizar sua leitura. Tente consultar novamente.',
      );
    }
  }
  openStatus() {
    if (this.locked || this.dirty() || !this.pessoa()) return;
    this.desiredActive = !this.pessoa()!.ativo;
    this.statusError.set('');
    this.confirmation.set('status');
  }
  async confirmStatus(reason: string) {
    if (this.locked || this.dirty() || !this.pessoa()) return;
    if (textoInvalido(reason, 4000, true)) {
      this.statusError.set('Informe uma justificativa válida (até 4.000 caracteres).');
      this.focus('dialog [aria-invalid="true"]');
      return;
    }
    this.confirmation.set(null);
    this.busy.set(true);
    const latest = await this.contexto.service.obter(this.pessoa()!.id);
    if (this.destroyed) return;
    if (!latest.ok) {
      this.busy.set(false);
      this.message.set(latest.error.message);
      this.success.set(false);
      this.focus('.feedback');
      return;
    }
    if (latest.data.ativo === this.desiredActive) {
      this.apply(latest.data);
      this.busy.set(false);
      this.success.set(true);
      this.message.set('A situação desejada já está aplicada. Cadastro atualizado.');
      this.focus('.feedback');
      return;
    }
    this.intention = this.contexto.service.novaGravacao(
      { ...entradaPessoa(latest.data), ativo: this.desiredActive },
      reason,
    );
    await this.execute();
  }
  confirmDiscard() {
    this.confirmation.set(null);
    this.dirty.set(false);
    this.leaveResolver?.(true);
    this.leaveResolver = undefined;
  }
  cancelConfirm() {
    const discard = this.confirmation() === 'discard';
    this.confirmation.set(null);
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
    this.focus(discard ? '#pessoa-nome' : '[data-status] button');
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked) {
      this.message.set('Confirme a operação pendente antes de sair.');
      return false;
    }
    if (!this.dirty()) return true;
    if (this.leaveResolver) return false;
    this.confirmation.set('discard');
    return new Promise((resolve) => (this.leaveResolver = resolve));
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.locked) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    ++this.generation;
    this.leaveResolver?.(false);
  }
}
