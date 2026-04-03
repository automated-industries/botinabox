/**
 * ChannelRegistry — manages channel adapter lifecycle.
 * Story 4.1
 */

import type { ChannelAdapter, HealthStatus } from "./types.js";

export class ChannelRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelRegistryError";
  }
}

interface AdapterEntry {
  adapter: ChannelAdapter;
  config?: unknown;
}

export class ChannelRegistry {
  private readonly adapters = new Map<string, AdapterEntry>();
  private started = false;

  /**
   * Register a channel adapter.
   * Throws if an adapter with the same id is already registered.
   * If registry is already started, immediately connects the adapter.
   */
  register(adapter: ChannelAdapter, config?: unknown): void {
    if (this.adapters.has(adapter.id)) {
      throw new ChannelRegistryError(`Channel adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, { adapter, config });

    if (this.started) {
      void adapter.connect((config ?? {}) as Record<string, unknown>);
    }
  }

  /**
   * Unregister a channel adapter.
   * Disconnects the adapter if it exists.
   */
  async unregister(id: string): Promise<void> {
    const entry = this.adapters.get(id);
    if (!entry) return;

    await entry.adapter.disconnect();
    this.adapters.delete(id);
  }

  /**
   * Reconfigure an adapter: disconnect, update config, reconnect.
   */
  async reconfigure(id: string, config: unknown): Promise<void> {
    const entry = this.adapters.get(id);
    if (!entry) {
      throw new ChannelRegistryError(`Channel adapter not found: ${id}`);
    }

    await entry.adapter.disconnect();
    entry.config = config;
    await entry.adapter.connect((config ?? {}) as Record<string, unknown>);
  }

  /**
   * Run health checks on all registered adapters.
   */
  async healthCheck(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};
    for (const [id, entry] of this.adapters) {
      try {
        results[id] = await entry.adapter.healthCheck();
      } catch (err) {
        results[id] = { ok: false, error: String(err) };
      }
    }
    return results;
  }

  /** Get an adapter by ID. */
  get(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id)?.adapter;
  }

  /** List all registered adapters. */
  list(): ChannelAdapter[] {
    return Array.from(this.adapters.values()).map((e) => e.adapter);
  }

  /**
   * Start: connect all registered adapters and mark registry as started.
   */
  async start(): Promise<void> {
    this.started = true;
    for (const entry of this.adapters.values()) {
      await entry.adapter.connect((entry.config ?? {}) as Record<string, unknown>);
    }
  }

  /**
   * Stop: disconnect all registered adapters.
   */
  async stop(): Promise<void> {
    for (const entry of this.adapters.values()) {
      await entry.adapter.disconnect();
    }
    this.started = false;
  }
}
