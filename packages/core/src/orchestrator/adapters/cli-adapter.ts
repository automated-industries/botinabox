import { createWriteStream } from 'node:fs';
import { spawnProcess, killProcessGroup } from './process-manager.js';
import { extractOutput } from './output-extractor.js';

export class CliExecutionAdapter {
  readonly type = 'cli';

  async execute(ctx: {
    agent: { id: string; cwd?: string; adapter_config?: string; skip_permissions?: boolean };
    task: { title: string; description?: string; context?: string };
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

    const args: string[] = [];
    if (skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Build prompt from task
    const prompt = [
      ctx.task.title,
      ctx.task.description,
      ctx.task.context,
    ]
      .filter(Boolean)
      .join('\n\n');

    // Append prompt as final argument (--print mode)
    args.push('--print', prompt);

    const child = spawnProcess('claude', args, { cwd });

    const stdoutChunks: Buffer[] = [];
    let logStream: ReturnType<typeof createWriteStream> | null = null;

    if (ctx.logPath) {
      logStream = createWriteStream(ctx.logPath, { flags: 'a' });
    }

    // Set up abort handler
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
