import { Component, HostListener, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { EntradaProduto, Produto, Referencia } from '../../../../shared/catalogos';
import { decimalInteger, decimalText } from '../../../../shared/perfume-values';
import { ProdutosService } from '../../core/cadastros/produtos.service';
import { MarcasService } from '../../core/cadastros/marcas.service';
import { CategoriasService } from '../../core/cadastros/categorias.service';
import { GravacaoEstado } from '../../core/cadastros/estado';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { ContentState } from '../../shared/ui/content-state';
import { ReferencePicker } from '../../shared/ui/reference-picker';
import { Confirm } from '../../shared/ui/confirm';
import { PhotoEditor } from './photo-editor';

type FormKey =
  | 'nome'
  | 'sku'
  | 'codigoBarras'
  | 'volume'
  | 'concentracao'
  | 'descricao'
  | 'preco'
  | 'estoque'
  | 'motivo';
interface FormField {
  key: FormKey;
  label: string;
  max: number;
  required?: boolean;
  hint?: string;
  mode?: 'decimal' | 'numeric';
  multiline?: boolean;
}
@Component({
  selector: 'mnr-perfume-editor',
  imports: [RouterLink, Button, Field, ContentState, ReferencePicker, Confirm, PhotoEditor],
  templateUrl: './editor.html',
  styleUrl: './editor.scss',
})
export class PerfumeEditor {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly products = inject(ProdutosService);
  private readonly brands = inject(MarcasService);
  private readonly categories = inject(CategoriasService);
  readonly id = this.route.snapshot.paramMap.has('id')
    ? Number(this.route.snapshot.paramMap.get('id'))
    : undefined;
  readonly product = signal<Produto | null>(null);
  readonly brand = signal<Referencia | null>(null);
  readonly category = signal<Referencia | null>(null);
  readonly loading = signal(this.id !== undefined);
  readonly busy = signal(false);
  readonly uncertain = signal(false);
  readonly dirty = signal(false);
  readonly message = signal('');
  readonly success = signal(false);
  readonly errors = signal<Record<string, string>>({});
  readonly referencePending = signal(false);
  private readonly references = new Set<string>();
  readonly photoDirty = signal(false);
  readonly photoPending = signal(false);
  readonly photoEditor = viewChild(PhotoEditor);
  readonly confirmation = signal<'discard' | 'status' | null>(null);
  private leaveResolver?: (value: boolean) => void;
  private intention?: GravacaoEstado<Produto, EntradaProduto>;
  readonly form = signal<Record<FormKey, string>>({
    nome: '',
    sku: '',
    codigoBarras: '',
    volume: '',
    concentracao: '',
    descricao: '',
    preco: '',
    estoque: '0',
    motivo: '',
  });
  readonly fields: FormField[] = [
    { key: 'nome', label: 'Nome do perfume', max: 200, required: true },
    {
      key: 'sku',
      label: 'SKU',
      max: 64,
      required: true,
      hint: 'Identificador único. Não pode ser alterado após o cadastro.',
    },
    { key: 'codigoBarras', label: 'Código de barras', max: 128 },
    { key: 'concentracao', label: 'Concentração', max: 120 },
    {
      key: 'volume',
      label: 'Volume (mL)',
      max: 20,
      mode: 'decimal',
      required: true,
      hint: 'Até 3 casas decimais, sem separador de milhar. Ex.: 100,125.',
    },
    {
      key: 'preco',
      label: 'Preço de venda (R$)',
      max: 20,
      mode: 'decimal',
      required: true,
      hint: 'Até 2 casas decimais, sem separador de milhar. Ex.: 129,90.',
    },
    {
      key: 'estoque',
      label: 'Estoque mínimo',
      max: 10,
      mode: 'numeric',
      required: true,
      hint: 'Parâmetro cadastral; não altera o saldo do estoque.',
    },
    { key: 'descricao', label: 'Descrição', max: 4000, multiline: true },
  ];
  constructor() {
    if (this.id !== undefined) void this.load();
  }
  readonly groups = [
    {
      title: 'Identificação',
      fields: this.fields.filter((field) => ['nome', 'sku', 'codigoBarras'].includes(field.key)),
    },
    { title: 'Classificação', fields: this.fields.filter((field) => field.key === 'concentracao') },
    {
      title: 'Apresentação',
      fields: this.fields.filter((field) => ['volume', 'descricao'].includes(field.key)),
    },
    {
      title: 'Cadastro comercial',
      fields: this.fields.filter((field) => ['preco', 'estoque'].includes(field.key)),
    },
  ];
  get locked() {
    return this.busy() || this.uncertain();
  }
  referenceState(kind: string, pending: boolean) {
    if (pending) this.references.add(kind);
    else this.references.delete(kind);
    this.referencePending.set(this.references.size > 0);
  }
  update(key: FormKey, value: string) {
    this.form.update((f) => ({ ...f, [key]: value }));
    this.dirty.set(true);
    this.success.set(false);
  }
  select(kind: 'brand' | 'category', value: Referencia) {
    this[kind].set(value);
    this.dirty.set(true);
  }
  async load() {
    this.loading.set(true);
    this.message.set('');
    const result = await this.products.obter(this.id!);
    if (!result.ok) {
      this.message.set(result.error.message);
      this.loading.set(false);
      return;
    }
    this.apply(result.data);
    const [brand, category] = await Promise.all([
      this.brands.obter(result.data.marcaId),
      this.categories.obter(result.data.categoriaId),
    ]);
    if (brand.ok) this.brand.set(brand.data);
    if (category.ok) this.category.set(category.data);
    if (!brand.ok || !category.ok)
      this.message.set('Não foi possível carregar a marca ou categoria. Tente novamente.');
    this.loading.set(false);
    if (this.route.snapshot.queryParamMap.get('acao') === 'situacao')
      this.confirmation.set('status');
  }
  private apply(p: Produto) {
    this.product.set(p);
    this.form.set({
      nome: p.nome,
      sku: p.sku,
      codigoBarras: p.codigoBarras ?? '',
      volume: decimalText(p.volumeMicrolitros, 3),
      concentracao: p.concentracao ?? '',
      descricao: p.descricao ?? '',
      preco: decimalText(p.precoVendaCentavos, 2),
      estoque: String(p.estoqueMinimo),
      motivo: '',
    });
    this.dirty.set(false);
  }
  private data(): EntradaProduto | null {
    const f = this.form();
    const errors: Record<string, string> = {};
    for (const field of this.fields) {
      const value = f[field.key].trim().normalize('NFC');
      if (
        (field.required && !value) ||
        value.length > field.max ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
      )
        errors[field.key] = 'Confira este campo e seu limite de caracteres.';
    }
    const price = decimalInteger(f.preco, 2, 0, 9_000_000_000_000),
      volume = decimalInteger(f.volume, 3, 1, 1_000_000_000),
      stock = decimalInteger(f.estoque, 0, 0, 1_000_000_000);
    if (price === null)
      errors['preco'] =
        'Informe um preço de zero a R$ 90.000.000.000,00, com até 2 casas decimais.';
    if (volume === null)
      errors['volume'] = 'Informe de 0,001 a 1.000.000 mL, com até 3 casas decimais.';
    if (stock === null) errors['estoque'] = 'Informe um inteiro de zero a 1.000.000.000.';
    if (!this.brand()) errors['marca'] = 'Selecione uma marca.';
    if (!this.category()) errors['categoria'] = 'Selecione uma categoria.';
    if (this.product() && (!f.motivo.trim() || f.motivo.trim().length > 4000))
      errors['motivo'] = 'Informe a justificativa da alteração (até 4.000 caracteres).';
    this.errors.set(errors);
    if (Object.keys(errors).length) {
      this.message.set('Confira os campos indicados.');
      setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return null;
    }
    return {
      id: this.product()?.id,
      nome: f.nome,
      sku: f.sku,
      codigoBarras: f.codigoBarras || null,
      marcaId: this.brand()!.id,
      categoriaId: this.category()!.id,
      volumeMicrolitros: volume!,
      concentracao: f.concentracao || null,
      descricao: f.descricao || null,
      precoVendaCentavos: price!,
      estoqueMinimo: stock!,
      ativo: this.product()?.ativo ?? true,
    };
  }
  async save() {
    if (this.busy() || this.referencePending() || this.photoPending()) return;
    if (!this.intention) {
      const data = this.data();
      if (!data) return;
      this.intention = this.products.novaGravacao(
        data,
        this.product() ? this.form().motivo : 'Cadastro de perfume',
      );
    }
    await this.execute();
  }
  private async execute() {
    this.busy.set(true);
    this.message.set('');
    this.success.set(false);
    const result = await this.intention!.executar();
    if (!result.ok) {
      this.busy.set(false);
      this.message.set(result.error.message);
      const uncertain = ['IPC_UNAVAILABLE', 'DATABASE_BUSY', 'INTERNAL_ERROR'].includes(
        result.error.code,
      );
      this.uncertain.set(uncertain);
      if (!uncertain) this.intention = undefined;
      return;
    }
    const reason = this.form().motivo || 'Cadastro de fotografia do perfume';
    this.intention = undefined;
    this.uncertain.set(false);
    this.apply(result.data);
    this.success.set(true);
    this.message.set('Perfume salvo com sucesso.');
    const current = await this.products.obter(result.data.id);
    if (current.ok) this.apply(current.data);
    else this.message.set('Perfume salvo. Não foi possível atualizar sua leitura.');
    // Pass the confirmed ID directly; committing a new product's photo cannot depend on render timing.
    if (this.photoDirty()) await this.photoEditor()?.commit(reason, result.data.id);
    this.busy.set(false);
  }
  photoSaved(ok: boolean) {
    this.success.set(ok);
    this.message.set(
      ok
        ? 'Perfume e fotografia salvos com sucesso.'
        : 'Perfume salvo. A fotografia precisa de atenção; tente confirmar apenas a fotografia.',
    );
  }
  async confirm(reason: string) {
    const action = this.confirmation();
    this.confirmation.set(null);
    if (action === 'discard') {
      this.dirty.set(false);
      this.leaveResolver?.(true);
      this.leaveResolver = undefined;
      return;
    }
    if (action !== 'status' || this.locked) return;
    this.busy.set(true);
    const latest = await this.products.obter(this.product()!.id);
    this.busy.set(false);
    if (!latest.ok) {
      this.message.set(latest.error.message);
      return;
    }
    const { criadoEm: _created, atualizadoEm: _updated, ...data } = latest.data;
    void _created;
    void _updated;
    this.intention = this.products.novaGravacao({ ...data, ativo: !data.ativo }, reason);
    await this.execute();
  }
  cancelConfirm() {
    this.confirmation.set(null);
    this.leaveResolver?.(false);
    this.leaveResolver = undefined;
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.locked || this.referencePending() || this.photoPending()) {
      this.message.set('Confirme a operação pendente antes de sair.');
      return false;
    }
    if (!this.dirty() && !this.photoDirty()) return true;
    this.confirmation.set('discard');
    return new Promise((resolve) => (this.leaveResolver = resolve));
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (
      this.dirty() ||
      this.locked ||
      this.referencePending() ||
      this.photoDirty() ||
      this.photoPending()
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  back() {
    void this.router.navigate(['/perfumes']);
  }
}
