import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { Scheduler } from '../scheduler.js';
import { CircuitBreaker } from '../circuit-breaker.js';

let db: DataStore;
let hooks: HookBus;
let scheduler: Scheduler;
let breaker: CircuitBreaker;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  breaker = new CircuitBreaker(db, hooks, {
    failureThreshold: 3,
    resetTimeoutMs: 100,
    persist: false,
  });
  scheduler = new Scheduler(db, hooks);
  scheduler.setCircuitBreaker(breaker);
});

afterEach(() => {
  db.close();
});

/** Register a connector.sync schedule and force it due. */
async function registerDueSync(
  name: string,
  connector: string,
  account: string,
): Promise<string> {
  const id = await scheduler.register({
    name,
    cron: '* * * * *',
    action: 'connector.sync',
    actionConfig: { connector, account },
  });
  const pastTime = new Date(Date.now() - 60_000).toISOString();
  await db.update('schedules', { id }, { next_fire_at: pastTime });
  return id;
}

describe('Scheduler — CircuitBreaker integration', () => {
  // 1. Circuit opens after threshold failures
  it('opens circuit after 3 consecutive failures, skips 4th fire', async () => {
    const id = await registerDueSync('sync-test', 'gmail', 'alice@example.com');

    // Make the hook throw
    hooks.register('connector.sync', () => {
      throw new Error('unauthorized_client');
    });

    // Fire 3 times — each fails, circuit should trip
    await scheduler.tick();
    // Reset next_fire_at so tick picks it up again
    await db.update('schedules', { id }, {
      next_fire_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await scheduler.tick();
    await db.update('schedules', { id }, {
      next_fire_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await scheduler.tick();

    // Circuit should be open now
    expect(breaker.canExecute('gmail:alice@example.com')).toBe(false);

    // 4th fire should skip (circuit open)
    await db.update('schedules', { id }, {
      next_fire_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const errorCalls: Record<string, unknown>[] = [];
    hooks.register('schedule.error', (ctx) => { errorCalls.push(ctx); });

    await scheduler.tick();

    // No new error emitted because the sync was skipped entirely
    expect(errorCalls).toHaveLength(0);
  });

  // 2. Circuit allows probe after timeout
  it('allows a probe execution after resetTimeoutMs', async () => {
    const id = await registerDueSync('sync-probe', 'gmail', 'bob@example.com');

    hooks.register('connector.sync', () => {
      throw new Error('auth_error');
    });

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await db.update('schedules', { id }, {
        next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await scheduler.tick();
    }
    expect(breaker.canExecute('gmail:bob@example.com')).toBe(false);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 120));

    // Now a probe should be allowed (half-open)
    expect(breaker.canExecute('gmail:bob@example.com')).toBe(true);
  });

  // 3. Successful probe closes circuit
  it('closes circuit on successful probe', async () => {
    const id = await registerDueSync('sync-recover', 'calendar', 'alice@example.com');

    let shouldFail = true;
    hooks.register('connector.sync', () => {
      if (shouldFail) throw new Error('temp_error');
    });

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await db.update('schedules', { id }, {
        next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await scheduler.tick();
    }

    // Wait for reset timeout, then succeed
    await new Promise((r) => setTimeout(r, 120));
    shouldFail = false;

    await db.update('schedules', { id }, {
      next_fire_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await scheduler.tick();

    expect(breaker.getState('calendar:alice@example.com')).toBe('closed');
  });

  // 4. Failed probe keeps circuit open
  it('keeps circuit open when probe fails', async () => {
    const id = await registerDueSync('sync-fail-probe', 'gmail', 'eve@example.com');

    hooks.register('connector.sync', () => {
      throw new Error('still_broken');
    });

    // Trip
    for (let i = 0; i < 3; i++) {
      await db.update('schedules', { id }, {
        next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await scheduler.tick();
    }

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 120));

    // Probe — still fails
    await db.update('schedules', { id }, {
      next_fire_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await scheduler.tick();

    expect(breaker.getState('gmail:eve@example.com')).toBe('open');
  });

  // 5. Independent keys
  it('failures on one key do not affect another', async () => {
    const id1 = await registerDueSync('sync-a', 'gmail', 'alice@example.com');
    const id2 = await registerDueSync('sync-b', 'calendar', 'alice@example.com');

    // Only fail gmail syncs
    hooks.register('connector.sync', (ctx) => {
      if (ctx['connector'] === 'gmail') throw new Error('gmail_broken');
    });

    for (let i = 0; i < 3; i++) {
      await db.update('schedules', { id: id1 }, {
        next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await db.update('schedules', { id: id2 }, {
        next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await scheduler.tick();
    }

    expect(breaker.canExecute('gmail:alice@example.com')).toBe(false);
    expect(breaker.canExecute('calendar:alice@example.com')).toBe(true);
  });

  // 6. Success resets failure count
  it('success between failures resets the consecutive count', async () => {
    const id = await registerDueSync('sync-reset', 'gmail', 'dan@example.com');

    let callCount = 0;
    hooks.register('connector.sync', () => {
      callCount++;
      // Fail on calls 1, 2; succeed on 3; fail on 4, 5
      if (callCount <= 2 || callCount >= 4) throw new Error('fail');
    });

    // 2 failures
    for (let i = 0; i < 2; i++) {
      await db.update('schedules', { id }, {
        next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await scheduler.tick();
    }

    // 1 success (resets counter)
    await db.update('schedules', { id }, {
      next_fire_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await scheduler.tick();

    // 2 more failures — still below threshold of 3 consecutive
    for (let i = 0; i < 2; i++) {
      await db.update('schedules', { id }, {
        next_fire_at: new Date(Date.now() - 60_000).toISOString(),
      });
      await scheduler.tick();
    }

    // Circuit should still be closed (only 2 consecutive, not 3)
    expect(breaker.canExecute('gmail:dan@example.com')).toBe(true);
  });

  // 7. Non-connector.sync actions bypass breaker
  it('non-connector.sync actions are never circuit-checked', async () => {
    const id = await scheduler.register({
      name: 'cleanup-job',
      cron: '* * * * *',
      action: 'cleanup.run',
      actionConfig: { connector: 'gmail', account: 'alice@example.com' },
    });

    const pastTime = new Date(Date.now() - 60_000).toISOString();
    await db.update('schedules', { id }, { next_fire_at: pastTime });

    // Trip the breaker for this key manually
    await breaker.recordFailure('gmail:alice@example.com');
    await breaker.recordFailure('gmail:alice@example.com');
    await breaker.recordFailure('gmail:alice@example.com');
    expect(breaker.canExecute('gmail:alice@example.com')).toBe(false);

    // cleanup.run should still fire even though the breaker key is open
    const actionCalls: Record<string, unknown>[] = [];
    hooks.register('cleanup.run', (ctx) => { actionCalls.push(ctx); });

    await scheduler.tick();

    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0]!['schedule_id']).toBe(id);
  });
});
