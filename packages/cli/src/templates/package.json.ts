export interface PackageJsonTemplateOptions {
  name: string;
  typescript?: boolean;
}

export function packageJsonTemplate(opts: PackageJsonTemplateOptions): string {
  const { name, typescript = false } = opts;

  const scripts = typescript
    ? {
        build: 'tsc',
        start: 'node dist/index.js',
        dev: 'ts-node src/index.ts',
      }
    : {
        start: 'node index.js',
      };

  const devDeps = typescript
    ? {
        typescript: '^5.7.2',
        '@types/node': '^22.10.0',
      }
    : {};

  return JSON.stringify(
    {
      name,
      version: '0.1.0',
      type: 'module',
      scripts,
      dependencies: {
        '@botinabox/core': 'latest',
        '@botinabox/shared': 'latest',
      },
      devDependencies: devDeps,
    },
    null,
    2,
  );
}
