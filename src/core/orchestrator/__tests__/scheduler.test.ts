import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { Scheduler } from '../scheduler.js';
import type { Schedule } from '../scheduler.js';

let db: DataStore;
let hooks: HookBus;
let scheduler: Scheduler;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  scheduler = new Scheduler(db, hooks);
});

afterEach(() => {
  db.close();
});

describe('Scheduler', () => {
  // ---------------------------------------------------------------
  // 1. register() — recurring schedule
  // ---------------------------------------------------------------
  describe('register() — recurring schedule', () => {
    it('creates a row with correct type, cron, and next_fire_at', async () => {
      const id = await scheduler.register({
        name: 'daily-sync',
        cron: '0 9 * * *',
        action: 'connector.sync',
        timezone: 'UTC',
      });

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const rows = await db.query('schedules', { where: { id } });
      expect(rows).toHaveLength(1);

      const row = rows[0]! as unknown as Schedule;
      expect(row.type).toBe('recurring');
      expect(row.cron).toBe('0 9 * * *');
      expect(row.enabled).toBe(1);
      expect(row.action).toBe('connector.sync');
      expect(row.next_fire_at).toBeDefined();
      expect(row.next_fire_at).not.toBeNull();
      // next_fire_at should be in the future
      expect(new Date(row.next_fire_at!).getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ---------------------------------------------------------------
  // 2. register() — one-time schedule
  // ---------------------------------------------------------------
  describe('register() — one-time schedule', () => {
    it('creates a row with type=one_time and next_fire_at matching runAt', async () => {
      const runAt = new Date(Date.now() + 60_000).toISOString();
      const id = await scheduler.register({
        name: 'one-off-reminder',
        runAt,
        action: 'notification.send',
      });

      const rows = await db.query('schedules', { where: { id } });
      expect(rows).toHaveLength(1);

      const row = rows[0]! as unknown as Schedule;
      expect(row.type).toBe('one_time');
      expect(row.cron).toBeNull();
      expect(row.run_at).toBe(runAt);
      expect(row.next_fire_at).toBe(new Date(runAt).toISOString());
      expect(row.enabled).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // 3. tick() — fires due recurring schedule
  // ---------------------------------------------------------------
  describe('tick() — fires due recurring schedule', () => {
    it('emits action and schedule.fired hooks, updates last_fired_at and recomputes next_fire_at', async () => {
      // Register a recurring schedule
      const id = await scheduler.register({
        name: 'every-minute',
        cron: '* * * * *',
        action: 'connector.sync',
        actionConfig: { source: 'gmail' },
      });

      // Force next_fire_at into the past so tick() picks it up
      const pastTime = new Date(Date.now() - 60_000).toISOString();
      await db.update('schedules', { id }, { next_fire_at: pastTime });

      // Track hook emissions
      const actionCalls: Record<string, unknown>[] = [];
      const firedCalls: Record<string, unknown>[] = [];
      hooks.register('connector.sync', (ctx) => { actionCalls.push(ctx); });
      hooks.register('schedule.fired', (ctx) => { firedCalls.push(ctx); });

      await scheduler.tick();

      // Action hook emitted with action_config payload
      expect(actionCalls).toHaveLength(1);
      expect(actionCalls[0]!['schedule_id']).toBe(id);
      expect(actionCalls[0]!['schedule_name']).toBe('every-minute');
      expect(actionCalls[0]!['source']).toBe('gmail');

      // Observability hook emitted
      expect(firedCalls).toHaveLength(1);
      expect(firedCalls[0]!['schedule_id']).toBe(id);
      expect(firedCalls[0]!['action']).toBe('connector.sync');

      // DB updated
      const rows = await db.query('schedules', { where: { id } });
      const row = rows[0]! as unknown as Schedule;
      expect(row.last_fired_at).toBeDefined();
      expect(row.last_fired_at).not.toBeNull();
      // next_fire_at recomputed to a future time
      expect(row.next_fire_at).not.toBeNull();
      expect(new Date(row.next_fire_at!).getTime()).toBeGreaterThan(Date.now() - 5_000);
      // Schedule still enabled
      expect(row.enabled).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // 4. tick() — fires due one-time schedule
  // ---------------------------------------------------------------
  describe('tick() — fires due one-time schedule', () => {
    it('fires the schedule then disables it', async () => {
      const runAt = new Date(Date.now() - 60_000).toISOString();
      const id = await scheduler.register({
        name: 'one-shot',
        runAt,
        action: 'notification.send',
      });

      // The runAt is in the past, so next_fire_at is already in the past
      const actionCalls: Record<string, unknown>[] = [];
      hooks.register('notification.send', (ctx) => { actionCalls.push(ctx); });

      await scheduler.tick();

      expect(actionCalls).toHaveLength(1);
      expect(actionCalls[0]!['schedule_id']).toBe(id);

      // Schedule is now disabled with next_fire_at = null
      const rows = await db.query('schedules', { where: { id } });
      const row = rows[0]! as unknown as Schedule;
      expect(row.enabled).toBe(0);
      expect(row.next_fire_at).toBeNull();
      expect(row.last_fired_at).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // 5. tick() — skips future schedules
  // ---------------------------------------------------------------
  describe('tick() — skips future schedules', () => {
    it('does not emit hooks for schedules with next_fire_at in the future', async () => {
      await scheduler.register({
        name: 'future-task',
        cron: '0 0 1 1 *', // once a year — next_fire_at is far in the future
        action: 'yearly.report',
      });

      const actionCalls: Record<string, unknown>[] = [];
      hooks.register('yearly.report', (ctx) => { actionCalls.push(ctx); });

      await scheduler.tick();

      expect(actionCalls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // 6. tick() — skips disabled schedules
  // ---------------------------------------------------------------
  describe('tick() — skips disabled schedules', () => {
    it('does not emit hooks for disabled schedules even if next_fire_at is past', async () => {
      const id = await scheduler.register({
        name: 'disabled-task',
        cron: '* * * * *',
        action: 'should.not.fire',
      });

      // Disable the schedule and set next_fire_at in the past
      const pastTime = new Date(Date.now() - 60_000).toISOString();
      await db.update('schedules', { id }, {
        enabled: 0,
        next_fire_at: pastTime,
      });

      const actionCalls: Record<string, unknown>[] = [];
      hooks.register('should.not.fire', (ctx) => { actionCalls.push(ctx); });

      await scheduler.tick();

      expect(actionCalls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // 7. unregister()
  // ---------------------------------------------------------------
  describe('unregister()', () => {
    it('soft-deletes the schedule: sets deleted_at and enabled=0', async () => {
      const id = await scheduler.register({
        name: 'to-remove',
        cron: '0 12 * * *',
        action: 'do.stuff',
      });

      await scheduler.unregister(id);

      const rows = await db.query('schedules', { where: { id } });
      expect(rows).toHaveLength(1);

      const row = rows[0]! as unknown as Schedule;
      expect(row.enabled).toBe(0);
      expect(row.deleted_at).not.toBeNull();
      expect(row.deleted_at).toBeDefined();
    });

    it('unregistered schedule is excluded from list()', async () => {
      const id = await scheduler.register({
        name: 'to-remove',
        cron: '0 12 * * *',
        action: 'do.stuff',
      });

      await scheduler.unregister(id);

      const all = await scheduler.list();
      expect(all.find((s) => s.id === id)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // 8. list()
  // ---------------------------------------------------------------
  describe('list()', () => {
    it('returns all non-deleted schedules', async () => {
      await scheduler.register({ name: 'a', cron: '0 * * * *', action: 'a.run' });
      await scheduler.register({ name: 'b', cron: '0 * * * *', action: 'b.run' });
      await scheduler.register({ name: 'c', cron: '0 * * * *', action: 'c.run' });

      const all = await scheduler.list();
      expect(all).toHaveLength(3);
    });

    it('filters by enabled=true', async () => {
      const idA = await scheduler.register({ name: 'active', cron: '0 * * * *', action: 'a.run' });
      const idB = await scheduler.register({ name: 'inactive', cron: '0 * * * *', action: 'b.run' });

      // Disable one
      await db.update('schedules', { id: idB }, { enabled: 0 });

      const enabled = await scheduler.list({ enabled: true });
      expect(enabled).toHaveLength(1);
      expect(enabled[0]!.id).toBe(idA);
    });

    it('filters by enabled=false', async () => {
      await scheduler.register({ name: 'active', cron: '0 * * * *', action: 'a.run' });
      const idB = await scheduler.register({ name: 'inactive', cron: '0 * * * *', action: 'b.run' });

      await db.update('schedules', { id: idB }, { enabled: 0 });

      const disabled = await scheduler.list({ enabled: false });
      expect(disabled).toHaveLength(1);
      expect(disabled[0]!.id).toBe(idB);
    });

    it('excludes soft-deleted schedules from all results', async () => {
      const idA = await scheduler.register({ name: 'keep', cron: '0 * * * *', action: 'a.run' });
      const idB = await scheduler.register({ name: 'delete-me', cron: '0 * * * *', action: 'b.run' });

      await scheduler.unregister(idB);

      const all = await scheduler.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(idA);
    });
  });

  // ---------------------------------------------------------------
  // 9. update()
  // ---------------------------------------------------------------
  describe('update()', () => {
    it('updates cron and recomputes next_fire_at', async () => {
      const id = await scheduler.register({
        name: 'updatable',
        cron: '0 9 * * *',
        action: 'sync.data',
      });

      const beforeRows = await db.query('schedules', { where: { id } });
      const beforeNext = (beforeRows[0]! as unknown as Schedule).next_fire_at;

      // Change to every-minute cron — next_fire_at should be much sooner
      await scheduler.update(id, { cron: '* * * * *' });

      const afterRows = await db.query('schedules', { where: { id } });
      const row = afterRows[0]! as unknown as Schedule;
      expect(row.cron).toBe('* * * * *');
      expect(row.type).toBe('recurring');
      expect(row.next_fire_at).not.toBeNull();
      // The new next_fire_at should differ from the old one
      expect(row.next_fire_at).not.toBe(beforeNext);
      // And it should be in the near future (within ~60 seconds for every-minute)
      const diff = new Date(row.next_fire_at!).getTime() - Date.now();
      expect(diff).toBeLessThanOrEqual(61_000);
      expect(diff).toBeGreaterThan(0);
    });

    it('updates action and actionConfig', async () => {
      const id = await scheduler.register({
        name: 'updatable-config',
        cron: '0 * * * *',
        action: 'old.action',
        actionConfig: { key: 'old' },
      });

      await scheduler.update(id, {
        action: 'new.action',
        actionConfig: { key: 'new', extra: 42 },
      });

      const rows = await db.query('schedules', { where: { id } });
      const row = rows[0]! as unknown as Schedule;
      expect(row.action).toBe('new.action');
      expect(JSON.parse(row.action_config)).toEqual({ key: 'new', extra: 42 });
    });

    it('switching from cron to runAt changes type to one_time', async () => {
      const id = await scheduler.register({
        name: 'switch-type',
        cron: '0 * * * *',
        action: 'do.thing',
      });

      const futureDate = new Date(Date.now() + 3_600_000).toISOString();
      await scheduler.update(id, { runAt: futureDate });

      const rows = await db.query('schedules', { where: { id } });
      const row = rows[0]! as unknown as Schedule;
      expect(row.type).toBe('one_time');
      expect(row.cron).toBeNull();
      expect(row.next_fire_at).toBe(new Date(futureDate).toISOString());
    });
  });

  // ---------------------------------------------------------------
  // 10. tick() — action_config passed to hook
  // ---------------------------------------------------------------
  describe('tick() — action_config passed to hook', () => {
    it('passes action_config fields as top-level hook context properties', async () => {
      const id = await scheduler.register({
        name: 'config-test',
        cron: '* * * * *',
        action: 'channel.send',
        actionConfig: {
          channel_id: 'ch-123',
          message: 'Hello World',
          priority: 'high',
        },
      });

      // Force next_fire_at into the past
      const pastTime = new Date(Date.now() - 60_000).toISOString();
      await db.update('schedules', { id }, { next_fire_at: pastTime });

      const actionCalls: Record<string, unknown>[] = [];
      hooks.register('channel.send', (ctx) => { actionCalls.push(ctx); });

      await scheduler.tick();

      expect(actionCalls).toHaveLength(1);
      const payload = actionCalls[0]!;
      // Standard fields from Scheduler
      expect(payload['schedule_id']).toBe(id);
      expect(payload['schedule_name']).toBe('config-test');
      // action_config fields spread into the context
      expect(payload['channel_id']).toBe('ch-123');
      expect(payload['message']).toBe('Hello World');
      expect(payload['priority']).toBe('high');
    });

    it('handles empty action_config gracefully', async () => {
      const id = await scheduler.register({
        name: 'no-config',
        cron: '* * * * *',
        action: 'simple.action',
        // No actionConfig provided
      });

      const pastTime = new Date(Date.now() - 60_000).toISOString();
      await db.update('schedules', { id }, { next_fire_at: pastTime });

      const actionCalls: Record<string, unknown>[] = [];
      hooks.register('simple.action', (ctx) => { actionCalls.push(ctx); });

      await scheduler.tick();

      expect(actionCalls).toHaveLength(1);
      expect(actionCalls[0]!['schedule_id']).toBe(id);
      expect(actionCalls[0]!['schedule_name']).toBe('no-config');
    });
  });
});
