import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import {
  CANAIS_EXPORTACOES,
  type PedidoExportacao,
  type ResultadoExportacao,
} from '../../shared/exportacoes';
import type { Result } from '../../shared/contracts';
import { validarPedido } from '../services/exportacoes/validacao';
import { ExportacaoError } from '../services/exportacoes/documento';
import { mensagemExportacao, salvarArquivo } from '../services/exportacoes/arquivos';
import { gerarNoWorker, type GeracaoExportacao } from '../services/exportacoes/geracao';
import { gerarPdf } from '../services/exportacoes/pdf';
import { isTrustedSender } from './trust';
export interface ExportacaoDependencies {
  escolher: (nome: string, formato: 'xlsx' | 'pdf') => Promise<string | undefined>;
  gerar: (pedido: PedidoExportacao, formato: 'xlsx' | 'pdf') => Promise<GeracaoExportacao>;
  pdf: typeof gerarPdf;
  salvar: (destino: string, formato: 'xlsx' | 'pdf', bytes: Uint8Array) => Promise<string>;
}
export function criarExportador(deps: ExportacaoDependencies) {
  let busy = false;
  return async (
    formato: 'xlsx' | 'pdf',
    ...args: unknown[]
  ): Promise<Result<ResultadoExportacao>> => {
    try {
      if (args.length !== 1) throw new ExportacaoError('VALIDATION');
      const pedido = validarPedido(args[0]);
      if (busy) throw new ExportacaoError('EXPORT_BUSY');
      busy = true;
      try {
        const destino = await deps.escolher(
          `MNR-${pedido.modelo.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${formato}`,
          formato,
        );
        if (!destino) return { ok: true, data: { cancelado: true } };
        const r = await deps.gerar(pedido, formato);
        const bytes = formato === 'pdf' ? await deps.pdf(r.documento) : r.bytes!;
        if (!bytes) throw new ExportacaoError('EXPORT_FAILED');
        const nome = await deps.salvar(destino, formato, bytes);
        return {
          ok: true,
          data: {
            cancelado: false,
            nome,
            formato,
            bytes: bytes.length,
            geradoEm: r.documento.geradoEm,
            registros: r.documento.registros,
          },
        };
      } finally {
        busy = false;
      }
    } catch (error) {
      return { ok: false, error: mensagemExportacao(error) };
    }
  };
}
export function registerExportacoes(
  window: BrowserWindow,
  db: Database.Database,
  allowedUrl: string,
  registrar: Pick<typeof ipcMain, 'handle'> = ipcMain,
) {
  const execute = criarExportador({
    escolher: async (nome, formato) => {
      const r = await dialog.showSaveDialog(window, {
        title: 'Salvar relatório MNR Perfumes',
        defaultPath: nome,
        filters: [
          {
            name: formato === 'xlsx' ? 'Pasta de trabalho Excel' : 'Documento PDF',
            extensions: [formato],
          },
        ],
        properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
      });
      return r.canceled ? undefined : r.filePath;
    },
    gerar: (pedido, formato) => gerarNoWorker(db.name, pedido, formato),
    pdf: gerarPdf,
    salvar: (destino, formato, bytes) =>
      salvarArquivo(destino, formato, bytes, [
        app.getPath('userData'),
        ...(app.isPackaged
          ? [app.getAppPath(), dirname(process.execPath)]
          : ['electron', 'src', 'shared', 'dist', 'node_modules', '.git', 'scripts', '.cache'].map(
              (p) => resolve(p),
            )),
      ]),
  });
  for (const [channel, formato] of [
    [CANAIS_EXPORTACOES.exportarExcel, 'xlsx'],
    [CANAIS_EXPORTACOES.exportarPdf, 'pdf'],
  ] as const) {
    registrar.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedSender(event, window, allowedUrl))
        throw new Error('Operação IPC não autorizada.');
      return execute(formato, ...args);
    });
  }
}
