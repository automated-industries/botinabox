/**
 * LearningPipeline — turns execution experience into durable knowledge.
 * Story 6.5
 *
 * Promotion ladder:
 *   Execution → Feedback (structured capture)
 *     → 3+ similar → Playbook (generalized rule)
 *       → 3+ projects → Skill (executable behavior)
 *         → Agent-Skill Matrix → Per-Agent Context
 *
 * Two-axis evaluation:
 *   - Accuracy: was the output correct?
 *   - Efficiency: how fast / how many tokens?
 */

import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';

export interface FeedbackEntry {
  agentId: string;
  taskId?: string;
  issue: string;
  rootCause?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  repeatable: boolean;
  accuracyScore?: number;   // 0-1
  efficiencyScore?: number;  // 0-1
  tags?: string[];
}

export interface PlaybookEntry {
  pattern: string;
  rule: string;
  feedbackIds: string[];
  projectScoped: boolean;
  agentIds?: string[];
}

export interface SkillEntry {
  name: string;
  slug: string;
  description?: string;
  behavior: string;
  sourcePlaybookIds: string[];
  category?: string;
}

export interface LearningPipelineConfig {
  /** Feedback count threshold for playbook promotion. Default: 3 */
  playbookThreshold?: number;
  /** Project count threshold for skill promotion. Default: 3 */
  skillThreshold?: number;
  /** Auto-promote when thresholds are met. Default: false */
  autoPromote?: boolean;
}

const DEFAULT_PLAYBOOK_THRESHOLD = 3;
const DEFAULT_SKILL_THRESHOLD = 3;

