/**
 * MessagePipeline — routes inbound messages to the task queue.
 * Story 4.2
 */

import type { HookBus } from "../hooks/hook-bus.js";
import type { AgentRegistry } from "../orchestrator/agent-registry.js";
import type { TaskQueue } from "../orchestrator/task-queue.js";
import type { UserRegistry } from "../orchestrator/user-registry.js";
import type { BotConfig } from "../../shared/index.js";
import type { InboundMessage } from "./types.js";
import { buildAgentBindings } from "./routing.js";
import { checkAllowlist, checkMentionGate } from "./policies.js";

export class MessagePipeline {
  private readonly agentBindings: Map<string, string>;
  private readonly userRegistry?: UserRegistry;

  constructor(
    private readonly hooks: HookBus,
    private readonly agentRegistry: AgentRegistry,
    private readonly taskQueue: TaskQueue,
    private readonly config: BotConfig,
    userRegistry?: UserRegistry,
  ) {
    this.agentBindings = buildAgentBindings(config.agents);
    this.userRegistry = userRegistry;
  }

  /**
   * Process an inbound message end-to-end.
   * 1. Emit 'message.inbound'
   * 2. Resolve agent
   * 3. Check policy (allowlist / mention gate)
   * 4. Create task
   * 5. Emit 'message.processed'
   */
  async processInbound(msg: InboundMessage): Promise<void> {
    await this.hooks.emit("message.inbound", { message: msg, channel: msg.channel });

    // Resolve sender to a user record (auto-creates if UserRegistry is available)
    if (this.userRegistry && !msg.userId) {
      const user = await this.userRegistry.resolveOrCreate(msg.from, msg.channel);
      msg.userId = user.id;
    }

    const agentId = this.resolveAgent(msg);

    if (agentId !== undefined) {
      const allowed = this.evaluatePolicy(msg, agentId);
      if (allowed) {
        await this.taskQueue.create({
          title: `Message from ${msg.from} on ${msg.channel}`,
          description: msg.body,
          assignee_id: agentId,
          context: JSON.stringify({ message: msg, userId: msg.userId }),
        });
      }
    }

    await this.hooks.emit("message.processed", {
      message: msg,
      channel: msg.channel,
      agentId: agentId ?? null,
      userId: msg.userId ?? null,
    });
  }

  /**
   * Resolve the best agent for a given inbound message.
   * Returns agentId (slug) or undefined if no match.
   */
  resolveAgent(msg: InboundMessage): string | undefined {
    // Try direct channel binding first
    const bound = this.agentBindings.get(msg.channel);
    if (bound) return bound;

    // Fallback: first agent in config
    const first = this.config.agents[0];
    return first?.slug;
  }

  /**
   * Evaluate messaging policy for the given agent.
   * Returns false if the message is blocked.
   */
  evaluatePolicy(msg: InboundMessage, agentId: string): boolean {
    const channelConfig = this.config.channels[msg.channel];

    // Check allowlist
    const allowFrom = (channelConfig?.["allowFrom"] as string[] | undefined) ?? [];
    if (!checkAllowlist(allowFrom, msg.from)) {
      return false;
    }

    // Check mention gate
    const mentionGated = (channelConfig?.["requireMention"] as boolean | undefined) ?? false;
    if (mentionGated) {
      if (!checkMentionGate(msg, agentId)) {
        return false;
      }
    }

    return true;
  }
}
