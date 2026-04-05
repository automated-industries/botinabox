/**
 * CircuitBreaker — prevents runaway agent failures with automatic escalation.
 * Story 6.2
 *
 * States:
 *   CLOSED  → normal operation, failures counted
 *   OPEN    → tripped, all executions blocked, escalated to human
 *   HALF_OPEN → probe mode, one execution allowed to test recovery
 *
 * Integrates with LoopDetector and RunManager via HookBus events.
 */

import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';

export enum BreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export interface CircuitBreakerConfig {
  /** Failures before tripping. Default: 3 */
  failureThreshold?: number;
  /** Milliseconds to wait before half-open probe. Default: 300_000 (5 min) */
  resetTimeoutMs?: number;
  /** Log events to the database. Default: true */
  persist?: boolean;
}

interface BreakerRecord {
  state: BreakerState;
  failureCount: number;
  lastFailureAt: number;
  trippedAt?: number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RESET_TIMEOUT_MS = 5 * 60 * 1000;

export class CircuitBreaker {
  private readonly breakers = new Map<string, BreakerRecord>();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly persist: boolean;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    config?: CircuitBreakerConfig,
  ) {
    this.failureThreshold = config?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.resetTimeoutMs = config?.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    this.persist = config?.persist ?? true;
  }

  /**
   * Check if an agent is allowed to execute.
   * Returns true if execution is allowed, false if circuit is open.
   */
  canExecute(agentId: string): boolean {
    const breaker = this.breakers.get(agentId);
    if (!breaker) return true;

    switch (breaker.state) {
      case BreakerState.CLOSED:
        return true;
      case BreakerState.OPEN: {
        // Check if enough time has passed for a probe
        const elapsed = Date.now() - (breaker.trippedAt ?? 0);
        if (elapsed >= this.resetTimeoutMs) {
          breaker.state = BreakerState.HALF_OPEN;
          return true;
        }
        return false;
      }
      case BreakerState.HALF_OPEN:
        // Allow one probe execution
        return true;
    }
  }

  /**
   * Record a successful execution. Resets the breaker to CLOSED.
   */
  async recordSuccess(agentId: string): Promise<void> {
    const breaker = this.breakers.get(agentId);
    if (!breaker) return;

    const previousState = breaker.state;
    breaker.state = BreakerState.CLOSED;
    breaker.failureCount = 0;

    if (previousState === BreakerState.HALF_OPEN) {
      await this.logEvent(agentId, 'circuit_recovered', {
        previousState,
      });

      await this.hooks.emit('circuit_breaker.recovered', {
        agentId,
        previousState,
      });
    }
  }

  /**
   * Record a failed execution. Increments failure count and may trip breaker.
   */
  async recordFailure(agentId: string, reason?: string): Promise<void> {
    let breaker = this.breakers.get(agentId);
    if (!breaker) {
      breaker = {
        state: BreakerState.CLOSED,
        failureCount: 0,
        lastFailureAt: Date.now(),
      };
      this.breakers.set(agentId, breaker);
    }

    breaker.failureCount++;
    breaker.lastFailureAt = Date.now();

    if (breaker.state === BreakerState.HALF_OPEN) {
      // Probe failed — reopen
      await this.trip(agentId, reason ?? 'Probe execution failed during half-open state');
      return;
    }

    if (breaker.failureCount >= this.failureThreshold) {
      await this.trip(agentId, reason ?? `Failure threshold reached (${this.failureThreshold})`);
    }
  }

  /**
   * Trip the breaker to OPEN state and escalate to human.
   */
  async trip(agentId: string, reason: string): Promise<void> {
    let breaker = this.breakers.get(agentId);
    if (!breaker) {
      breaker = {
        state: BreakerState.CLOSED,
        failureCount: 0,
        lastFailureAt: Date.now(),
      };
      this.breakers.set(agentId, breaker);
    }

    breaker.state = BreakerState.OPEN;
    breaker.trippedAt = Date.now();

    await this.logEvent(agentId, 'circuit_tripped', {
      reason,
      failureCount: breaker.failureCount,
    });

    // Emit escalation hook for human notification
    await this.hooks.emit('circuit_breaker.tripped', {
      agentId,
      reason,
      failureCount: breaker.failureCount,
      action: 'escalate_to_human',
    });
  }

  /**
   * Manually reset a breaker (e.g. after human review).
   */
  async reset(agentId: string): Promise<void> {
    this.breakers.delete(agentId);

    await this.logEvent(agentId, 'circuit_reset', {});

    await this.hooks.emit('circuit_breaker.reset', { agentId });
  }

  /**
   * Get the current state of a breaker.
   */
  getState(agentId: string): BreakerState {
    return this.breakers.get(agentId)?.state ?? BreakerState.CLOSED;
  }

  /**
   * Get failure count for an agent.
   */
  getFailureCount(agentId: string): number {
    return this.breakers.get(agentId)?.failureCount ?? 0;
  }

  private async logEvent(
    agentId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.persist) return;
    await this.db.insert('activity_log', {
      agent_id: agentId,
      event_type: eventType,
      payload: JSON.stringify(payload),
    });
  }
}
