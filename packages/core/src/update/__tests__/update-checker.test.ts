import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { UpdateChecker } from '../update-checker.js';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `update-checker-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createPackage(name: string, version: string): void {
  const pkgDir = join(tempDir, 'node_modules', '@botinabox', name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: `@botinabox/${name}`, version }));
}

function makeMockFetch(latestVersionMap: Record<string, string>) {
  return async (url: string): Promise<Response> => {
    const match = /registry\.npmjs\.org\/@botinabox\/([^/]+)/.exec(url);
    const pkg = match?.[1];
    if (!pkg || !(pkg in latestVersionMap)) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ 'dist-tags': { latest: latestVersionMap[pkg] } }),
    } as unknown as Response;
  };
}

describe('UpdateChecker — Story 6.1', () => {
  it('getInstalledPackages lists @botinabox/* packages', () => {
    createPackage('core', '1.0.0');
    createPackage('shared', '1.0.0');

    const checker = new UpdateChecker(join(tempDir, 'node_modules'));
    const pkgs = checker.getInstalledPackages();
    expect(pkgs).toContain('core');
    expect(pkgs).toContain('shared');
  });

  it('check returns manifest with updates', async () => {
    createPackage('core', '1.0.0');

    const checker = new UpdateChecker(join(tempDir, 'node_modules'), {
      fetch: makeMockFetch({ core: '1.0.1' }) as typeof globalThis.fetch,
    });

    const manifest = await checker.check(['core']);
    expect(manifest.hasUpdates).toBe(true);
    expect(manifest.packages).toHaveLength(1);
    expect(manifest.packages[0]!.name).toBe('@botinabox/core');
    expect(manifest.packages[0]!.installedVersion).toBe('1.0.0');
    expect(manifest.packages[0]!.latestVersion).toBe('1.0.1');
    expect(manifest.packages[0]!.updateType).toBe('patch');
  });

  it('no updates = hasUpdates false', async () => {
    createPackage('core', '1.0.1');

    const checker = new UpdateChecker(join(tempDir, 'node_modules'), {
      fetch: makeMockFetch({ core: '1.0.1' }) as typeof globalThis.fetch,
    });

    const manifest = await checker.check(['core']);
    expect(manifest.hasUpdates).toBe(false);
    expect(manifest.packages).toHaveLength(0);
  });

  it('minor update classified correctly', async () => {
    createPackage('shared', '1.0.0');

    const checker = new UpdateChecker(join(tempDir, 'node_modules'), {
      fetch: makeMockFetch({ shared: '1.1.0' }) as typeof globalThis.fetch,
    });

    const manifest = await checker.check(['shared']);
    expect(manifest.packages[0]!.updateType).toBe('minor');
  });

  it('major update classified correctly', async () => {
    createPackage('cli', '1.0.0');

    const checker = new UpdateChecker(join(tempDir, 'node_modules'), {
      fetch: makeMockFetch({ cli: '2.0.0' }) as typeof globalThis.fetch,
    });

    const manifest = await checker.check(['cli']);
    expect(manifest.packages[0]!.updateType).toBe('major');
  });

  it('fetch failure returns empty manifest gracefully', async () => {
    createPackage('core', '1.0.0');

    const failingFetch = async (): Promise<Response> => {
      throw new Error('Network error');
    };

    const checker = new UpdateChecker(join(tempDir, 'node_modules'), {
      fetch: failingFetch as unknown as typeof globalThis.fetch,
    });

    const manifest = await checker.check(['core']);
    expect(manifest.hasUpdates).toBe(false);
    expect(manifest.packages).toHaveLength(0);
  });

  it('check uses installed packages when no names provided', async () => {
    createPackage('core', '1.0.0');
    createPackage('shared', '2.0.0');

    const checker = new UpdateChecker(join(tempDir, 'node_modules'), {
      fetch: makeMockFetch({ core: '1.1.0', shared: '2.0.0' }) as typeof globalThis.fetch,
    });

    const manifest = await checker.check();
    expect(manifest.packages).toHaveLength(1);
    expect(manifest.packages[0]!.name).toBe('@botinabox/core');
  });

  it('manifest includes checkedAt timestamp', async () => {
    const checker = new UpdateChecker(join(tempDir, 'node_modules'), {
      fetch: makeMockFetch({}) as typeof globalThis.fetch,
    });

    const manifest = await checker.check([]);
    expect(typeof manifest.checkedAt).toBe('string');
    expect(new Date(manifest.checkedAt).getTime()).toBeGreaterThan(0);
  });
});
