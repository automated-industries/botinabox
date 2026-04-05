/**
 * LoopDetector — pattern-based loop detection for agent routing.
 * Story 6.2
 *
 * Complements chain-guard's depth limit with active pattern detection:
 * - Self-loop: agent routes a task back to itself
 * - Ping-pong: two agents bounce tasks between each other (A→B→A→B)
 * - Blocked re-entry: a task re-enters the system after being blocked
 */

import type { DataStore } from '../data/data-store.js';

export enum LoopType {
  SELF_LOOP = 'self_loop',
  PING_PONG = 'ping_pong',
  BLOCKED_REENTRY = 'blocked_reentry',
}

export interface LoopDetection {
  type: LoopType;
  agents: string[];
  taskId: string;
  chainOriginId?: string;
  message: string;
}

export interface LoopDetectorConfig {
  /** Number of recent followup records to scan. Default: 10 */
  windowSize?: number;
  /** Minimum repetitions to confirm ping-pong. Default: 2 */
  pingPongThreshold?: number;
}

const DEFAULT_WINDOW = 10;
const DEFAULT_PING_PONG_THRESHOLD = 2;

export class LoopDetector {
  private readonly windowSize: number;
  private readonly pingPongThreshold: number;

  constructor(
    private db: DataStore,
    config?: LoopDetectorConfig,
  ) {
    this.windowSize = config?.windowSize ?? DEFAULT_WINDOW;
    this.pingPongThreshold = config?.pingPongThreshold ?? DEFAULT_PING_PONG_THRESHOLD;
  }

  /**
   * Check for loops before creating a followup task.
   * Returns a LoopDetection if a loop pattern is found, undefined otherwise.
   */
  async check(
    sourceAgentId: string,
    targetAgentId: string,
    taskId: string,
    chainOriginId?: string,
  ): Promise<LoopDetection | undefined> {
    // 1. Self-loop: source == target
    const selfLoop = this.checkSelfLoop(sourceAgentId, targetAgentId, taskId);
    if (selfLoop) return selfLoop;

    // 2. Blocked re-entry
    const blocked = await this.checkBlockedReentry(targetAgentId, taskId, chainOriginId);
    if (blocked) return blocked;

    // 3. Ping-pong: look at recent chain history
    const pingPong = await this.checkPingPong(sourceAgentId, targetAgentId, chainOriginId);
    if (pingPong) return pingPong;

    return undefined;
  }

  /**
   * Check if an agent is routing to itself.
   */
  private checkSelfLoop(
    sourceAgentId: string,
    targetAgentId: string,
    taskId: string,
  ): LoopDetection | undefined {
    if (sourceAgentId === targetAgentId) {
      return {
        type: LoopType.SELF_LOOP,
        agents: [sourceAgentId],
        taskId,
        message: `Self-loop detected: agent ${sourceAgentId} is routing to itself`,
      };
    }
    return undefined;
  }

  /**
   * Check if a previously blocked task is being re-entered.
   */
  private async checkBlockedReentry(
    targetAgentId: string,
    taskId: string,
    chainOriginId?: string,
  ): Promise<LoopDetection | undefined> {
    // Look for blocked/failed tasks in the same chain
    const originId = chainOriginId ?? taskId;
    const chainTasks = await this.db.query('tasks', {
      where: { chain_origin_id: originId },
    });

    const blockedInChain = chainTasks.filter(
      (t) =>
        (t['status'] === 'blocked' || t['status'] === 'failed') &&
        t['assignee_id'] === targetAgentId,
    );

    if (blockedInChain.length > 0) {
      return {
        type: LoopType.BLOCKED_REENTRY,
        agents: [targetAgentId],
        taskId,
        chainOriginId: originId,
        message: `Blocked re-entry: agent ${targetAgentId} already has a blocked/failed task in chain ${originId}`,
      };
    }

    return undefined;
  }

  /**
   * Check for A→B→A→B ping-pong by scanning recent tasks in the chain.
   */
  private async checkPingPong(
    sourceAgentId: string,
    targetAgentId: string,
    chainOriginId?: string,
  ): Promise<LoopDetection | undefined> {
    if (!chainOriginId) return undefined;

    // Get recent tasks in this chain, ordered by creation
    const chainTasks = await this.db.query('tasks', {
      where: { chain_origin_id: chainOriginId },
    });

    // Sort by chain_depth (ascending) then created_at
    const sorted = chainTasks
      .sort((a, b) => {
        const depthDiff = ((a['chain_depth'] as number) ?? 0) - ((b['chain_depth'] as number) ?? 0);
        if (depthDiff !== 0) return depthDiff;
        return ((a['created_at'] as string) ?? '').localeCompare((b['created_at'] as string) ?? '');
      })
      .slice(-this.windowSize);

    // Extract the agent sequence
    const agentSequence = sorted
      .map((t) => t['assignee_id'] as string)
      .filter(Boolean);

    // Add the proposed next hop
    agentSequence.push(targetAgentId);

    // Detect A→B→A→B pattern
    if (agentSequence.length >= this.pingPongThreshold * 2) {
      const tail = agentSequence.slice(-this.pingPongThreshold * 2);
      const a = tail[0];
      const b = tail[1];
      if (a && b && a !== b) {
        let isPingPong = true;
        for (let i = 0; i < tail.length; i++) {
          if (tail[i] !== (i % 2 === 0 ? a : b)) {
            isPingPong = false;
            break;
          }
        }
        if (isPingPong) {
          return {
            type: LoopType.PING_PONG,
            agents: [a, b],
            taskId: sorted[sorted.length - 1]?.['id'] as string ?? '',
            chainOriginId,
            message: `Ping-pong detected: agents ${a} and ${b} are bouncing tasks in chain ${chainOriginId}`,
          };
        }
      }
    }

    return undefined;
  }
}
