import { createHash, randomUUID } from 'node:crypto';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  durableFile,
  moveDurable,
  ensureDirectory,
  regularFile,
  safeDirectory,
  BackupError,
} from './io';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class PolicyStore<T> {
  private hash?: string;
  private sequence = 0;
  id: string = randomUUID();
  interruptedInitialization = false;
  interruptionKey?: string;
  private readonly directory: string;
  private rootKey = '';
  constructor(
    private readonly root: string,
    private readonly validate: (value: unknown) => T,
  ) {
    this.directory = join(root, 'backup-policy');
  }
  async load(initial: () => T): Promise<T> {
    await safeDirectory(this.root);
    const identity = await lstat(this.root);
    this.rootKey = digest([
      resolve(this.root).toLowerCase(),
      identity.dev,
      identity.ino,
      identity.birthtimeMs,
    ]);
    await ensureDirectory(this.directory);
    const leftovers = (await readdir(this.directory)).filter((n) => n !== 'state.json').sort();
    if (leftovers.length > 128) throw new BackupError('POLICY_STORAGE');
    if (leftovers.length) {
      const identities = [];
      for (const name of leftovers) {
        const s = await lstat(join(this.directory, name));
        identities.push([name, s.dev, s.ino, s.birthtimeMs, s.size, s.mtimeMs]);
      }
      this.interruptionKey = digest(identities);
    }
    const file = join(this.directory, 'state.json');
    try {
      const b = await this.read();
      this.id = b.id;
      this.sequence = b.sequence;
      this.hash = b.hash;
      return this.validate(b.state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new BackupError('POLICY_STORAGE');
      // Unknown/unfinished files are preserved. They cannot authorize retention.
      const state = initial();
      this.interruptedInitialization = (await readdir(this.directory)).length > 0;
      await this.save(state);
      await regularFile(file, 8 * 1024 * 1024);
      return state;
    }
  }
  private async read() {
    await safeDirectory(this.directory);
    const file = join(this.directory, 'state.json');
    await regularFile(file, 8 * 1024 * 1024);
    const envelope = JSON.parse(await readFile(file, 'utf8'));
    const { hash, ...body } = envelope;
    if (
      Object.keys(envelope).sort().join(',') !== 'app,hash,id,rootKey,sequence,state,version' ||
      body.app !== 'br.com.mnrsoftware.mnrperfumes.backup-policy' ||
      body.version !== 1 ||
      body.rootKey !== this.rootKey ||
      !/^[0-9a-f-]{36}$/.test(body.id) ||
      !Number.isSafeInteger(body.sequence) ||
      body.sequence < 1 ||
      hash !== digest(body)
    )
      throw new BackupError('POLICY_STORAGE');
    return envelope as { id: string; sequence: number; hash: string; state: unknown };
  }
  async save(state: T) {
    if (!Number.isSafeInteger(this.sequence + 1)) throw new BackupError('POLICY_STORAGE');
    this.validate(state);
    await safeDirectory(this.directory);
    if (this.hash) {
      if ((await this.read()).hash !== this.hash) throw new BackupError('POLICY_STORAGE');
    }
    const body = {
      app: 'br.com.mnrsoftware.mnrperfumes.backup-policy',
      version: 1,
      rootKey: this.rootKey,
      id: this.id,
      sequence: this.sequence + 1,
      state,
    };
    const hash = digest(body),
      temp = join(this.directory, `.state-${randomUUID()}.partial`);
    const bytes = Buffer.from(JSON.stringify({ ...body, hash }));
    if (bytes.length > 8 * 1024 * 1024) throw new BackupError('POLICY_STORAGE');
    await durableFile(temp, bytes);
    await safeDirectory(this.directory);
    await moveDurable(temp, join(this.directory, 'state.json'), !!this.hash);
    this.hash = hash;
    this.sequence++;
  }
}