export class LearningPipeline {
  private readonly playbookThreshold: number;
  private readonly skillThreshold: number;
  private readonly autoPromote: boolean;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    config?: LearningPipelineConfig,
  ) {
    this.playbookThreshold = config?.playbookThreshold ?? DEFAULT_PLAYBOOK_THRESHOLD;
    this.skillThreshold = config?.skillThreshold ?? DEFAULT_SKILL_THRESHOLD;
    this.autoPromote = config?.autoPromote ?? false;
  }

  // --- Feedback Layer ---

  /**
   * Capture a structured feedback record from an execution.
   */
  async captureFeedback(entry: FeedbackEntry): Promise<string> {
    const row = await this.db.insert('feedback', {
      agent_id: entry.agentId,
      task_id: entry.taskId,
      issue: entry.issue,
      root_cause: entry.rootCause,
      severity: entry.severity,
      repeatable: entry.repeatable ? 1 : 0,
      accuracy_score: entry.accuracyScore,
      efficiency_score: entry.efficiencyScore,
      tags: JSON.stringify(entry.tags ?? []),
    });

    const feedbackId = row['id'] as string;

    await this.hooks.emit('learning.feedback_captured', {
      feedbackId,
      agentId: entry.agentId,
      issue: entry.issue,
      severity: entry.severity,
    });

    // Check for auto-promotion
    if (this.autoPromote) {
      await this.checkPlaybookPromotion(entry.issue);
    }

    return feedbackId;
  }

  /**
   * Get all feedback records, optionally filtered.
   */
  async listFeedback(filter?: {
    agentId?: string;
    severity?: string;
    repeatable?: boolean;
  }): Promise<Array<Record<string, unknown>>> {
    const where: Record<string, unknown> = {};
    if (filter?.agentId) where['agent_id'] = filter.agentId;
    if (filter?.severity) where['severity'] = filter.severity;
    if (filter?.repeatable !== undefined) where['repeatable'] = filter.repeatable ? 1 : 0;
    return this.db.query('feedback', Object.keys(where).length ? { where } : undefined);
  }

  // --- Playbook Layer ---

  /**
   * Check if feedback records with similar issues should be promoted to a playbook.
   * Groups by issue text similarity (exact match for now).
   */
  async checkPlaybookPromotion(issue: string): Promise<string | undefined> {
    const allFeedback = await this.db.query('feedback', {
      where: { issue },
    });

    if (allFeedback.length < this.playbookThreshold) {
      return undefined;
    }

    // Check if a playbook already exists for this pattern
    const existingPlaybooks = await this.db.query('playbooks', {
      where: { pattern: issue },
    });
    if (existingPlaybooks.length > 0) {
      return existingPlaybooks[0]!['id'] as string;
    }

    // Auto-promote: create a playbook from the feedback
    const feedbackIds = allFeedback.map((f) => f['id'] as string);
    const rootCauses = allFeedback
      .map((f) => f['root_cause'] as string)
      .filter(Boolean);

    const rule = rootCauses.length > 0
      ? `When encountering "${issue}": ${rootCauses[0]}`
      : `Pattern detected: "${issue}" — review and add specific guidance.`;

    const playbookId = await this.promoteToPlaybook({
      pattern: issue,
      rule,
      feedbackIds,
      projectScoped: true,
    });

    return playbookId;
  }

  /**
   * Manually create a playbook from a set of feedback records.
   */
  async promoteToPlaybook(entry: PlaybookEntry): Promise<string> {
    const row = await this.db.insert('playbooks', {
      pattern: entry.pattern,
      rule: entry.rule,
      feedback_ids: JSON.stringify(entry.feedbackIds),
      project_scoped: entry.projectScoped ? 1 : 0,
    });

    const playbookId = row['id'] as string;

    // Link to agents if specified
    if (entry.agentIds) {
      for (const agentId of entry.agentIds) {
        await this.db.insert('agent_playbooks', {
          agent_id: agentId,
          playbook_id: playbookId,
        });
      }
    }

    await this.hooks.emit('learning.playbook_promoted', {
      playbookId,
      pattern: entry.pattern,
      feedbackCount: entry.feedbackIds.length,
    });

    return playbookId;
  }

  /**
   * List playbooks, optionally filtered.
   */
  async listPlaybooks(filter?: {
    projectScoped?: boolean;
  }): Promise<Array<Record<string, unknown>>> {
    const where: Record<string, unknown> = {};
    if (filter?.projectScoped !== undefined) {
      where['project_scoped'] = filter.projectScoped ? 1 : 0;
    }
    return this.db.query('playbooks', Object.keys(where).length ? { where } : undefined);
  }

  // --- Skill Layer ---

  /**
   * Check if a playbook should be promoted to a skill.
   * A playbook becomes a skill when it works across multiple projects
   * (indicated by being referenced by agents in different contexts).
   */
  async checkSkillPromotion(playbookId: string): Promise<string | undefined> {
    const playbook = await this.db.get('playbooks', { id: playbookId });
    if (!playbook) return undefined;

    // Count distinct agents using this playbook
    const links = await this.db.query('agent_playbooks', {
      where: { playbook_id: playbookId },
    });

    if (links.length < this.skillThreshold) {
      return undefined;
    }

    // Check if skill already exists for this pattern
    const pattern = playbook['pattern'] as string;
    const existingSkills = await this.db.query('skills', {
      where: { name: pattern },
    });
    if (existingSkills.length > 0) {
      return existingSkills[0]!['id'] as string;
    }

    // Promote to skill
    const slug = pattern
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);

    const skillId = await this.promoteToSkill({
      name: pattern,
      slug,
      description: `Auto-promoted from playbook: ${pattern}`,
      behavior: playbook['rule'] as string,
      sourcePlaybookIds: [playbookId],
    });

    return skillId;
  }

  /**
   * Manually promote a playbook to a reusable skill.
   */
  async promoteToSkill(entry: SkillEntry): Promise<string> {
    const row = await this.db.insert('skills', {
      name: entry.name,
      slug: entry.slug,
      description: entry.description,
      category: entry.category ?? 'learned',
      definition: JSON.stringify({
        behavior: entry.behavior,
        source_playbook_ids: entry.sourcePlaybookIds,
      }),
    });

    const skillId = row['id'] as string;

    await this.hooks.emit('learning.skill_promoted', {
      skillId,
      name: entry.name,
      slug: entry.slug,
      sourcePlaybookCount: entry.sourcePlaybookIds.length,
    });

    return skillId;
  }

  /**
   * Assign a skill to an agent.
   */
  async assignSkill(agentId: string, skillId: string): Promise<void> {
    await this.db.link('agent_skills', {
      agent_id: agentId,
      skill_id: skillId,
    });

    await this.hooks.emit('learning.skill_assigned', { agentId, skillId });
  }

  /**
   * Get learning metrics for an agent.
   */
  async getMetrics(agentId: string): Promise<{
    feedbackCount: number;
    avgAccuracy: number | null;
    avgEfficiency: number | null;
    playbookCount: number;
    skillCount: number;
  }> {
    const feedback = await this.db.query('feedback', { where: { agent_id: agentId } });

    const accuracyScores = feedback
      .map((f) => f['accuracy_score'] as number | null)
      .filter((s): s is number => s !== null && s !== undefined);

    const efficiencyScores = feedback
      .map((f) => f['efficiency_score'] as number | null)
      .filter((s): s is number => s !== null && s !== undefined);

    let playbookCount = 0;
    try {
      const links = await this.db.query('agent_playbooks', { where: { agent_id: agentId } });
      playbookCount = links.length;
    } catch {
      // Table may not exist
    }

    const skillLinks = await this.db.query('agent_skills', { where: { agent_id: agentId } });

    return {
      feedbackCount: feedback.length,
      avgAccuracy: accuracyScores.length > 0
        ? accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length
        : null,
      avgEfficiency: efficiencyScores.length > 0
        ? efficiencyScores.reduce((a, b) => a + b, 0) / efficiencyScores.length
        : null,
      playbookCount,
      skillCount: skillLinks.length,
    };
  }
}
