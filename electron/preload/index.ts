import { CANAIS_VENDAS } from '../../shared/vendas-ipc';
import { CANAIS_FINANCEIRO } from '../../shared/financeiro-ipc';
import { CANAIS_CORRECOES } from '../../shared/correcoes-ipc';
import { contextBridge, ipcRenderer } from 'electron';
import { STATUS_CHANNEL, type DesktopApi } from '../../shared/contracts';
import { CANAIS_CADASTROS, type ApiCadastro } from '../../shared/cadastros-ipc';
import { CANAIS_FOTOS } from '../../shared/fotos';
import { CANAIS_ESTOQUE } from '../../shared/estoque-ipc';
import { CANAIS_COMPRAS } from '../../shared/compras-ipc';
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
  financeiro: {
    revisarPagamentoReembolso: (input) =>
      ipcRenderer.invoke(CANAIS_FINANCEIRO.revisarPagamentoReembolso, input),
    pagarReembolso: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.pagarReembolso, input),
    revisarEstornoRecebimento: (input) =>
      ipcRenderer.invoke(CANAIS_FINANCEIRO.revisarEstornoRecebimento, input),
    estornarRecebimento: (input) =>
      ipcRenderer.invoke(CANAIS_FINANCEIRO.estornarRecebimento, input),
    revisarEstornoReembolso: (input) =>
      ipcRenderer.invoke(CANAIS_FINANCEIRO.revisarEstornoReembolso, input),
    estornarReembolso: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.estornarReembolso, input),

    revisarRecebimento: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.revisarRecebimento, input),
    registrarRecebimento: (input) =>
      ipcRenderer.invoke(CANAIS_FINANCEIRO.registrarRecebimento, input),
    listarParcelas: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.listarParcelas, input),
    obterParcela: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.obterParcela, input),
    obterVenda: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.obterVenda, input),
    listarMovimentos: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.listarMovimentos, input),
    obterMovimento: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.obterMovimento, input),
    listarReembolsos: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.listarReembolsos, input),
    obterReembolso: (input) => ipcRenderer.invoke(CANAIS_FINANCEIRO.obterReembolso, input),
  },
  correcoes: {
    revisarEstornoDevolucaoVenda: (input) =>
      ipcRenderer.invoke(CANAIS_CORRECOES.revisarEstornoDevolucaoVenda, input),
    estornarDevolucaoVenda: (input) =>
      ipcRenderer.invoke(CANAIS_CORRECOES.estornarDevolucaoVenda, input),

    revisarDevolucaoVenda: (input) =>
      ipcRenderer.invoke(CANAIS_CORRECOES.revisarDevolucaoVenda, input),
    devolverVenda: (input) => ipcRenderer.invoke(CANAIS_CORRECOES.devolverVenda, input),
    revisarCancelamentoVenda: (input) =>
      ipcRenderer.invoke(CANAIS_CORRECOES.revisarCancelamentoVenda, input),
    cancelarVenda: (input) => ipcRenderer.invoke(CANAIS_CORRECOES.cancelarVenda, input),
    obterContextoVenda: (input) => ipcRenderer.invoke(CANAIS_CORRECOES.obterContextoVenda, input),
    listarDocumentos: (input) => ipcRenderer.invoke(CANAIS_CORRECOES.listarDocumentos, input),
    obterDocumento: (input) => ipcRenderer.invoke(CANAIS_CORRECOES.obterDocumento, input),
  },
  vendas: {
    listar: (input) => ipcRenderer.invoke(CANAIS_VENDAS.listar, input),
    obter: (input) => ipcRenderer.invoke(CANAIS_VENDAS.obter, input),
    revisarPlano: (input) => ipcRenderer.invoke(CANAIS_VENDAS.revisarPlano, input),
    salvarRascunho: (input) => ipcRenderer.invoke(CANAIS_VENDAS.salvarRascunho, input),
    confirmar: (input) => ipcRenderer.invoke(CANAIS_VENDAS.confirmar, input),
    confirmarComEntrada: (input) => ipcRenderer.invoke(CANAIS_VENDAS.confirmarComEntrada, input),
    descartarRascunho: (input) => ipcRenderer.invoke(CANAIS_VENDAS.descartarRascunho, input),
  },
  compras: {
    listar: (input) => ipcRenderer.invoke(CANAIS_COMPRAS.listar, input),
    obter: (input) => ipcRenderer.invoke(CANAIS_COMPRAS.obter, input),
    salvarRascunho: (input) => ipcRenderer.invoke(CANAIS_COMPRAS.salvarRascunho, input),
    confirmar: (input) => ipcRenderer.invoke(CANAIS_COMPRAS.confirmar, input),
    descartarRascunho: (input) => ipcRenderer.invoke(CANAIS_COMPRAS.descartarRascunho, input),
  },
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
    formasPagamento: cadastro(CANAIS_CADASTROS.formasPagamento),
    produtos: cadastro(CANAIS_CADASTROS.produtos),
    marcas: cadastro(CANAIS_CADASTROS.marcas),
    categorias: cadastro(CANAIS_CADASTROS.categorias),
    clientes: cadastro(CANAIS_CADASTROS.clientes),
    fornecedores: cadastro(CANAIS_CADASTROS.fornecedores),
  },
};
contextBridge.exposeInMainWorld('mnrApi', api);
