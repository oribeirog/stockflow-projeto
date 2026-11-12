import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { gerarHtml } from './html';
import { ExportacaoError, type DocumentoRelatorio } from './documento';
import { LIMITES_EXPORTACAO } from '../../../shared/exportacoes';
export async function gerarPdf(documento: DocumentoRelatorio): Promise<Uint8Array> {
  const isolated = session.fromPartition(`mnr-pdf-${randomUUID()}`, { cache: false });
  isolated.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  isolated.setPermissionCheckHandler(() => false);
  const url = 'mnr://report/index.html';
  const html = gerarHtml(documento);
  isolated.protocol.handle(
    'mnr',
    () =>
      new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'",
        },
      }),
  );
  isolated.webRequest.onBeforeRequest((details, cb) => cb({ cancel: details.url !== url }));
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const render = async () => {
      await window.loadURL(url);
      const bytes = await window.webContents.printToPDF({
        pageSize: 'A4',
        landscape: documento.secoes.some((s) => s.colunas.length > 5),
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-family:Arial;font-size:8px;color:#465468;width:100%;text-align:center">MNR Perfumes | Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
      });
      if (bytes.length > LIMITES_EXPORTACAO.arquivoBytes) throw new ExportacaoError('EXPORT_LIMIT');
      return new Uint8Array(bytes);
    };
    return await Promise.race([
      render(),
      new Promise<never>((_r, reject) => {
        timer = setTimeout(
          () => reject(new ExportacaoError('EXPORT_LIMIT')),
          LIMITES_EXPORTACAO.geracaoMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    window.destroy();
    isolated.protocol.unhandle('mnr');
    await isolated.clearStorageData().catch(() => undefined);
  }
}
