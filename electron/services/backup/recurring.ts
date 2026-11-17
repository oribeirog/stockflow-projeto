import { lstat, unlink } from 'node:fs/promises';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  backupDue,
  initialUsage,
  recordUsage,
  satisfyUsage,
  usageDaysRemaining,
  type UsageCycle,
  type RecurringBackupStatus,
  type BackupDeferral,
} from '../../../shared/backup-policy';
import { BackupController, type PublishedBackup } from './controller';
import { PolicyStore } from './policy-store';
import { BackupError, backupMessage, hashFile, safeDirectory, regularFile } from './io';
import { newOwnedSet, removeOwnedSet } from './control';
import { backupJob } from './jobs';
import { record } from '../catalog-validation';

interface DirectoryRef {
  path: string;
  dev: number;
  ino: number;
  birthtimeMs: number;
}
interface Receipt {
  proof: PublishedBackup;
  directory: DirectoryRef;
  day: string;
}
interface State {
  cycle: UsageCycle;
  enabled: boolean;
  retention: 3 | 7 | 14 | 30;
  destination?: DirectoryRef;
  last?: RecurringBackupStatus['ultimoBackup'];
  attemptDay?: string;
  deferredAt?: string;
  recoveryKey?: string;
  seenArtifacts?: string;
  inProgress?: boolean;
  retentionWarning?: string;
  error?: string;
  pending?: Receipt;
  files: Receipt[];
  history: RecurringBackupStatus['historico'];
}
const initial = (): State => ({
  cycle: initialUsage(),
  enabled: true,
  retention: 7,
  files: [],
  history: [],
});
const dateValid = (d: unknown): d is string =>
  typeof d === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(Date.parse(d + 'T12:00:00Z')) &&
  new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
