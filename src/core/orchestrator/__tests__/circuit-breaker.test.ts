import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { CircuitBreaker, BreakerState } from '../circuit-breaker.js';

let db: DataStore;
let hooks: HookBus;
let breaker: CircuitBreaker;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  breaker = new CircuitBreaker(db, hooks, {
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    persist: true,
  });
});

afterEach(() => {
  db.close();
});

describe('CircuitBreaker — Story 6.2', () => {
  it('starts in CLOSED state', () => {
    expect(breaker.getState('agent-1')).toBe(BreakerState.CLOSED);
    expect(breaker.canExecute('agent-1')).toBe(true);
  });

  it('allows execution below failure threshold', async () => {
    await breaker.recordFailure('agent-1');
    await breaker.recordFailure('agent-1');

    expect(breaker.canExecute('agent-1')).toBe(true);
    expect(breaker.getFailureCount('agent-1')).toBe(2);
  });

  it('trips to OPEN after reaching failure threshold', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('circuit_breaker.tripped', (ctx) => { events.push(ctx); });

    await breaker.recordFailure('agent-1');
    await breaker.recordFailure('agent-1');
    await breaker.recordFailure('agent-1');

    expect(breaker.getState('agent-1')).toBe(BreakerState.OPEN);
    expect(breaker.canExecute('agent-1')).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]!['agentId']).toBe('agent-1');
    expect(events[0]!['action']).toBe('escalate_to_human');
  });

  it('transitions to HALF_OPEN after reset timeout', async () => {
    // Use short timeout
    const fastBreaker = new CircuitBreaker(db, hooks, {
      failureThreshold: 1,
      resetTimeoutMs: 50,
      persist: false,
    });

    await fastBreaker.recordFailure('agent-2');
    expect(fastBreaker.canExecute('agent-2')).toBe(false);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    expect(fastBreaker.canExecute('agent-2')).toBe(true);
    expect(fastBreaker.getState('agent-2')).toBe(BreakerState.HALF_OPEN);
  });

  it('recovers to CLOSED on success after HALF_OPEN', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('circuit_breaker.recovered', (ctx) => { events.push(ctx); });

    const fastBreaker = new CircuitBreaker(db, hooks, {
      failureThreshold: 1,
      resetTimeoutMs: 50,
      persist: false,
    });

    await fastBreaker.recordFailure('agent-3');
    await new Promise((r) => setTimeout(r, 60));

    // Trigger half-open
    fastBreaker.canExecute('agent-3');
    expect(fastBreaker.getState('agent-3')).toBe(BreakerState.HALF_OPEN);

    // Success in half-open resets to closed
    await fastBreaker.recordSuccess('agent-3');
    expect(fastBreaker.getState('agent-3')).toBe(BreakerState.CLOSED);
    expect(fastBreaker.getFailureCount('agent-3')).toBe(0);
    expect(events).toHaveLength(1);
  });

  it('re-opens on failure in HALF_OPEN', async () => {
    const fastBreaker = new CircuitBreaker(db, hooks, {
      failureThreshold: 1,
      resetTimeoutMs: 50,
      persist: false,
    });

    await fastBreaker.recordFailure('agent-4');
    await new Promise((r) => setTimeout(r, 60));
    fastBreaker.canExecute('agent-4');

    // Fail in half-open
    await fastBreaker.recordFailure('agent-4');
    expect(fastBreaker.getState('agent-4')).toBe(BreakerState.OPEN);
  });

  it('manual reset clears breaker state', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('circuit_breaker.reset', (ctx) => { events.push(ctx); });

    await breaker.recordFailure('agent-5');
    await breaker.recordFailure('agent-5');
    await breaker.recordFailure('agent-5');
    expect(breaker.canExecute('agent-5')).toBe(false);

    await breaker.reset('agent-5');
    expect(breaker.canExecute('agent-5')).toBe(true);
    expect(breaker.getState('agent-5')).toBe(BreakerState.CLOSED);
    expect(events).toHaveLength(1);
  });

  it('persists events to activity_log', async () => {
    await breaker.recordFailure('agent-6');
    await breaker.recordFailure('agent-6');
    await breaker.recordFailure('agent-6');

    const logs = await db.query('activity_log', {
      where: { agent_id: 'agent-6', event_type: 'circuit_tripped' },
    });
    expect(logs.length).toBeGreaterThan(0);
  });
});
