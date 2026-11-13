import type Database from 'better-sqlite3';
import { mkdir, readdir, realpath, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename, extname, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BackupReview, BackupSummary, BackupStatus } from '../../../shared/backup';
import type { FotoService } from '../fotos';
import { record } from '../catalog-validation';
import { DataGate } from './gate';
import { backupJob } from './jobs';
import { removeExternalStaging } from './ownership';
import {
  newOwnedSet,
  recoveryPaths,
  removeOwnedSet,
  armRestore,
  lastRecovery,
  initializeRecovery,
} from './control';
import {
  BackupError,
  checkedId,
  hashFile,
  moveDurable,
  regularFile,
  safeDirectory,
  spaceFor,
} from './io';
export interface BackupDependencies {
  root: string;
  db: Database.Database;
  photos: FotoService;
  version: string;
  protectedRoots: string[];
  chooseBackup: (name: string) => Promise<string | undefined>;
  chooseRestore: () => Promise<string | undefined>;
  restart: () => void;
  openProtections: () => Promise<void>;
  warning?: string;
}
export class BackupController {
  private busy = false;
  private phase = 'Pronto';
  private review?: { id: string; path: string; hash: string; summary: BackupReview };
  private confirmed?: string;
  private cleanupWarning?: string;
  restarting = false;
  readonly gate: DataGate;
  constructor(
    private readonly deps: BackupDependencies,
    gate?: DataGate,
  ) {
    this.gate = gate ?? new DataGate();
    this.cleanupWarning = deps.warning;
  }
  get occupied() {
    return this.busy || this.restarting;
  }
  async status(): Promise<BackupStatus> {
    await initializeRecovery(this.deps.root);
    const p = recoveryPaths(this.deps.root);
    return {
      ocupado: this.occupied,
      fase: this.phase,
      bloqueado: this.gate.blocked,
      resultado: await lastRecovery(this.deps.root),
      protecoes: (await readdir(p.protection)).filter((n) => /^[0-9a-f-]{36}\.mnrbackup$/.test(n))
        .length,
      aviso: this.cleanupWarning,
    };
  }
  private async discardSet(id: string) {
    try {
      await removeOwnedSet(this.deps.root, 'sets', id);
    } catch {
      this.cleanupWarning = 'Um staging foi preservado para verificação na pasta de proteção.';
    }
  }
  async discard(input: unknown) {
    const r = record(input, ['token']);
    const id = checkedId(r['token']);
    if (this.occupied) throw new BackupError('BUSY');
    if (this.review?.id !== id) throw new BackupError('STALE_REVIEW');
    this.review = undefined;
    await this.discardSet(id);
    return null;
  }
  private async destination(selected: string) {
    const target = resolve(extname(selected) ? selected : selected + '.mnrbackup'),
      name = basename(target),
      parent = await realpath(dirname(target));
    if (
      extname(name).toLowerCase() !== '.mnrbackup' ||
      /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(name)
    )
      throw new BackupError('UNSAFE_STORAGE');
    for (const root of this.deps.protectedRoots) {
      const canonical = await realpath(root),
        rel = relative(canonical, parent);
      if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)))
        throw new BackupError('UNSAFE_STORAGE');
    }
    return { target: join(parent, name), parent, name };
  }
  async create() {
    if (this.occupied) throw new BackupError('BUSY');
    this.busy = true;
    this.phase = 'Escolhendo destino';
    let work: Awaited<ReturnType<typeof newOwnedSet>> | undefined, external: string | undefined;
    try {
      const selected = await this.deps.chooseBackup(
        `MNR-Perfumes-${new Date().toISOString().replace(/[:.]/g, '-')}.mnrbackup`,
      );
      if (!selected) return null;
      const dest = await this.destination(selected);
      try {
        await lstat(dest.target);
        throw new BackupError('EEXIST');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      work = await newOwnedSet(this.deps.root, 'work');
      this.phase = 'Aguardando operações; preparando captura consistente';
      const summary = await this.gate.protect(async () =>
        this.deps.photos.withLock(async () => {
          this.phase = 'Capturando banco e fotografias; alterações temporariamente pausadas';
          return backupJob<BackupSummary>({
            task: 'capture',
            database: this.deps.db.name,
            images: this.deps.photos.directory,
            target: work!.path,
            version: this.deps.version,
          });
        }),
      );
      this.phase = 'Validando e gerando o pacote; operações normais liberadas';
      await spaceFor(dest.parent, summary.bytes + 32 * 1024 ** 2);
      const candidate = join(dest.parent, `.mnr-backup-${randomUUID()}.partial`);
      await mkdir(candidate);
      external = candidate;
      await safeDirectory(external);
      const partial = join(external, 'archive.partial');
      const result = await backupJob<{ size: number; sha256: string }>({
        task: 'package',
        source: work.path,
        target: partial,
      });
      this.phase = 'Publicando o backup validado';
      await moveDurable(partial, dest.target);
      const final = await hashFile(dest.target);
      if (final.size !== result.size || final.sha256 !== result.sha256)
        throw new BackupError('PUBLISH_FAILED');
      return { nome: dest.name, criadoEm: summary.criadoEm, bytes: result.size };
    } finally {
      if (external) {
        try {
          await removeExternalStaging(external);
        } catch {
          /* Preserve unknown or inaccessible files. */
        }
      }
      if (work) {
        try {
          await removeOwnedSet(this.deps.root, 'work', work.id);
        } catch {
          this.cleanupWarning = 'Temporários próprios foram preservados para verificação.';
        }
      }
      this.busy = false;
      if (!this.restarting) this.phase = 'Pronto';
    }
  }
  async inspect() {
    if (this.occupied) throw new BackupError('BUSY');
    this.busy = true;
    this.phase = 'Selecionando backup';
    let prepared: Awaited<ReturnType<typeof newOwnedSet>> | undefined;
    try {
      const selected = await this.deps.chooseRestore();
      if (!selected) return null;
      await regularFile(selected);
      if (this.review) {
        await this.discardSet(this.review.id);
        this.review = undefined;
      }
      const layout = await initializeRecovery(this.deps.root);
      if ((await readdir(layout.sets)).length >= 8) throw new BackupError('RETENTION');
      prepared = await newOwnedSet(this.deps.root, 'sets');
      this.phase = 'Validando formato, banco, histórico e fotografias';
      const summary = await backupJob<BackupSummary>({
        task: 'inspect',
        source: selected,
        target: prepared.path,
      });
      const hash = (await hashFile(join(prepared.path, 'manifest.json'))).sha256;
      this.review = {
        id: prepared.id,
        path: prepared.path,
        hash,
        summary: { ...summary, token: prepared.id },
      };
      return this.review.summary;
    } catch (error) {
      if (prepared) await this.discardSet(prepared.id);
      throw error;
    } finally {
      this.busy = false;
      this.phase = 'Pronto';
    }
  }
  async restore(input: unknown) {
    const r = record(input, ['token', 'confirmacao']),
      token = checkedId(r['token']);
    if (r['confirmacao'] !== 'RESTAURAR') throw new BackupError('STALE_REVIEW');
    if (this.confirmed === token) return { reiniciando: true as const };
    if (this.occupied) throw new BackupError('BUSY');
    if (this.review?.id !== token) throw new BackupError('STALE_REVIEW');
    const selected = this.review;
    this.busy = true;
    let arming = false;
    let work: Awaited<ReturnType<typeof newOwnedSet>> | undefined;
    try {
      await this.gate.protect(
        async () =>
          this.deps.photos.withLock(async () => {
            this.phase = 'Validando novamente o conjunto selecionado';
            if ((await hashFile(join(selected.path, 'manifest.json'))).sha256 !== selected.hash)
              throw new BackupError('STALE_REVIEW');
            await backupJob({ task: 'validate', source: selected.path });
            this.phase = 'Criando e validando proteção dos dados atuais';
            const archivePath = join(
              recoveryPaths(this.deps.root).protection,
              token + '.mnrbackup',
            );
            const previous = await lstat(archivePath).then(
              () => true,
              (e) => {
                if (e.code === 'ENOENT') return false;
                throw e;
              },
            );
            if (previous) throw new BackupError('STALE_REVIEW');
            work = await newOwnedSet(this.deps.root, 'work');
            const current = await backupJob<BackupSummary>({
              task: 'capture',
              database: this.deps.db.name,
              images: this.deps.photos.directory,
              target: work.path,
              version: this.deps.version,
            });
            const layout = recoveryPaths(this.deps.root);
            if (
              (await readdir(layout.protection)).filter((n) => n.endsWith('.mnrbackup')).length >= 8
            )
              throw new BackupError('RETENTION');
            await spaceFor(layout.protection, current.bytes + selected.summary.bytes);
            const temporary = join(work.path, 'archive.partial');
            const copied = await backupJob<{ size: number; sha256: string }>({
              task: 'package',
              source: work.path,
              target: temporary,
            });
            await moveDurable(temporary, join(layout.protection, token + '.mnrbackup'));
            this.phase = 'Registrando plano durável de restauração';
            arming = true;
            await armRestore(this.deps.root, token, copied.sha256, selected.hash);
            this.confirmed = token;
            this.restarting = true;
            this.phase = 'Reiniciando para ativar e validar os dados; ainda não concluído';
          }),
        true,
      );
      return { reiniciando: true as const };
    } catch (error) {
      // An interrupted durable move can have an uncertain outcome. Once intent
      // recording starts, never release normal writes in this process.
      if (arming) {
        this.confirmed = token;
        this.restarting = true;
        this.phase = 'Reiniciando para verificar o plano ou recuperar o conjunto anterior';
        return { reiniciando: true as const };
      }
      if (!this.restarting) this.gate.reopen();
      throw error;
    } finally {
      if (work) {
        try {
          await removeOwnedSet(this.deps.root, 'work', work.id);
        } catch {
          this.cleanupWarning = 'Staging de proteção preservado para verificação.';
        }
      }
      this.busy = false;
      if (!this.restarting) this.phase = 'Pronto';
      else this.deps.restart();
    }
  }
  async openProtections() {
    if (this.occupied) throw new BackupError('BUSY');
    await initializeRecovery(this.deps.root);
    await this.deps.openProtections();
    return null;
  }
}