function validate(value: unknown): State {
  const x = record(value, [
    'cycle',
    'enabled',
    'retention',
    'destination',
    'last',
    'attemptDay',
    'deferredAt',
    'recoveryKey',
    'error',
    'pending',
    'files',
    'history',
    'seenArtifacts',
    'inProgress',
    'retentionWarning',
  ]);
  const c = record(x['cycle'], [
    'count',
    'days',
    'anchor',
    'satisfiedDay',
    'clockWarning',
    'forced',
  ]);
  if (
    !Number.isSafeInteger(c['count']) ||
    (c['count'] as number) < 0 ||
    !Array.isArray(c['days']) ||
    c['days'].length > 3 ||
    !c['days'].every(dateValid) ||
    new Set(c['days']).size !== c['days'].length ||
    typeof c['clockWarning'] !== 'boolean' ||
    typeof c['forced'] !== 'boolean' ||
    typeof x['enabled'] !== 'boolean' ||
    ![3, 7, 14, 30].includes(x['retention'] as number) ||
    !Array.isArray(x['files']) ||
    x['files'].length > 512 ||
    !Array.isArray(x['history']) ||
    x['history'].length > 50
  )
    throw new BackupError('POLICY_STORAGE');
  for (const d of [c['anchor'], c['satisfiedDay'], x['attemptDay']])
    if (d !== undefined && !dateValid(d)) throw new BackupError('POLICY_STORAGE');
  const directory = (v: unknown) => {
    const d = record(v, ['path', 'dev', 'ino', 'birthtimeMs']);
    if (
      typeof d['path'] !== 'string' ||
      !isAbsolute(d['path']) ||
      d['path'].length > 32760 ||
      !['dev', 'ino', 'birthtimeMs'].every((k) => typeof d[k] === 'number' && Number.isFinite(d[k]))
    )
      throw new BackupError('POLICY_STORAGE');
  };
  if (x['destination']) directory(x['destination']);
  for (const v of [...x['files'], ...(x['pending'] ? [x['pending']] : [])]) {
    const r = record(v, ['proof', 'directory', 'day']);
    directory(r['directory']);
    const p = record(r['proof'], [
      'path',
      'name',
      'createdAt',
      'size',
      'sha256',
      'identity',
      'kind',
    ]);
    if (
      !dateValid(r['day']) ||
      typeof p['path'] !== 'string' ||
      !isAbsolute(p['path']) ||
      basename(p['path']) !== p['name'] ||
      typeof p['sha256'] !== 'string' ||
      !/^[0-9a-f]{64}$/.test(p['sha256']) ||
      !Number.isSafeInteger(p['size']) ||
      !['manual', 'automatico'].includes(p['kind'] as string) ||
      typeof p['createdAt'] !== 'string'
    )
      throw new BackupError('POLICY_STORAGE');
    const id = record(p['identity'], ['dev', 'ino', 'birthtimeMs']);
    if (!Object.values(id).every((n) => typeof n === 'number' && Number.isFinite(n)))
      throw new BackupError('POLICY_STORAGE');
  }
  for (const v of x['history']) {
    const h = record(v, ['em', 'evento', 'mensagem']);
    for (const k of ['em', 'evento', 'mensagem'])
      if (typeof h[k] !== 'string' || (h[k] as string).length > 2048)
        throw new BackupError('POLICY_STORAGE');
  }
  if (x['last'] !== undefined) {
    const l = record(x['last'], ['nome', 'criadoEm', 'tipo']);
    if (
      typeof l['nome'] !== 'string' ||
      l['nome'].length > 255 ||
      typeof l['criadoEm'] !== 'string' ||
      !Number.isFinite(Date.parse(l['criadoEm'])) ||
      !['manual', 'automatico'].includes(l['tipo'] as string)
    )
      throw new BackupError('POLICY_STORAGE');
  }
  for (const k of ['deferredAt', 'recoveryKey', 'error', 'seenArtifacts', 'retentionWarning'])
    if (x[k] !== undefined && (typeof x[k] !== 'string' || (x[k] as string).length > 2048))
      throw new BackupError('POLICY_STORAGE');
  if (x['inProgress'] !== undefined && typeof x['inProgress'] !== 'boolean')
    throw new BackupError('POLICY_STORAGE');
  return value as State;
}
export function localBackupDay(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export class RecurringBackupService {
  private state = initial();
  private readonly store: PolicyStore<State>;
  private tail: Promise<unknown> = Promise.resolve();
  private ready = false;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private storageError = false;
  private warning?: string;
  private stopped = false;
  private readonly initialized: Promise<void>;
  private finishInitialization!: () => void;
  get occupied() {
    return this.running;
  }
  constructor(
    private readonly options: {
      root: string;
      backup: BackupController;
      chooseFolder: () => Promise<string | undefined>;
      now?: () => Date;
    },
  ) {
    this.initialized = new Promise((resolve) => {
      this.finishInitialization = resolve;
    });
    this.store = new PolicyStore(options.root, validate);
    options.backup.setEvents({
      prepared: async (proof) => {
        try {
          await this.prepared(proof);
        } catch (e) {
          this.storageError = true;
          if (proof.kind === 'automatico') throw e;
        }
      },
      completed: async (proof) => {
        try {
          await this.completed(proof);
        } catch (e) {
          this.storageError = true;
          if (proof.kind === 'automatico') throw e;
        }
      },
    });
  }
  private now() {
    return (this.options.now ?? (() => new Date()))();
  }
  private change(update: (s: State) => void) {
    const operation = this.tail.then(async () => {
      if (this.storageError) throw new BackupError('POLICY_STORAGE');
      const next = structuredClone(this.state);
      update(next);
      if (JSON.stringify(next) === JSON.stringify(this.state)) return;
      try {
        await this.store.save(next);
      } catch (e) {
        this.storageError = true;
        throw e;
      }
      this.state = next;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  private history(s: State, event: string, message: string) {
    s.history.push({ em: this.now().toISOString(), evento: event, mensagem: message });
    s.history = s.history.slice(-50);
  }
  async start(recoveryInput?: BackupStatusResult | Promise<BackupStatusResult | undefined>) {
    try {
      const recovery = await recoveryInput;
      this.state = await this.store.load(initial);
      if (
        this.store.interruptedInitialization ||
        (this.store.interruptionKey && this.store.interruptionKey !== this.state.seenArtifacts)
      )
        await this.change((s) => {
          s.seenArtifacts = this.store.interruptionKey;
          s.cycle.forced = true;
          this.history(
            s,
            'interrompido',
            'Gravação local anterior incompleta; nova cópia solicitada.',
          );
        });
      if (this.state.pending) await this.reconcilePending();
      else if (this.state.inProgress)
        await this.change((s) => {
          s.inProgress = false;
          s.cycle.forced = true;
          s.error =
            'A execução anterior foi interrompida antes da confirmação. Tente novamente; arquivos existentes foram preservados.';
          this.history(s, 'interrompido', s.error);
        });
      const key = recovery ? JSON.stringify(recovery) : undefined;
      if (key && key !== this.state.recoveryKey)
        await this.change((s) => {
          s.recoveryKey = key;
          s.cycle.forced = true;
          s.attemptDay = undefined;
          this.history(
            s,
            'restauracao',
            'Dados reabertos após recuperação/restauração; nova cópia solicitada.',
          );
        });
    } catch {
      this.storageError = true;
      this.state.cycle.forced = true;
    }
    this.ready = true;
    this.finishInitialization();
  }
  status(): RecurringBackupStatus {
    const due = this.storageError || backupDue(this.state.cycle),
      busy = this.running || this.options.backup.occupied;
    return {
      habilitado: this.state.enabled,
      dias: this.state.cycle.count,
      restantes: due ? 0 : usageDaysRemaining(this.state.cycle),
      devido: due,
      estado: busy
        ? 'executando'
        : this.storageError || this.state.error
          ? 'erro'
          : due
            ? 'devido'
            : this.state.cycle.count === 2
              ? 'proximo'
              : 'atualizado',
      destino: this.state.destination?.path,
      retencao: this.state.retention,
      ultimoBackup: this.state.last,
      erro: this.storageError
        ? 'A configuração local de backup não pôde ser verificada. Os arquivos foram preservados. Crie uma cópia manual e solicite suporte.'
        : this.state.error,
      aviso: this.warning ?? this.state.retentionWarning,
      relogioAlterado: this.state.cycle.clockWarning,
      adiadoEm: this.state.deferredAt,
      historico: [...this.state.history].reverse(),
    };
  }
  async use() {
    if (!this.ready || this.storageError) return this.status();
    const day = localBackupDay(this.now());
    await this.tail;
    const next = recordUsage(this.state.cycle, day);
    if (next !== this.state.cycle)
      await this.change((s) => {
        s.cycle = recordUsage(s.cycle, day);
      });
    if (
      !this.stopped &&
      !this.running &&
      !this.options.backup.occupied &&
      !this.options.backup.reviewing &&
      backupDue(this.state.cycle) &&
      this.state.enabled &&
      this.state.destination &&
      this.state.attemptDay !== day &&
      !this.timer
    ) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.execute(true).catch(() => undefined);
      }, 100);
    }
    return this.status();
  }
  private guard() {
    if (!this.ready || this.running || this.options.backup.occupied) throw new BackupError('BUSY');
    if (this.storageError) throw new BackupError('POLICY_STORAGE');
  }
  async configure(input: unknown) {
    this.guard();
    const r = record(input, ['habilitado', 'retencao']);
    if (typeof r['habilitado'] !== 'boolean' || ![3, 7, 14, 30].includes(r['retencao'] as number))
      throw new BackupError('VALIDATION');
    await this.change((s) => {
      s.enabled = r['habilitado'] as boolean;
      s.retention = r['retencao'] as State['retention'];
      this.history(s, 'configuracao', 'Política de execução e retenção atualizada.');
    });
    return this.status();
  }
  private async directory(path: string): Promise<DirectoryRef> {
    await safeDirectory(path);
    const canonical = (await this.options.backup.destination(join(path, 'probe.mnrbackup'))).parent;
    await safeDirectory(canonical);
    const s = await lstat(canonical);
    return { path: canonical, dev: s.dev, ino: s.ino, birthtimeMs: s.birthtimeMs };
  }
  private async checkDirectory(d: DirectoryRef) {
    const now = await this.directory(d.path);
    if (now.dev !== d.dev || now.ino !== d.ino || now.birthtimeMs !== d.birthtimeMs)
      throw new BackupError('DESTINATION_CHANGED');
  }
  async selectFolder() {
    this.guard();
    const selected = await this.options.chooseFolder();
    if (!selected) return null;
    const d = await this.directory(selected);
    await this.change((s) => {
      s.destination = d;
      s.error = undefined;
      this.history(s, 'destino', 'Pasta autorizada pelo seletor nativo.');
    });
    return this.status();
  }
  async defer(input: unknown) {
    this.guard();
    const r = record(input, ['motivo']);
    if (!['MIDIA_INDISPONIVEL', 'OPERACAO_URGENTE'].includes(r['motivo'] as string))
      throw new BackupError('VALIDATION');
    await this.change((s) => {
      s.deferredAt = this.now().toISOString();
      s.attemptDay = localBackupDay(this.now());
      this.history(
        s,
        'adiamento',
        (r['motivo'] as BackupDeferral) === 'MIDIA_INDISPONIVEL'
          ? 'Mídia indisponível; obrigação permanece.'
          : 'Operação urgente; obrigação permanece.',
      );
    });
    return this.status();
  }
  async execute(automatic = false) {
    this.guard();
    const day = localBackupDay(this.now());
    if (
      automatic &&
      (!this.state.enabled ||
        !backupDue(this.state.cycle) ||
        this.state.attemptDay === day ||
        this.options.backup.reviewing)
    )
      return this.status();
    if (!this.state.destination) throw new BackupError('DESTINATION_REQUIRED');
    this.running = true;
    try {
      if (this.state.pending) {
        await this.reconcilePending();
        if (!backupDue(this.state.cycle)) return this.status();
      }
      await this.change((s) => {
        s.attemptDay = day;
        s.error = undefined;
        s.inProgress = true;
        this.history(
          s,
          'inicio',
          automatic
            ? 'Preparando cópia automática pelo serviço oficial.'
            : 'Preparando cópia manual pelo serviço oficial.',
        );
      });
      const d = this.state.destination!;
      await this.checkDirectory(d);
      if (automatic && this.state.files.length >= 512) throw new BackupError('POLICY_LIMIT');
      const name = `MNR-Gestao-${automatic ? 'Auto' : 'Manual'}-${this.store.id}-${this.now().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.mnrbackup`;
      await this.options.backup.createAutomatic(
        join(d.path, name),
        automatic ? 'automatico' : 'manual',
      );
      if (this.storageError && this.state.last?.nome !== name)
        throw new BackupError('POLICY_STORAGE');
    } catch (error) {
      if (!this.storageError)
        await this.change((s) => {
          s.inProgress = false;
          if (backupDue(s.cycle)) s.error = backupMessage(error).message;
          this.history(s, 'falha', backupMessage(error).message);
        });
      throw error;
    } finally {
      this.running = false;
    }
    return this.status();
  }
  private async prepared(proof: PublishedBackup) {
    await this.initialized;
    if (!this.ready || this.storageError) throw new BackupError('POLICY_STORAGE');
    if (this.state.pending) await this.reconcilePending();
    const directory = await this.directory(dirname(proof.path));
    if (
      proof.kind === 'automatico' &&
      (!this.state.destination ||
        directory.path !== this.state.destination.path ||
        !proof.name.startsWith(`MNR-Gestao-Auto-${this.store.id}-`))
    )
      throw new BackupError('UNSAFE_STORAGE');
    await this.change((s) => {
      s.pending = { proof, directory, day: localBackupDay(this.now()) };
    });
  }
  private async verify(receipt: Receipt) {
    await this.checkDirectory(receipt.directory);
    if (dirname(receipt.proof.path) !== receipt.directory.path)
      throw new BackupError('UNSAFE_STORAGE');
    const file = await regularFile(receipt.proof.path),
      id = receipt.proof.identity;
    if (file.dev !== id.dev || file.ino !== id.ino || file.birthtimeMs !== id.birthtimeMs)
      throw new BackupError('DESTINATION_CHANGED');
    const h = await hashFile(receipt.proof.path);
    if (h.size !== receipt.proof.size || h.sha256 !== receipt.proof.sha256)
      throw new BackupError('INVALID_BACKUP');
  }
  private async commit(receipt: Receipt, day: string) {
    await this.change((s) => {
      s.cycle = satisfyUsage(day);
      s.last = {
        nome: receipt.proof.name,
        criadoEm: this.now().toISOString(),
        tipo: receipt.proof.kind,
      };
      s.error = undefined;
      s.deferredAt = undefined;
      s.pending = undefined;
      s.inProgress = false;
      if (
        receipt.proof.kind === 'automatico' &&
        !s.files.some((r) => r.proof.path === receipt.proof.path)
      )
        s.files.push(receipt);
      this.history(s, 'concluido', 'Backup completo, publicado e verificado.');
    });
    try {
      await this.retain();
    } catch {
      // Publication and durable credit already succeeded. Cleanup is secondary.
      this.warning =
        'Backup concluído e verificado. A limpeza de cópias antigas não pôde terminar; arquivos foram preservados.';
    }
  }
  private async completed(proof: PublishedBackup) {
    const p = this.state.pending;
    if (!p || p.proof.path !== proof.path || p.proof.sha256 !== proof.sha256)
      throw new BackupError('POLICY_STORAGE');
    await this.verify(p);
    await this.commit(p, localBackupDay(this.now()));
  }
  private async reconcilePending() {
    const p = this.state.pending;
    if (!p) return;
    try {
      await this.verify(p);
      const work = await newOwnedSet(this.options.root, 'work');
      try {
        await backupJob({ task: 'inspect', source: p.proof.path, target: work.path });
      } finally {
        try {
          await removeOwnedSet(this.options.root, 'work', work.id);
        } catch {
          this.warning = 'Um staging de verificação foi preservado.';
        }
      }
      await this.commit(p, p.day);
    } catch {
      await this.change((s) => {
        s.pending = undefined;
        s.inProgress = false;
        s.cycle.forced = true;
        s.error =
          'A cópia interrompida não pôde ser confirmada. Os arquivos foram preservados; tente novamente.';
        this.history(s, 'interrompido', s.error!);
      });
    }
  }
  private async retain() {
    let failed = false;
    const obsolete = this.state.files.slice(
      0,
      Math.max(0, this.state.files.length - this.state.retention),
    );
    for (const file of obsolete) {
      try {
        const newest = this.state.files.at(-1);
        if (!newest || newest.proof.path === file.proof.path)
          throw new BackupError('UNSAFE_STORAGE');
        await this.verify(newest);
        if (
          !file.proof.name.startsWith(`MNR-Gestao-Auto-${this.store.id}-`) ||
          basename(file.proof.path) !== file.proof.name
        )
          throw new BackupError('UNSAFE_STORAGE');
        await this.verify(file);
        await this.checkDirectory(file.directory);
        const current = await regularFile(file.proof.path);
        if (
          current.ino !== file.proof.identity.ino ||
          current.dev !== file.proof.identity.dev ||
          current.birthtimeMs !== file.proof.identity.birthtimeMs
        )
          throw new BackupError('DESTINATION_CHANGED');
        await unlink(file.proof.path);
        await this.change((s) => {
          s.files = s.files.filter((r) => r.proof.path !== file.proof.path);
        });
      } catch {
        failed = true;
      }
    }
    await this.change((s) => {
      s.retentionWarning = failed
        ? 'Backup concluído. Algumas cópias antigas foram preservadas porque a limpeza não pôde ser verificada.'
        : undefined;
    });
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
type BackupStatusResult = {
  situacao: 'restaurado' | 'recuperado';
  criadoEm: string;
  protecao: string;
};
