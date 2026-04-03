import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PackageUpdate, UpdateManifest } from './types.js';
import { classifyUpdate, compareVersions } from './version-utils.js';

export class UpdateChecker {
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(
    private nodeModulesPath: string,
    private opts?: { fetch?: typeof globalThis.fetch },
  ) {
    this.fetchFn = opts?.fetch ?? globalThis.fetch;
  }

  getInstalledPackages(): string[] {
    try {
      const botinaboxPath = join(this.nodeModulesPath, '@botinabox');
      const entries = readdirSync(botinaboxPath, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  async check(packageNames?: string[]): Promise<UpdateManifest> {
    const installed = packageNames ?? this.getInstalledPackages();
    const updates: PackageUpdate[] = [];

    for (const pkg of installed) {
      try {
        const pkgJsonPath = join(this.nodeModulesPath, '@botinabox', pkg, 'package.json');
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { version?: string };
        const installedVersion = pkgJson.version ?? '0.0.0';

        const response = await this.fetchFn(
          `https://registry.npmjs.org/@botinabox/${pkg}`,
        );
        if (!response.ok) continue;

        const data = await response.json() as { 'dist-tags'?: { latest?: string } };
        const latestVersion = data['dist-tags']?.['latest'];
        if (!latestVersion) continue;

        if (compareVersions(latestVersion, installedVersion) > 0) {
          const updateType = classifyUpdate(installedVersion, latestVersion);
          if (updateType !== 'none') {
            updates.push({
              name: `@botinabox/${pkg}`,
              installedVersion,
              latestVersion,
              updateType,
            });
          }
        }
      } catch {
        // Gracefully skip on error
        continue;
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      packages: updates,
      hasUpdates: updates.length > 0,
    };
  }
}
