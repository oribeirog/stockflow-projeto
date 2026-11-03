// Separate Angular build; never imported by src/main.ts or included in the package.
import { Component, inject, Injector } from '@angular/core';
import { FotosService } from '../../src/app/core/cadastros/fotos.service';
import type { FotosApi, ImagemFoto } from '../../shared/fotos';
import { bootstrapApplication } from '@angular/platform-browser';
import { ProdutosService } from '../../src/app/core/cadastros/produtos.service';
import { MarcasService } from '../../src/app/core/cadastros/marcas.service';
import { CategoriasService } from '../../src/app/core/cadastros/categorias.service';
import { ClientesService } from '../../src/app/core/cadastros/clientes.service';
import { FornecedoresService } from '../../src/app/core/cadastros/fornecedores.service';
import { DesktopService } from '../../src/app/core/desktop.service';
import { ConsultaEstado, GravacaoEstado } from '../../src/app/core/cadastros/estado';
import type { ResultadoCadastro } from '../../shared/cadastros-ipc';
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function data<T>(result: ResultadoCadastro<T>): T {
  check(result.ok, JSON.stringify(result));
  return result.data;
}
@Component({ selector: 'app-root', template: '<h1>Integração cadastral</h1>' })
class Integration {
  private readonly produtos = inject(ProdutosService);
  private readonly marcas = inject(MarcasService);
  private readonly categorias = inject(CategoriasService);
  private readonly clientes = inject(ClientesService);
  private readonly fornecedores = inject(FornecedoresService);
  private readonly desktop = inject(DesktopService);
  constructor() {
    void this.verify()
      .then(() => {
        document.body.dataset['resultado'] = 'CADASTROS_ANGULAR_OK';
      })
      .catch((error: unknown) => {
        document.body.dataset['resultado'] = 'ERRO';
        document.body.append(String(error));
      });
  }
  private async verify() {
    check(isSecureContext && crypto.randomUUID().length === 36, 'UUID secure context');
    check(typeof window.mnrApi === 'object' && !('invoke' in window.mnrApi), 'Limited API');
    const marca = data(
      await this.marcas.novaGravacao({ nome: 'Marca integração' }, 'Teste').executar(),
    );
    const categoria = data(
      await this.categorias.novaGravacao({ nome: 'Categoria integração' }, 'Teste').executar(),
    );
    for (const service of [this.marcas, this.categorias, this.clientes, this.fornecedores]) {
      const original = data(
        await service.novaGravacao({ nome: 'Cadastro integração' }, 'Teste').executar(),
      );
      check(data(await service.obter(original.id)).id === original.id, 'Get');
      const updated = data(
        await service
          .novaGravacao({ id: original.id, nome: original.nome, ativo: false }, 'Inativar')
          .executar(),
      );
      check(!updated.ativo, 'Deactivate');
      check(
        data(await service.listar({ ativo: false, busca: 'cadastro', limite: 1 })).length === 1,
        'List',
      );
      check(
        data(
          await service
            .novaGravacao({ id: updated.id, nome: updated.nome, ativo: true }, 'Reativar')
            .executar(),
        ).ativo,
        'Reactivate',
      );
    }
    const entrada = {
      nome: 'Perfume integração',
      sku: 'INTEGRACAO',
      marcaId: marca.id,
      categoriaId: categoria.id,
      volumeMicrolitros: 100000,
      precoVendaCentavos: 12345,
      estoqueMinimo: 0,
    };
    let primeira = true;
    const comandos: string[] = [];
    const gravacao = new GravacaoEstado(
      async (command) => {
        comandos.push(JSON.stringify(command));
        const result = await this.produtos.salvar(command);
        if (primeira) {
          primeira = false;
          return {
            ok: false,
            error: { code: 'IPC_UNAVAILABLE', message: 'Resposta perdida no teste' },
          };
        }
        return result;
      },
      entrada,
      'Teste resposta perdida',
    );
    check(gravacao.estado().fase === 'inicial', 'Initial write state');
    const pending = gravacao.executar();
    check(pending === gravacao.executar(), 'Concurrent writes share promise');
    check(gravacao.estado().fase === 'carregando', 'Loading write');
    check(!(await pending).ok && gravacao.estado().fase === 'erro', 'Lost reply');
    entrada.nome = 'Mutação posterior';
    const produto = data(await gravacao.executar());
    check(gravacao.estado().fase === 'sucesso', 'Successful write state');
    check(
      comandos[0] === comandos[1] && produto.nome === 'Perfume integração',
      'Original command retained',
    );
    check(data(await this.produtos.obter(produto.id)).precoVendaCentavos === 12345, 'Exact price');
    check(
      data(await this.produtos.listar({ busca: 'integracao', limite: 1 })).length === 1,
      'Product list',
    );
    const saved = data(
      await this.produtos
        .novaGravacao({ ...entrada, nome: produto.nome, id: produto.id, ativo: false }, 'Inativar')
        .executar(),
    );
    check(!saved.ativo, 'Product inactive');
    check(
      data(
        await this.produtos
          .novaGravacao({ ...entrada, nome: produto.nome, id: produto.id, ativo: true }, 'Reativar')
          .executar(),
      ).ativo,
      'Product active',
    );
    const consulta = this.produtos.novaConsulta();
    check(consulta.estado().fase === 'inicial', 'Initial query state');
    const independente = this.produtos.novaConsulta();
    await consulta.carregar({ busca: 'inexistente' });
    const vazio = consulta.estado();
    check(vazio.fase === 'sucesso' && vazio.dados.length === 0, 'Empty success');
    check(independente.estado().fase === 'inicial', 'Consumer state isolation');
    const notFound = await this.produtos.obter(999999);
    check(!notFound.ok && notFound.error.code === 'NOT_FOUND', 'Business code');
    const rejected = await this.desktop.cadastro(() =>
      Promise.reject(new Error('SQL C:/private stack')),
    );
    check(
      !rejected.ok &&
        rejected.error.code === 'IPC_UNAVAILABLE' &&
        !rejected.error.message.includes('private'),
      'Sanitized transport',
    );
    class MissingDesktop extends DesktopService {
      protected override getApi() {
        return undefined;
      }
    }
    const absent = await new MissingDesktop().cadastro((api) => api.clientes.listar({}));
    check(!absent.ok && absent.error.code === 'DESKTOP_UNAVAILABLE', 'Desktop unavailable');
    const resolvers: ((value: ResultadoCadastro<number[]>) => void)[] = [];
    const requests: unknown[] = [];
    const state = new ConsultaEstado<number>((query) => {
      requests.push(query);
      return new Promise((resolve) => resolvers.push(resolve));
    });
    const old = state.carregar({ busca: 'a', deslocamento: 20 });
    check(state.estado().fase === 'carregando', 'Loading query');
    const newer = state.carregar({ busca: 'b', deslocamento: 20 });
    resolvers[1]({ ok: true, data: [2] });
    await newer;
    resolvers[0]({ ok: true, data: [1] });
    await old;
    const current = state.estado();
    check(current.fase === 'sucesso' && current.dados[0] === 2, 'Ignore stale results');
    check(
      requests.every((query) => (query as { deslocamento: number }).deslocamento === 0),
      'Filter resets offset',
    );
    const erro = state.carregar({ busca: 'b', deslocamento: 10 });
    resolvers[2]({ ok: false, error: { code: 'DATABASE_BUSY', message: 'Banco ocupado.' } });
    await erro;
    check(state.estado().fase === 'erro', 'Query failure');
    check((requests[2] as { deslocamento: number }).deslocamento === 10, 'Page offset preserved');
    const photoReplies: ((value: ResultadoCadastro<ImagemFoto | null>) => void)[] = [];
    const photoApi: FotosApi = {
      selecionar: async () => ({ ok: true, data: null }),
      descartar: async () => ({ ok: true, data: null }),
      obter: () => new Promise((resolve) => photoReplies.push(resolve)),
      salvar: async (command) => ({
        ok: true,
        data: { produtoId: command.dados.produtoId, fotoId: 'new-photo' },
      }),
      remover: async (command) => ({
        ok: true,
        data: { produtoId: command.dados.produtoId, fotoId: null },
      }),
    };
    const photoInjector = Injector.create({
      providers: [
        FotosService,
        {
          provide: DesktopService,
          useValue: {
            foto: <T>(operation: (api: FotosApi) => Promise<ResultadoCadastro<T>>) =>
              operation(photoApi),
          },
        },
      ],
    });
    try {
      const photos = photoInjector.get(FotosService),
        oldPhoto = photos.obter(7, 'miniatura');
      check(photos.obter(7, 'miniatura') === oldPhoto, 'Deduplicate concurrent photo reads');
      data(
        await photos.novaGravacao({ produtoId: 7, token: 'prepared' }, 'Replacement').executar(),
      );
      const newPhoto = photos.obter(7, 'miniatura');
      check(newPhoto !== oldPhoto, 'Replacement invalidates old in-flight photo reads');
      photoReplies[0]({ ok: true, data: null });
      await oldPhoto;
      check(
        photos.obter(7, 'miniatura') === newPhoto,
        'Late old read cannot evict the current photo request',
      );
      photoReplies[1]({ ok: true, data: null });
      await newPhoto;
    } finally {
      photoInjector.destroy();
    }
  }
}
void bootstrapApplication(Integration).catch((error: unknown) => {
  document.body.dataset['resultado'] = 'ERRO';
  document.body.append(String(error));
});
