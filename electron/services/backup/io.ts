import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { open, lstat, realpath, mkdir, unlink, statfs } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

export class BackupError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function checkedId(id: unknown): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new BackupError('INVALID_BACKUP');
  return id;
}
export async function safeDirectory(path: string) {
  const s = await lstat(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()
  )
    throw new BackupError('UNSAFE_STORAGE');
}
export async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true });
  await safeDirectory(path);
}
export async function regularFile(path: string, max = 1024 * 1024 ** 3) {
  const s = await lstat(path);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    !Number.isSafeInteger(s.size) ||
    s.size < 1 ||
    s.size > max
  )
    throw new BackupError('INVALID_BACKUP');
  return s;
}
export async function hashFile(path: string) {
  const before = await regularFile(path),
    hash = createHash('sha256');
  let bytes = 0;
  for await (const c of createReadStream(path, { highWaterMark: 65536 })) {
    bytes += c.length;
    hash.update(c);
    if (bytes > before.size) throw new BackupError('INVALID_BACKUP');
  }
  const after = await regularFile(path);
  if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
    throw new BackupError('INVALID_BACKUP');
  return { size: bytes, sha256: hash.digest('hex') };
}
export async function syncFile(path: string) {
  const f = await open(path, 'r+');
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
export async function durableFile(path: string, bytes: Uint8Array) {
  const f = await open(path, 'wx', 0o600);
  try {
    await f.writeFile(bytes);
    await f.sync();
  } finally {
    await f.close();
  }
}
// Trusted static Win32 helper. Paths are environment values, never shell source.
// Same-volume moves only. WRITE_THROUGH + no REPLACE permits external FAT/exFAT
// media without hard-link support. REPLACE is restricted to our own journal pointer.
const moveScript = `$ErrorActionPreference='Stop';try {
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MnrMove { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileEx(string source,string target,uint flags); }';
$flags=[uint32]8;if($env:MNR_MOVE_REPLACE -eq '1'){$flags=[uint32]9};
if(-not [MnrMove]::MoveFileEx($env:MNR_MOVE_SOURCE,$env:MNR_MOVE_TARGET,$flags)){[Console]::Out.Write([Runtime.InteropServices.Marshal]::GetLastWin32Error());exit 1}
}catch{[Console]::Out.Write('unavailable');exit 1}`;
export async function moveDurable(source: string, target: string, replace = false) {
  // No COPY_ALLOWED flag: a cross-volume request fails rather than copying a
  // partial destination. Callers stage on the destination volume.
  if (process.platform !== 'win32') throw new BackupError('UNSAFE_STORAGE');
  try {
    await promisify(execFile)(
      join(
        process.env['SystemRoot'] ?? 'C:/Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(moveScript, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4096,
        env: {
          ...process.env,
          MNR_MOVE_SOURCE: source,
          MNR_MOVE_TARGET: target,
          MNR_MOVE_REPLACE: replace ? '1' : '0',
        },
      },
    );
  } catch (error) {
    const output = String((error as { stdout?: string }).stdout ?? '').trim();
    throw new BackupError(
      (
        {
          '80': 'EEXIST',
          '183': 'EEXIST',
          '5': 'EACCES',
          '32': 'EPERM',
          '112': 'ENOSPC',
          '3': 'ENOENT',
          '2': 'ENOENT',
          '17': 'UNSAFE_STORAGE',
        } as Record<string, string>
      )[output] ?? 'PUBLISH_FAILED',
    );
  }
}
export async function durableJson(path: string, value: unknown, replace = false) {
  await safeDirectory(dirname(path));
  const tmp = join(dirname(path), `.mnr-control-${randomUUID()}.partial`);
  // If exclusive allocation fails, the existing file is not ours to remove.
  const file = await open(tmp, 'wx', 0o600);
  const claimed = await file.stat({ bigint: true });
  try {
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    await moveDurable(tmp, path, replace);
  } finally {
    await lstat(tmp, { bigint: true })
      .then(async (actual) => {
        if (
          actual.isFile() &&
          !actual.isSymbolicLink() &&
          actual.dev === claimed.dev &&
          actual.ino === claimed.ino &&
          actual.birthtimeNs === claimed.birthtimeNs
        )
          await unlink(tmp);
      })
      .catch(() => undefined);
  }
}
export async function spaceFor(directory: string, bytes: number) {
  const s = await statfs(directory, { bigint: true });
  if (BigInt(s.bavail) * BigInt(s.bsize) < BigInt(Math.ceil(bytes)) + 64n * 1024n * 1024n)
    throw new BackupError('ENOSPC');
}
export function backupMessage(error: unknown) {
  const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    VALIDATION: 'Comando inválido. Selecione o backup e confira a revisão antes de confirmar.',
    INVALID_BACKUP:
      'O arquivo não é um backup MNR válido e completo, ou foi alterado. Os dados atuais foram preservados.',
    INCOMPATIBLE: 'Backup incompatível. Esta versão aceita formato 1 e schema 5 do MNR Perfumes.',
    MISSING_PHOTO:
      'Uma fotografia vinculada está ausente, inválida ou diferente do registro. Nenhum backup completo foi publicado.',
    BUSY: 'Uma operação de proteção dos dados está em andamento. Aguarde e tente novamente.',
    STALE_REVIEW:
      'A revisão não está mais disponível ou o conjunto foi alterado. Selecione e confira o backup novamente.',
    RECOVERY_REQUIRED:
      'A recuperação exige verificação antes de abrir o sistema. Os conjuntos foram preservados; não apague as cópias de proteção.',
    LIMIT:
      'O conjunto excede os limites de segurança de backup. Nenhum arquivo incompleto foi publicado.',
    ENOSPC:
      'Espaço insuficiente para preparar, proteger e validar os dados. Libere espaço ou escolha outro destino.',
    EFBIG:
      'A mídia não comporta um arquivo deste tamanho. FAT32 limita arquivos a 4 GiB; escolha exFAT ou NTFS com espaço suficiente.',
    EIO: 'Falha de leitura ou gravação na mídia. Verifique sua conexão e integridade antes de tentar novamente.',
    ENODEV:
      'A mídia foi removida ou não está disponível. Conecte-a novamente ou escolha outro destino.',
    EEXIST: 'Já existe um arquivo com esse nome. Escolha outro nome; o existente foi preservado.',
    EACCES: 'Sem permissão para gravar no destino. Escolha outra pasta ou verifique as permissões.',
    EPERM: 'O destino está bloqueado ou em uso. Feche o arquivo ou escolha outra pasta.',
    ENOENT: 'A pasta ou mídia não está disponível. Verifique a conexão e escolha novamente.',
    UNSAFE_STORAGE:
      'O destino ou armazenamento não oferece as condições de segurança necessárias. Escolha uma pasta local ou mídia compatível.',
    PUBLISH_FAILED:
      'Não foi possível publicar o arquivo com segurança. Verifique a mídia e tente novamente; arquivos existentes foram preservados.',
    RETENTION:
      'Existem conjuntos de proteção que não puderam ser verificados ou liberados com segurança. Consulte a pasta de proteção antes de outra restauração.',
  };
  return {
    code: messages[raw] ? raw : 'BACKUP_FAILED',
    message:
      messages[raw] ??
      'Não foi possível concluir a operação com segurança. Os dados e proteções existentes foram preservados. Consulte o estado e tente novamente.',
  };
}
