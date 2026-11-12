import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { coletarDocumento, ExportacaoError } from './documento';
import { gerarExcel } from './xlsx';
import { LIMITES_EXPORTACAO } from '../../../shared/exportacoes';
async function run() {
  const db = new Database(workerData.database, {
    readonly: true,
    fileMustExist: true,
    timeout: 1500,
  });
  try {
    db.pragma('query_only=ON');
    db.pragma('cache_size=-8192');
    db.pragma('mmap_size=0');
    const documento = coletarDocumento(db, workerData.pedido);
    // End the read transaction/connection before compression or PDF rendering.
    db.close();
    const bytes = workerData.formato === 'xlsx' ? await gerarExcel(documento) : undefined;
    if (bytes && bytes.length > LIMITES_EXPORTACAO.arquivoBytes)
      throw new ExportacaoError('EXPORT_LIMIT');
    parentPort!.postMessage({ ok: true, documento, bytes });
  } finally {
    if (db.open) db.close();
  }
}
void run().catch((e) =>
  parentPort!.postMessage({
    ok: false,
    error: { code: typeof e?.code === 'string' ? e.code : 'EXPORT_FAILED' },
  }),
);
