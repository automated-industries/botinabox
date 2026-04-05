/**
 * TriageRouter — content-based routing with deterministic-first resolution.
 * Story 6.3
 *
 * Replaces the simple channel→agent binding with intelligent routing:
 * 1. Keyword/regex rules evaluated first (deterministic, ~4ms)
 * 2. LLM classification only for ambiguous messages (async, ~2-4s)
 * 3. Ownership chain logged for every routing decision
 *
 * Key constraint: specialists return to triage, never to another specialist.
 */

import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { InboundMessage } from './types.js';

export interface RoutingRule {
  /** Target agent slug */
  agentSlug: string;
  /** Keywords that trigger this rule (case-insensitive) */
  keywords?: string[];
  /** Regex patterns that trigger this rule */
  patterns?: string[];
  /** Priority — lower number wins ties. Default: 50 */
  priority?: number;
}

export interface RoutingDecision {
  timestamp: string;
  source: string;       // "triage"
  target: string;       // agent slug
  reason: string;       // "keyword: 'deploy'" or "llm: classified as devops"
  method: 'deterministic' | 'llm';
  messageId?: string;
  channel?: string;
}

export interface TriageRouterConfig {
  /** Static routing rules evaluated deterministically */
  rules: RoutingRule[];
  /** Fallback agent if no rule matches and LLM is unavailable */
  fallbackAgent?: string;
  /** Whether to use LLM for ambiguous messages. Default: true */
  llmFallback?: boolean;
  /** Log decisions to the database. Default: true */
  persist?: boolean;
}

export class TriageRouter {
  private readonly rules: RoutingRule[];
  private readonly fallbackAgent?: string;
  private readonly llmFallback: boolean;
  private readonly persist: boolean;
  private readonly compiledRules: Array<{
    rule: RoutingRule;
    regexes: RegExp[];
    keywordSet: Set<string>;
  }>;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    config: TriageRouterConfig,
  ) {
    this.rules = config.rules;
    this.fallbackAgent = config.fallbackAgent;
    this.llmFallback = config.llmFallback ?? true;
    this.persist = config.persist ?? true;

    // Pre-compile patterns for fast matching
    this.compiledRules = this.rules
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
      .map((rule) => ({
        rule,
        regexes: (rule.patterns ?? []).map((p) => new RegExp(p, 'i')),
        keywordSet: new Set((rule.keywords ?? []).map((k) => k.toLowerCase())),
      }));
  }

  /**
   * Route an inbound message to the best agent.
   * Returns the agent slug and the routing decision.
   */
  async route(msg: InboundMessage): Promise<{
    agentSlug: string | undefined;
    decision: RoutingDecision;
  }> {
    const body = msg.body.toLowerCase();
    const words = new Set(body.split(/\s+/));

    // Phase 1: Deterministic — keyword + regex matching
    for (const { rule, regexes, keywordSet } of this.compiledRules) {
      // Keyword match
      for (const keyword of keywordSet) {
        if (words.has(keyword) || body.includes(keyword)) {
          const decision = this.buildDecision(
            rule.agentSlug,
            `keyword: '${keyword}'`,
            'deterministic',
            msg,
          );
          await this.logDecision(decision);
          return { agentSlug: rule.agentSlug, decision };
        }
      }

      // Regex match
      for (const regex of regexes) {
        if (regex.test(msg.body)) {
          const decision = this.buildDecision(
            rule.agentSlug,
            `pattern: ${regex.source}`,
            'deterministic',
            msg,
          );
          await this.logDecision(decision);
          return { agentSlug: rule.agentSlug, decision };
        }
      }
    }

    // Phase 2: LLM classification (if enabled)
    if (this.llmFallback) {
      const agentSlugs = this.rules.map((r) => r.agentSlug);
      const classified = await this.classifyWithLLM(msg, agentSlugs);
      if (classified) {
        const decision = this.buildDecision(
          classified.agentSlug,
          `llm: ${classified.reason}`,
          'llm',
          msg,
        );
        await this.logDecision(decision);
        return { agentSlug: classified.agentSlug, decision };
      }
    }

    // Phase 3: Fallback
    const decision = this.buildDecision(
      this.fallbackAgent,
      'fallback: no rule matched',
      'deterministic',
      msg,
    );
    await this.logDecision(decision);
    return { agentSlug: this.fallbackAgent, decision };
  }

  /**
   * Query the ownership chain for a given message or channel.
   */
  async getDecisionHistory(filter?: {
    channel?: string;
    limit?: number;
  }): Promise<RoutingDecision[]> {
    const rows = await this.db.query('activity_log', {
      where: { event_type: 'triage_decision' },
    });

    let decisions = rows.map((r) => {
      try {
        return JSON.parse(r['payload'] as string) as RoutingDecision;
      } catch {
        return null;
      }
    }).filter((d): d is RoutingDecision => d !== null);

    if (filter?.channel) {
      decisions = decisions.filter((d) => d.channel === filter.channel);
    }

    // Sort by timestamp descending
    decisions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.limit) {
      decisions = decisions.slice(0, filter.limit);
    }

    return decisions;
  }

  /**
   * LLM classification — emits a hook for external LLM integration.
   * Returns agent slug + reason, or undefined if LLM is unavailable.
   */
  private async classifyWithLLM(
    msg: InboundMessage,
    agentSlugs: string[],
  ): Promise<{ agentSlug: string; reason: string } | undefined> {
    // Emit classification request — listeners provide the result
    const result: { agentSlug?: string; reason?: string } = {};

    await this.hooks.emit('triage.classify', {
      message: msg,
      candidates: agentSlugs,
      respond: (slug: string, reason: string) => {
        result.agentSlug = slug;
        result.reason = reason;
      },
    });

    if (result.agentSlug && result.reason) {
      return { agentSlug: result.agentSlug, reason: result.reason };
    }

    return undefined;
  }

  private buildDecision(
    target: string | undefined,
    reason: string,
    method: 'deterministic' | 'llm',
    msg: InboundMessage,
  ): RoutingDecision {
    return {
      timestamp: new Date().toISOString(),
      source: 'triage',
      target: target ?? 'none',
      reason,
      method,
      messageId: msg.id,
      channel: msg.channel,
    };
  }

  private async logDecision(decision: RoutingDecision): Promise<void> {
    if (!this.persist) return;
    await this.db.insert('activity_log', {
      event_type: 'triage_decision',
      payload: JSON.stringify(decision),
    });

    await this.hooks.emit('triage.routed', { decision });
  }
}
