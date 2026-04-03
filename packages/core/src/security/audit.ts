import type { HookBus } from '../hooks/hook-bus.js';
import type { AuditEvent } from './types.js';

interface AuditEmitterOptions {
  auditTables?: string[];
}

/**
 * Emits audit events via the HookBus for tracked tables.
 *
 * - auditTables defaults to [] (nothing audited)
 * - '*' wildcard audits all tables
 * - emit is fire-and-forget — errors are swallowed, no awaiting
 */
export class AuditEmitter {
  private readonly hooks: HookBus;
  private readonly auditTables: string[];

  constructor(hooks: HookBus, opts?: AuditEmitterOptions) {
    this.hooks = hooks;
    this.auditTables = opts?.auditTables ?? [];
  }

  shouldAudit(table: string): boolean {
    return this.auditTables.includes('*') || this.auditTables.includes(table);
  }

  emit(event: AuditEvent): void {
    // Fire and forget — never throw, never await
    try {
      const context = event as unknown as Record<string, unknown>;
      if (typeof this.hooks.emitSync === 'function') {
        this.hooks.emitSync('audit', context);
      } else {
        void this.hooks.emit('audit', context);
      }
    } catch {
      // Swallow errors — audit must never break normal operation
    }
  }
}
