import { Injectable } from '@angular/core';
import type { Referencia, EntradaReferencia } from '../../../../shared/catalogos';
import type { CadastrosApi } from '../../../../shared/cadastros-ipc';
import { CadastroService } from './base';
@Injectable({ providedIn: 'root' })
export class MarcasService extends CadastroService<Referencia, EntradaReferencia> {
  protected api(api: CadastrosApi) {
    return api.marcas;
  }
}
