import { createWriteStream } from 'node:fs';
import { spawnProcess, killProcessGroup } from './process-manager.js';
import { extractOutput } from './output-extractor.js';

/**
 * Inputs to the CLI argument builder. Kept as a separate type so the
 * pure arg-construction function is unit-testable without spawning a process.
 */
export interface CliArgBuildInput {
  prompt: string;
  skipPermissions?: boolean;
  sessionId?: string;
  settings?: string;
  appendSystemPrompt?: string;
  addDirs?: string[];
  extraArgs?: string[];
}

/**
 * Build the argv array passed to the `claude` binary.
 *
 * Order matters for the `claude` CLI: flags come first, then `--print` with
 * the prompt as the final positional argument. This function exists so the
 * argv shape can be asserted in tests without a real subprocess.
 */
export function buildCliArgs(input: CliArgBuildInput): string[] {
  const args: string[] = [];

  if (input.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (input.sessionId) {
    args.push('--session-id', input.sessionId);
  }

  if (input.settings) {
    args.push('--settings', input.settings);
  }

  if (input.appendSystemPrompt) {
    args.push('--append-system-prompt', input.appendSystemPrompt);
  }

  if (input.addDirs && input.addDirs.length > 0) {
    args.push('--add-dir', ...input.addDirs);
  }

  if (input.extraArgs && input.extraArgs.length > 0) {
    args.push(...input.extraArgs);
  }

  args.push('--print', input.prompt);

  return args;
}

export class CliExecutionAdapter {
  readonly type = 'cli';

  async execute(ctx: {
    agent: { id: string; cwd?: string; adapter_config?: string; skip_permissions?: boolean };
    task: { title: string; description?: string; context?: string };
    /**
     * Optional Claude Code session UUID. When provided, passed as `--session-id`
     * so the same UUID on subsequent calls resumes the same conversation.
     * Callers typically derive this deterministically from a stable conversation
     * key (e.g. thread identifier) so multi-turn exchanges maintain history.
     */
    sessionId?: string;
    /**
     * Value for `--settings`. Accepts a JSON string or a path to a settings
     * file. Use this to override settings like `autoMemoryDirectory` without
     * mutating the caller's global config.
     */
    settings?: string;
    /** Value for `--append-system-prompt`. */
    appendSystemPrompt?: string;
    /** Additional directories passed via `--add-dir`. */
    addDirs?: string[];
    /** Extra CLI flags appended before the positional prompt. */
    extraArgs?: string[];
    logPath?: string;
    onLog?: (stream: string, chunk: string) => void;
    abortSignal?: AbortSignal;
  }): Promise<{ output: string; exitCode: number }> {
    const cwd = ctx.agent.cwd ?? process.cwd();

    let config: Record<string, unknown> = {};
    if (ctx.agent.adapter_config) {
      try {
        config = JSON.parse(ctx.agent.adapter_config) as Record<string, unknown>;
      } catch {
        // Ignore invalid config
      }
    }

    const skipPermissions =
      ctx.agent.skip_permissions ?? (config['skip_permissions'] as boolean | undefined) ?? false;

    const prompt = [ctx.task.title, ctx.task.description, ctx.task.context]
      .filter(Boolean)
      .join('\n\n');

    const args = buildCliArgs({
      prompt,
      skipPermissions,
      sessionId: ctx.sessionId,
      settings: ctx.settings,
      appendSystemPrompt: ctx.appendSystemPrompt,
      addDirs: ctx.addDirs,
      extraArgs: ctx.extraArgs,
    });

    const child = spawnProcess('claude', args, { cwd });

    const stdoutChunks: Buffer[] = [];
    let logStream: ReturnType<typeof createWriteStream> | null = null;

    if (ctx.logPath) {
      logStream = createWriteStream(ctx.logPath, { flags: 'a' });
    }

    const abortHandler = () => {
      if (child.pid != null) {
        killProcessGroup(child.pid);
      }
    };

    ctx.abortSignal?.addEventListener('abort', abortHandler);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      const str = chunk.toString('utf8');
      ctx.onLog?.('stdout', str);
      logStream?.write(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      ctx.onLog?.('stderr', str);
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => {
        resolve(code ?? 1);
      });
      child.on('error', () => {
        resolve(1);
      });
    });

    ctx.abortSignal?.removeEventListener('abort', abortHandler);
    logStream?.end();

    const rawOutput = Buffer.concat(stdoutChunks).toString('utf8');
    const output = extractOutput(rawOutput);

    return { output, exitCode };
  }
}
