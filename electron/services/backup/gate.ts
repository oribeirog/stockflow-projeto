import type { Result } from '../../../shared/contracts';
import { BackupError } from './io';
export class DataGate {
  private active = 0;
  private exclusive = false;
  private waiters: (() => void)[] = [];
  get blocked() {
    return this.exclusive;
  }
  run<T>(operation: () => T): T | Result<never> {
    if (this.exclusive)
      return {
        ok: false,
        error: {
          code: 'BUSY',
          message:
            'Proteção dos dados em andamento. Aguarde a conclusão antes de repetir a mesma intenção.',
        },
      };
    this.active++;
    const release = () => {
      this.active--;
      if (!this.active) {
        for (const r of this.waiters) r();
        this.waiters = [];
      }
    };
    try {
      const result = operation();
      if (result && typeof (result as unknown as Promise<unknown>).then === 'function')
        return Promise.resolve(result).finally(release) as T;
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }
  async protect<T>(operation: () => Promise<T>, keepClosed = false) {
    if (this.exclusive) throw new BackupError('BUSY');
    this.exclusive = true;
    try {
      if (this.active) await new Promise<void>((r) => this.waiters.push(r));
      return await operation();
    } finally {
      if (!keepClosed) this.exclusive = false;
    }
  }
  reopen() {
    this.exclusive = false;
  }
}
