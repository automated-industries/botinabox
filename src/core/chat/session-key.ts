/**
 * SessionKey — structured key for chat sessions.
 * Story 4.3
 */

export class SessionKey {
  constructor(
    public readonly agentId: string,
    public readonly channel: string,
    public readonly scope: string,
  ) {}

  toString(): string {
    return `agent:${this.agentId}:${this.channel}:${this.scope}`;
  }

  toJSON(): { agentId: string; channel: string; scope: string } {
    return {
      agentId: this.agentId,
      channel: this.channel,
      scope: this.scope,
    };
  }

  static fromString(key: string): SessionKey {
    const parts = key.split(":");
    if (parts.length < 4 || parts[0] !== "agent") {
      throw new Error(`Invalid SessionKey format: ${key}`);
    }
    // agentId might contain ':', so reconstruct carefully
    // Format: "agent:{agentId}:{channel}:{scope}"
    // We assume agentId, channel, scope do NOT contain ':'
    const [, agentId, channel, scope] = parts;
    if (!agentId || !channel || !scope) {
      throw new Error(`Invalid SessionKey format: ${key}`);
    }
    return new SessionKey(agentId, channel, scope);
  }

  /**
   * Build a session key from structured parameters.
   *
   * @param agentId      - The agent identifier
   * @param channel      - The channel identifier
   * @param chatType     - 'dm' or 'group'
   * @param peerId       - The peer/user ID
   * @param dmScope      - DM scoping strategy
   *   - 'main'               → single session per agent+channel regardless of peer
   *   - 'per-peer'           → one session per (agent, peer)
   *   - 'per-channel-peer'   → one session per (agent, channel, peer)
   */
  static build(
    agentId: string,
    channel: string,
    chatType: "dm" | "group",
    peerId: string,
    dmScope: "main" | "per-peer" | "per-channel-peer",
  ): SessionKey {
    if (chatType === "group") {
      // Groups are always scoped to the channel
      return new SessionKey(agentId, channel, channel);
    }

    // DM scoping
    switch (dmScope) {
      case "main":
        return new SessionKey(agentId, channel, "main");
      case "per-peer":
        return new SessionKey(agentId, channel, peerId);
      case "per-channel-peer":
        return new SessionKey(agentId, channel, `${channel}:${peerId}`);
    }
  }
}
