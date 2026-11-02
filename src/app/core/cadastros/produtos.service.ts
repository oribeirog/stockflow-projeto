import { Injectable } from '@angular/core';
import type { Produto, EntradaProduto } from '../../../../shared/catalogos';
import type { CadastrosApi } from '../../../../shared/cadastros-ipc';
import { CadastroService } from './base';
@Injectable({ providedIn: 'root' })
export class ProdutosService extends CadastroService<Produto, EntradaProduto> {
  protected api(api: CadastrosApi) {
    return api.produtos;
  }
}
