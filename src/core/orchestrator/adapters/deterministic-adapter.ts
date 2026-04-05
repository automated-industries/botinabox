/**
 * DeterministicAdapter — executes scripts without LLM calls.
 * Story 6.1
 *
 * For tasks that don't require reasoning: routing, validation,
 * data fetching, file transforms. Runs a user-specified command
 * (Python, Node, bash) as a subprocess with task context on stdin.
 */

import { spawnProcess, killProcessGroup } from './process-manager.js';

export interface DeterministicConfig {
  command: string;        // e.g. "python", "node", "bash"
  args?: string[];        // e.g. ["scripts/triage.py"]
  env?: Record<string, string>;
  timeoutMs?: number;     // default: 30_000 (30s)
  inputMode?: 'stdin' | 'arg';  // how to pass task context
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class DeterministicAdapter {
  readonly type = 'deterministic';

  async execute(ctx: {
    agent: { id: string; cwd?: string; adapter_config?: string };
    task: { title: string; description?: string; context?: string };
    abortSignal?: AbortSignal;
    onLog?: (stream: string, chunk: string) => void;
  }): Promise<{ output: string; exitCode: number }> {
    const cwd = ctx.agent.cwd ?? process.cwd();

    let config: DeterministicConfig = { command: 'echo' };
    if (ctx.agent.adapter_config) {
      try {
        config = JSON.parse(ctx.agent.adapter_config) as DeterministicConfig;
      } catch {
        throw new Error('Invalid adapter_config for deterministic adapter');
      }
    }

    if (!config.command) {
      throw new Error('Deterministic adapter requires a command');
    }

    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Build task payload as JSON for the script
    const payload = JSON.stringify({
      taskId: ctx.task.title,
      description: ctx.task.description ?? '',
      context: ctx.task.context ?? '',
    });

    // Build args — append payload as final arg in 'arg' mode
    const args = [...(config.args ?? [])];
    if (config.inputMode === 'arg') {
      args.push(payload);
    }

    const child = spawnProcess(config.command, args, {
      cwd,
      extraEnv: config.env,
    });

    // Write payload to stdin in default mode
    if (config.inputMode !== 'arg' && child.stdin) {
      child.stdin.write(payload);
      child.stdin.end();
    }

    const stdoutChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      ctx.onLog?.('stdout', chunk.toString('utf8'));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      ctx.onLog?.('stderr', chunk.toString('utf8'));
    });

    // Set up abort + timeout
    const abortHandler = () => {
      if (child.pid != null) killProcessGroup(child.pid);
    };
    ctx.abortSignal?.addEventListener('abort', abortHandler);

    const timeout = setTimeout(() => {
      if (child.pid != null) killProcessGroup(child.pid);
    }, timeoutMs);

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });

    clearTimeout(timeout);
    ctx.abortSignal?.removeEventListener('abort', abortHandler);

    const output = Buffer.concat(stdoutChunks).toString('utf8');
    return { output, exitCode };
  }
}
