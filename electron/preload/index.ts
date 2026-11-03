import { contextBridge, ipcRenderer } from 'electron';
import { STATUS_CHANNEL, type DesktopApi } from '../../shared/contracts';
import { CANAIS_CADASTROS, type ApiCadastro } from '../../shared/cadastros-ipc';
import { CANAIS_FOTOS } from '../../shared/fotos';
import { CANAIS_ESTOQUE } from '../../shared/estoque-ipc';
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
  estoque: {
    listar: (input) => ipcRenderer.invoke(CANAIS_ESTOQUE.listar, input),
    obter: (input) => ipcRenderer.invoke(CANAIS_ESTOQUE.obter, input),
    listarMovimentacoes: (input) => ipcRenderer.invoke(CANAIS_ESTOQUE.listarMovimentacoes, input),
    registrarEntrada: (input) => ipcRenderer.invoke(CANAIS_ESTOQUE.registrarEntrada, input),
    registrarSaida: (input) => ipcRenderer.invoke(CANAIS_ESTOQUE.registrarSaida, input),
    registrarPerda: (input) => ipcRenderer.invoke(CANAIS_ESTOQUE.registrarPerda, input),
    registrarContagem: (input) => ipcRenderer.invoke(CANAIS_ESTOQUE.registrarContagem, input),
  },
  fotos: {
    selecionar: () => ipcRenderer.invoke(CANAIS_FOTOS.selecionar),
    descartar: (token) => ipcRenderer.invoke(CANAIS_FOTOS.descartar, token),
    obter: (input) => ipcRenderer.invoke(CANAIS_FOTOS.obter, input),
    salvar: (command) => ipcRenderer.invoke(CANAIS_FOTOS.salvar, command),
    remover: (command) => ipcRenderer.invoke(CANAIS_FOTOS.remover, command),
  },
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
