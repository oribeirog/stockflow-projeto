import { Injectable } from '@angular/core';
import type { EntradaReferencia, Referencia } from '../../../../shared/catalogos';
import type { CadastrosApi } from '../../../../shared/cadastros-ipc';
import { CadastroService } from './base';
@Injectable({ providedIn: 'root' })
export class FormasPagamentoService extends CadastroService<Referencia, EntradaReferencia> {
  protected api(api: CadastrosApi) {
    return api.formasPagamento;
  }
}
