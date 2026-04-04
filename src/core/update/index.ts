export type { PackageUpdate, UpdateManifest } from './types.js';
export { parseVersion, compareVersions, classifyUpdate } from './version-utils.js';
export { UpdateChecker } from './update-checker.js';
export { BackupManager } from './backup-manager.js';
export { UpdateManager } from './update-manager.js';
export { runPackageMigrations } from './migration-hooks.js';
export type { PackageMigration } from './migration-hooks.js';
export { autoUpdate } from './auto-update.js';
