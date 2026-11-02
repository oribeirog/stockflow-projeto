import { contextBridge, ipcRenderer } from 'electron';
import { STATUS_CHANNEL, type DesktopApi } from '../../shared/contracts';
import { CANAIS_CADASTROS, type ApiCadastro } from '../../shared/cadastros-ipc';
function cadastro<T, E>(channels: {
  listar: string;
  obter: string;
  salvar: string;
}): ApiCadastro<T, E> {
  return {
    listar: (input) => ipcRenderer.invoke(channels.listar, input),
    obter: (id) => ipcRenderer.invoke(channels.obter, id),
    salvar: (input) => ipcRenderer.invoke(channels.salvar, input),
  };
}
const api: DesktopApi = {
  system: { getStatus: () => ipcRenderer.invoke(STATUS_CHANNEL) },
  cadastros: {
    produtos: cadastro(CANAIS_CADASTROS.produtos),
    marcas: cadastro(CANAIS_CADASTROS.marcas),
    categorias: cadastro(CANAIS_CADASTROS.categorias),
    clientes: cadastro(CANAIS_CADASTROS.clientes),
    fornecedores: cadastro(CANAIS_CADASTROS.fornecedores),
  },
};
contextBridge.exposeInMainWorld('mnrApi', api);
