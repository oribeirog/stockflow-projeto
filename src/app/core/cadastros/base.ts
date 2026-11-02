import { inject } from '@angular/core';
import type { ComandoCadastro, ConsultaCadastro } from '../../../../shared/catalogos';
import type { ApiCadastro, CadastrosApi } from '../../../../shared/cadastros-ipc';
import { DesktopService } from '../desktop.service';
import { ConsultaEstado, GravacaoEstado } from './estado';

export abstract class CadastroService<T, E> {
  private readonly desktop = inject(DesktopService);
  protected abstract api(api: CadastrosApi): ApiCadastro<T, E>;
  listar(consulta: ConsultaCadastro) {
    return this.desktop.cadastro((api) => this.api(api).listar(consulta));
  }
  obter(id: number) {
    return this.desktop.cadastro((api) => this.api(api).obter(id));
  }
  salvar(comando: ComandoCadastro<E>) {
    return this.desktop.cadastro((api) => this.api(api).salvar(comando));
  }
  novaConsulta() {
    return new ConsultaEstado((consulta) => this.listar(consulta));
  }
  novaGravacao(dados: E, motivo: string) {
    return new GravacaoEstado((comando) => this.salvar(comando), dados, motivo);
  }
}
