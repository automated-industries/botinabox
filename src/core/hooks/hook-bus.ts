import type { HookHandler, HookOptions, HookRegistration, Unsubscribe } from "./types.js";

/**
 * Priority-ordered event bus for decoupled inter-layer communication.
 * Story 1.1 — handlers run in priority order, errors are isolated,
 * and registrations are unsubscribable.
 */
export class HookBus {
  private readonly registrations = new Map<string, HookRegistration[]>();
  private nextId = 0;

  register(event: string, handler: HookHandler, opts?: HookOptions): Unsubscribe {
    const reg: HookRegistration = {
      event,
      handler,
      priority: opts?.priority ?? 50,
      once: opts?.once ?? false,
      filter: opts?.filter,
      id: this.nextId++,
    };

    const list = this.registrations.get(event) ?? [];
    list.push(reg);
    // Sort by priority ASC, then id ASC (insertion order tiebreaker)
    list.sort((a, b) => a.priority - b.priority || a.id - b.id);
    this.registrations.set(event, list);

    return () => {
      const arr = this.registrations.get(event);
      if (!arr) return;
      const idx = arr.indexOf(reg);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  async emit(event: string, context: Record<string, unknown>): Promise<void> {
    const list = this.registrations.get(event);
    if (!list || list.length === 0) return;

    // Copy to avoid mutation issues during iteration
    const snapshot = [...list];
    const toRemove: HookRegistration[] = [];

    for (const reg of snapshot) {
      // Filter check: every key/value in filter must match context
      if (reg.filter) {
        const matches = Object.entries(reg.filter).every(([k, v]) => context[k] === v);
        if (!matches) continue;
      }

      try {
        await reg.handler(context);
      } catch (err) {
        // Errors are caught and logged — never block other handlers
        console.error(`[HookBus] Handler error on event "${event}":`, err);
      }

      if (reg.once) toRemove.push(reg);
    }

    // Remove once-handlers after iteration (avoid splice-during-iteration bugs)
    for (const r of toRemove) {
      const arr = this.registrations.get(event);
      if (!arr) continue;
      const idx = arr.indexOf(r);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }

  /** Emit synchronously (use only when async is not needed) */
  emitSync(event: string, context: Record<string, unknown>): void {
    const list = this.registrations.get(event);
    if (!list || list.length === 0) return;

    const snapshot = [...list];
    const toRemove: HookRegistration[] = [];

    for (const reg of snapshot) {
      if (reg.filter) {
        const matches = Object.entries(reg.filter).every(([k, v]) => context[k] === v);
        if (!matches) continue;
      }
      try {
        const result = reg.handler(context);
        if (result instanceof Promise) {
          result.catch(err => console.error(`[HookBus] Async handler error on event "${event}":`, err));
        }
      } catch (err) {
        console.error(`[HookBus] Handler error on event "${event}":`, err);
      }
      if (reg.once) toRemove.push(reg);
    }

    for (const r of toRemove) {
      const arr = this.registrations.get(event);
      if (!arr) continue;
      const idx = arr.indexOf(r);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }

  hasListeners(event: string): boolean {
    return (this.registrations.get(event)?.length ?? 0) > 0;
  }

  listRegistered(): string[] {
    const result: string[] = [];
    for (const [k, v] of this.registrations) {
      if (v.length > 0) result.push(k);
    }
    return result;
  }

  /** Remove all handlers for an event, or all handlers if no event given */
  clear(event?: string): void {
    if (event) {
      this.registrations.delete(event);
    } else {
      this.registrations.clear();
    }
  }
}
