import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { filterEnv } from './env-whitelist.js';

export interface SpawnOpts {
  cwd: string;
  allowedEnvVars?: string[];
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Spawn a process with its own PGID (detached=true) and piped stdio.
 */
export function spawnProcess(
  command: string,
  args: string[],
  opts: SpawnOpts,
): ChildProcess {
  const env = filterEnv(opts.allowedEnvVars, opts.extraEnv);

  const child = spawn(command, args, {
    cwd: opts.cwd,
    env,
    detached: true,
    stdio: 'pipe',
  });

  return child;
}

/**
 * Kill an entire process group by negative PID.
 */
export function killProcessGroup(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Process may already be gone
  }
}
