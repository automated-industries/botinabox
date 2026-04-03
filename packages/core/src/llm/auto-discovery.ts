import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMProvider } from "./types.js";

type Importer = (packageName: string) => Promise<unknown>;

/**
 * Scans nodeModulesPath/@botinabox/{pkg}/package.json for each package in the scope.
 * If pkg.botinabox?.type === 'provider', dynamically imports the package
 * and returns the discovered LLMProvider instances.
 *
 * The optional importer parameter allows injection for testing.
 */
export async function discoverProviders(
  nodeModulesPath: string,
  importer: Importer = (name) => import(name),
): Promise<LLMProvider[]> {
  const scopeDir = join(nodeModulesPath, "@botinabox");

  let entries: string[];
  try {
    entries = await readdir(scopeDir);
  } catch {
    // No @botinabox scope directory — gracefully return empty
    return [];
  }

  const providers: LLMProvider[] = [];

  for (const entry of entries) {
    const pkgPath = join(scopeDir, entry, "package.json");
    let pkg: Record<string, unknown>;

    try {
      const raw = await readFile(pkgPath, "utf8");
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    const botinabox = pkg.botinabox as Record<string, unknown> | undefined;
    if (botinabox?.type !== "provider") {
      continue;
    }

    const packageName = pkg.name as string | undefined;
    if (!packageName) {
      continue;
    }

    try {
      const mod = await importer(packageName) as { default?: LLMProvider } | LLMProvider;
      const provider = "default" in mod && mod.default ? mod.default : (mod as LLMProvider);
      providers.push(provider);
    } catch {
      // Failed to import — skip silently
    }
  }

  return providers;
}
