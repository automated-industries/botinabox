import { execSync } from 'child_process';
import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { PackageUpdate, UpdateManifest } from './types.js';
import { UpdateChecker } from './update-checker.js';
import { BackupManager } from './backup-manager.js';

type UpdatePolicy = 'auto-all' | 'auto-compatible' | 'auto-patch' | 'notify' | 'manual';

export class UpdateManager {
  private backupManager: BackupManager;

  constructor(
    private checker: UpdateChecker,
    private db: DataStore,
    private hooks: HookBus,
    private opts?: {
      projectRoot?: string;
      policy?: UpdatePolicy;
      maintenanceWindow?: { utcHourStart: number; utcHourEnd: number };
    },
  ) {
    this.backupManager = new BackupManager(opts?.projectRoot ?? process.cwd());
  }

  async checkAndNotify(): Promise<UpdateManifest> {
    const manifest = await this.checker.check();
    if (manifest.hasUpdates) {
      await this.hooks.emit('update.available', { manifest });
    }
    return manifest;
  }

  async applyUpdates(updates: PackageUpdate[]): Promise<void> {
    const filtered = this.filterByPolicy(updates);
    if (filtered.length === 0) return;

    if (!this.isInMaintenanceWindow()) {
      await this.hooks.emit('update.deferred', { reason: 'outside maintenance window' });
      return;
    }

    let backupPath: string | undefined;
    const historyIds: string[] = [];

    try {
      backupPath = await this.backupManager.backup();

      for (const update of filtered) {
        const row = this.db.insert('update_history', {
          from_version: update.installedVersion,
          to_version: update.latestVersion,
          status: 'pending',
        });
        historyIds.push(row['id'] as string);
      }

      execSync('pnpm install', {
        cwd: this.opts?.projectRoot ?? process.cwd(),
        stdio: 'ignore',
      });

      for (const id of historyIds) {
        this.db.update('update_history', { id }, { status: 'succeeded' });
      }

      await this.backupManager.cleanup(backupPath);
      await this.hooks.emit('update.completed', { updates: filtered });
    } catch (err) {
      for (const id of historyIds) {
        this.db.update('update_history', { id }, {
          status: 'failed',
          migration_log: String(err),
        });
      }

      if (backupPath) {
        try {
          await this.backupManager.restore(backupPath);
          await this.backupManager.cleanup(backupPath);
        } catch {
          // best effort restore
        }
      }

      await this.hooks.emit('update.failed', { updates: filtered, error: String(err) });
    }
  }

  isInMaintenanceWindow(): boolean {
    const window = this.opts?.maintenanceWindow;
    if (!window) return true; // No window configured = always allowed

    const nowHour = new Date().getUTCHours();
    const { utcHourStart, utcHourEnd } = window;

    if (utcHourStart <= utcHourEnd) {
      return nowHour >= utcHourStart && nowHour < utcHourEnd;
    } else {
      // Wraps midnight
      return nowHour >= utcHourStart || nowHour < utcHourEnd;
    }
  }

  filterByPolicy(updates: PackageUpdate[]): PackageUpdate[] {
    const policy = this.opts?.policy ?? 'notify';
    switch (policy) {
      case 'auto-all':
        return updates;
      case 'auto-compatible':
        return updates.filter((u) => u.updateType !== 'major');
      case 'auto-patch':
        return updates.filter((u) => u.updateType === 'patch');
      case 'notify':
      case 'manual':
      default:
        return [];
    }
  }
}
