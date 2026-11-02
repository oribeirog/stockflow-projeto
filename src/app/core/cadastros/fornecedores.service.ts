import { Injectable } from '@angular/core';
import type { Pessoa, EntradaPessoa } from '../../../../shared/catalogos';
import type { CadastrosApi } from '../../../../shared/cadastros-ipc';
import { CadastroService } from './base';
@Injectable({ providedIn: 'root' })
export class FornecedoresService extends CadastroService<Pessoa, EntradaPessoa> {
  protected api(api: CadastrosApi) {
    return api.fornecedores;
  }
}
