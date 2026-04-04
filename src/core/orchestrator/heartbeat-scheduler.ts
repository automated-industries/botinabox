import type { HookBus } from '../hooks/hook-bus.js';
import type { WakeupQueue } from './wakeup-queue.js';

interface HeartbeatConfig {
  enabled: boolean;
  intervalSec: number;
}

/**
 * @deprecated Use {@link Scheduler} from `botinabox` instead.
 * HeartbeatScheduler uses in-memory setInterval which loses state on restart.
 * The Scheduler class uses database-backed schedules with cron expressions.
 */
export class HeartbeatScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private wakeupQueue: WakeupQueue,
    private hooks: HookBus,
  ) {}

  start(agents: Array<{ id: string; heartbeat_config: string }>): void {
    for (const agent of agents) {
      let config: HeartbeatConfig;
      try {
        config = JSON.parse(agent.heartbeat_config) as HeartbeatConfig;
      } catch {
        continue;
      }

      if (!config.enabled || !config.intervalSec) continue;

      const timer = setInterval(() => {
        void this.wakeupQueue.enqueue(agent.id, 'heartbeat');
      }, config.intervalSec * 1000);

      this.timers.set(agent.id, timer);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
