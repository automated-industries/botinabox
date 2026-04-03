import { appendFileSync } from 'node:fs';

export class NdjsonLogger {
  constructor(private logPath: string) {}

  log(stream: 'stdout' | 'stderr', chunk: string): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      stream,
      chunk,
    });
    appendFileSync(this.logPath, line + '\n', 'utf8');
  }

  close(): void {
    // No-op — synchronous writes flush immediately
  }
}
