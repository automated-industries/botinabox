/**
 * Chat routing — maps channel/scope to agentId.
 * Story 4.2
 */

import type { AgentConfig } from "../../shared/index.js";

/**
 * Build a map from channel identifier to agentId.
 * Each agent may have a config.channel or config.channels binding.
 */
export function buildAgentBindings(agents: AgentConfig[]): Map<string, string> {
  const bindings = new Map<string, string>();

  for (const agent of agents) {
    const agentId = agent.slug;
    const cfg = agent.config ?? {};

    // Support config.channel (single) or config.channels (array)
    const channels: string[] = [];
    if (typeof cfg["channel"] === "string") {
      channels.push(cfg["channel"]);
    }
    if (Array.isArray(cfg["channels"])) {
      for (const ch of cfg["channels"] as string[]) {
        channels.push(ch);
      }
    }

    for (const ch of channels) {
      bindings.set(ch, agentId);
    }
  }

  return bindings;
}
