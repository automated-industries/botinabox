import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookBus } from '../../hooks/hook-bus.js';
import { AuditEmitter } from '../audit.js';
import type { AuditEvent } from '../types.js';

describe('AuditEmitter', () => {
  let hooks: HookBus;
  let emitter: AuditEmitter;

  const makeEvent = (table = 'users', pk = '1'): AuditEvent => ({
    table,
    operation: 'insert',
    pk,
    timestamp: Date.now(),
    changedColumns: ['name'],
  });

  beforeEach(() => {
    hooks = new HookBus();
  });

  it('emit calls hooks.emit with correct event shape', () => {
    const received: unknown[] = [];
    hooks.register('audit', (ctx) => {
      received.push(ctx);
    });
    emitter = new AuditEmitter(hooks, { auditTables: ['users'] });
    const event = makeEvent();
    emitter.emit(event);

    // emitSync is used — handler should have been called synchronously
    expect(received).toHaveLength(1);
    const ctx = received[0] as Record<string, unknown>;
    expect(ctx['table']).toBe('users');
    expect(ctx['operation']).toBe('insert');
    expect(ctx['pk']).toBe('1');
  });

  it('shouldAudit returns false when table is not in auditTables', () => {
    emitter = new AuditEmitter(hooks, { auditTables: ['orders'] });
    expect(emitter.shouldAudit('users')).toBe(false);
  });

  it('shouldAudit returns true when table IS in auditTables', () => {
    emitter = new AuditEmitter(hooks, { auditTables: ['users', 'orders'] });
    expect(emitter.shouldAudit('users')).toBe(true);
  });

  it('shouldAudit returns true for * wildcard', () => {
    emitter = new AuditEmitter(hooks, { auditTables: ['*'] });
    expect(emitter.shouldAudit('anything')).toBe(true);
    expect(emitter.shouldAudit('users')).toBe(true);
  });

  it('shouldAudit returns false with empty auditTables (default)', () => {
    emitter = new AuditEmitter(hooks);
    expect(emitter.shouldAudit('users')).toBe(false);
  });

  it('emit does not throw even if a hook handler throws', () => {
    hooks.register('audit', () => {
      throw new Error('hook failure');
    });
    emitter = new AuditEmitter(hooks, { auditTables: ['users'] });
    expect(() => emitter.emit(makeEvent())).not.toThrow();
  });

  it('emit is fire-and-forget — does not block even if hook is async', () => {
    let resolved = false;
    hooks.register('audit', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      resolved = true;
    });
    emitter = new AuditEmitter(hooks, { auditTables: ['users'] });
    emitter.emit(makeEvent());
    // Should not have awaited
    expect(resolved).toBe(false);
  });
});
