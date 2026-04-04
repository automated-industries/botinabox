/**
 * Auto-update — checks npm for newer versions of botinabox and its
 * dependencies, installs them if outdated. Call at app startup before
 * initializing the framework.
 *
 * Usage:
 *   import { autoUpdate } from 'botinabox';
 *   await autoUpdate();  // checks + installs if needed
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Strict semver pattern — rejects anything that isn't a clean version string */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

interface UpdateResult {
  updated: boolean;
  packages: Array<{ name: string; from: string; to: string }>;
  restartRequired: boolean;
}

/**
 * Get the installed version of a package from node_modules.
 */
function getInstalledVersion(pkgName: string): string | null {
  try {
    const pkgPath = join(process.cwd(), "node_modules", pkgName, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return null;
  }
}

/**
 * Get the latest version from the npm registry.
 */
async function getLatestVersion(pkgName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Check npm for newer versions of framework packages and install them.
 * Returns what was updated. Safe to call on every startup — skips if
 * already on latest.
 *
 * @param packages - Package names to check (default: botinabox + latticesql)
 * @param opts.quiet - Suppress console output (default: false)
 */
export async function autoUpdate(
  packages = ["botinabox", "latticesql"],
  opts?: { quiet?: boolean },
): Promise<UpdateResult> {
  const log = opts?.quiet ? () => {} : console.log;
  const result: UpdateResult = { updated: false, packages: [], restartRequired: false };
  const toInstall: string[] = [];

  for (const pkg of packages) {
    const installed = getInstalledVersion(pkg);
    if (!installed) continue;

    const latest = await getLatestVersion(pkg);
    if (!latest) continue;

    if (isNewer(latest, installed)) {
      if (!SEMVER_RE.test(latest)) {
        console.error(`[autoUpdate] Rejecting invalid version "${latest}" for ${pkg}`);
        continue;
      }
      toInstall.push(`${pkg}@${latest}`);
      result.packages.push({ name: pkg, from: installed, to: latest });
    }
  }

  if (toInstall.length === 0) return result;

  log(`[autoUpdate] Updating: ${toInstall.join(", ")}`);

  try {
    execFileSync("npm", ["install", ...toInstall], {
      cwd: process.cwd(),
      stdio: opts?.quiet ? "ignore" : "inherit",
      timeout: 60_000,
    });
    result.updated = true;
    result.restartRequired = true;
    log(`[autoUpdate] Updated successfully. Restart required for changes to take effect.`);
  } catch (err) {
    console.error("[autoUpdate] Failed to install updates:", err);
  }

  return result;
}
