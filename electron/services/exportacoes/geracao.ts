import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { PedidoExportacao } from '../../../shared/exportacoes';
import { LIMITES_EXPORTACAO } from '../../../shared/exportacoes';
import { ExportacaoError, type DocumentoRelatorio } from './documento';
export interface GeracaoExportacao {
  documento: DocumentoRelatorio;
  bytes?: Uint8Array;
}
export function gerarNoWorker(
  database: string,
  pedido: PedidoExportacao,
  formato: 'xlsx' | 'pdf',
): Promise<GeracaoExportacao> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'worker.js'), {
      workerData: { database, pedido, formato },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    });
    let finished = false;
    const finish = (error?: unknown, result?: GeracaoExportacao) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(
      () => finish(new ExportacaoError('EXPORT_LIMIT')),
      LIMITES_EXPORTACAO.geracaoMs,
    );
    worker.once('message', (r) =>
      r.ok ? finish(undefined, r) : finish(new ExportacaoError(r.error.code)),
    );
    worker.once('error', (e) => finish(e));
    worker.once('exit', () => {
      if (!finished) finish(new ExportacaoError('EXPORT_FAILED'));
    });
  });
}
