import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { rmSync } from 'fs';

export class BackupManager {
  constructor(private projectRoot: string) {}

  async backup(): Promise<string> {
    const backupDir = join(this.projectRoot, '.botinabox-backup');
    mkdirSync(backupDir, { recursive: true });
    const src = join(this.projectRoot, 'pnpm-lock.yaml');
    const dest = join(backupDir, 'pnpm-lock.yaml.bak');
    copyFileSync(src, dest);
    return dest;
  }

  async restore(backupPath: string): Promise<void> {
    const dest = join(this.projectRoot, 'pnpm-lock.yaml');
    copyFileSync(backupPath, dest);
  }

  async cleanup(backupPath: string): Promise<void> {
    rmSync(backupPath, { force: true });
  }
}
