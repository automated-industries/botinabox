export type HookHandler = (context: Record<string, unknown>) => Promise<void> | void;
export type Unsubscribe = () => void;

export interface HookOptions {
  /** 0–100, default 50. Lower = runs first. */
  priority?: number;
  /** Auto-unsubscribe after first invocation. */
  once?: boolean;
  /** Only fire if context matches all filter key/value pairs. */
  filter?: Record<string, unknown>;
}

export interface HookRegistration {
  event: string;
  handler: HookHandler;
  priority: number;
  once: boolean;
  filter?: Record<string, unknown>;
  /** Internal auto-increment for stable sort within same priority */
  id: number;
}
