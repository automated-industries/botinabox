import type { RenderEngine } from './engine.js';

export class RenderWatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly engine: RenderEngine,
    private readonly opts: { intervalMs: number },
  ) {}

  start(): void {
    this.reconcile();
    this.intervalId = setInterval(() => {
      this.reconcile();
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reconcile(): void {
    try {
      this.engine.render();
    } catch (err) {
      console.error('[RenderWatcher] reconcile error:', err);
    }
  }
}
