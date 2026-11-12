import { open, link, unlink, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExportacaoError } from './documento';
import { LIMITES_EXPORTACAO } from '../../../shared/exportacoes';
const inside = (root: string, target: string) => {
  const p = relative(root, target);
  return !p || (!p.startsWith('..') && !isAbsolute(p));
};
export async function salvarArquivo(
  destination: string,
  format: 'xlsx' | 'pdf',
  bytes: Uint8Array,
  protectedRoots: string[],
) {
  if (!bytes.length || bytes.length > LIMITES_EXPORTACAO.arquivoBytes)
    throw new ExportacaoError('EXPORT_LIMIT');
  const target = resolve(extname(destination) ? destination : destination + '.' + format);
  const name = basename(target);
  if (
    extname(target).toLowerCase() !== '.' + format ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(name)
  )
    throw new ExportacaoError('EXPORT_DESTINATION');
  const parent = await realpath(dirname(target));
  for (const root of protectedRoots) {
    const canonical = await realpath(root);
    if (inside(canonical, parent)) throw new ExportacaoError('EXPORT_DESTINATION');
  }
  const final = join(parent, name),
    temporary = join(parent, `.mnr-export-${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    // Atomic publication with exclusive destination: cannot replace even a raced file/link.
    await link(temporary, final);
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
  return name;
}
export function mensagemExportacao(error: unknown): { code: string; message: string } {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    ERR_WORKER_OUT_OF_MEMORY:
      'O relatório excedeu o limite de memória para exportação. Reduza os filtros e tente novamente; nenhum arquivo incompleto foi publicado.',
    VALIDATION: 'Confira o modelo, as datas e os filtros. Não são aceitos campos adicionais.',
    NOT_FOUND: 'Uma referência selecionada não existe. Confira os identificadores.',
    EXPORT_BUSY: 'Uma exportação já está em andamento. Aguarde seu resultado.',
    EXPORT_LIMIT:
      'O relatório excedeu o limite de linhas, tamanho ou duração. Reduza os filtros e tente novamente.',
    EXPORT_PRECISION:
      'Um valor excede a precisão numérica segura do Excel. Use PDF ou reduza o conjunto; nenhum arquivo foi salvo.',
    EXPORT_DESTINATION:
      'Escolha um destino fora dos dados e da instalação do aplicativo, com a extensão correta.',
    EEXIST: 'Já existe um arquivo com esse nome. Escolha outro nome; o existente foi preservado.',
    EACCES: 'Sem permissão para salvar. Escolha outra pasta ou verifique as permissões.',
    EPERM: 'Destino bloqueado ou arquivo em uso. Escolha outra pasta ou feche o arquivo.',
    ENOSPC: 'Espaço insuficiente no disco. Libere espaço ou escolha outro destino.',
    ENOENT: 'Pasta de destino indisponível. Escolha uma pasta existente.',
    ENOTSUP: 'O destino não suporta publicação segura. Escolha uma pasta em um volume NTFS.',
    EXDEV: 'O destino não suporta publicação segura. Escolha outra pasta em um volume NTFS.',
  };
  return {
    code: messages[code] ? code : 'EXPORT_FAILED',
    message:
      messages[code] ??
      'Não foi possível gerar e salvar o relatório com segurança. Nenhum arquivo existente foi substituído. Tente novamente.',
  };
}
