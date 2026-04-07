import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { LearningPipeline } from '../learning-pipeline.js';

let db: DataStore;
let hooks: HookBus;
let pipeline: LearningPipeline;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  pipeline = new LearningPipeline(db, hooks, { autoPromote: true });
});

afterEach(() => {
  db.close();
});

async function createAgent(slug: string): Promise<string> {
  const row = await db.insert('agents', {
    slug,
    name: slug,
    adapter: 'cli',
  });
  return row['id'] as string;
}

describe('LearningPipeline — Story 6.5', () => {
  describe('feedback capture', () => {
    it('captures a structured feedback record', async () => {
      const agentId = await createAgent('worker');

      const feedbackId = await pipeline.captureFeedback({
        agentId,
        issue: 'Timeout on API call',
        severity: 'medium',
        repeatable: true,
        accuracyScore: 0.8,
        efficiencyScore: 0.3,
      });

      expect(feedbackId).toBeDefined();

      const feedback = await db.get('feedback', { id: feedbackId });
      expect(feedback!['issue']).toBe('Timeout on API call');
      expect(feedback!['severity']).toBe('medium');
      expect(feedback!['repeatable']).toBe(1);
    });

    it('emits learning.feedback_captured hook', async () => {
      const agentId = await createAgent('worker-hook');
      const events: Record<string, unknown>[] = [];
      hooks.register('learning.feedback_captured', (ctx) => { events.push(ctx); });

      await pipeline.captureFeedback({
        agentId,
        issue: 'Test issue',
        severity: 'low',
        repeatable: false,
      });

      expect(events).toHaveLength(1);
      expect(events[0]!['agentId']).toBe(agentId);
    });

    it('lists feedback with filters', async () => {
      const agentId = await createAgent('filter-agent');

      await pipeline.captureFeedback({ agentId, issue: 'A', severity: 'low', repeatable: false });
      await pipeline.captureFeedback({ agentId, issue: 'B', severity: 'high', repeatable: true });
      await pipeline.captureFeedback({ agentId, issue: 'C', severity: 'high', repeatable: false });

      const high = await pipeline.listFeedback({ severity: 'high' });
      expect(high).toHaveLength(2);

      const repeatable = await pipeline.listFeedback({ repeatable: true });
      expect(repeatable).toHaveLength(1);
    });

    it('captures and persists userId on feedback', async () => {
      const agentId = await createAgent('user-scope-agent');

      const feedbackId = await pipeline.captureFeedback({
        agentId,
        userId: 'U123',
        issue: 'Scoped issue',
        severity: 'medium',
        repeatable: false,
      });

      const row = await db.get('feedback', { id: feedbackId });
      expect(row!['user_id']).toBe('U123');
    });

    it('filters feedback by userId', async () => {
      const agentId = await createAgent('user-filter-agent');

      await pipeline.captureFeedback({ agentId, userId: 'U123', issue: 'A', severity: 'low', repeatable: false });
      await pipeline.captureFeedback({ agentId, userId: 'U456', issue: 'B', severity: 'low', repeatable: false });
      await pipeline.captureFeedback({ agentId, issue: 'C', severity: 'low', repeatable: false });

      const filtered = await pipeline.listFeedback({ userId: 'U123' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!['issue']).toBe('A');
    });

    it('emits userId in feedback_captured hook context', async () => {
      const agentId = await createAgent('hook-user-agent');
      const events: Record<string, unknown>[] = [];
      hooks.register('learning.feedback_captured', (ctx) => { events.push(ctx); });

      await pipeline.captureFeedback({
        agentId,
        userId: 'U789',
        issue: 'Hook test',
        severity: 'low',
        repeatable: false,
      });

      expect(events).toHaveLength(1);
      expect(events[0]!['userId']).toBe('U789');
    });
  });

  describe('playbook promotion', () => {
    it('auto-promotes to playbook after 3 similar feedback records', async () => {
      const agentId = await createAgent('promo-agent');
      const events: Record<string, unknown>[] = [];
      hooks.register('learning.playbook_promoted', (ctx) => { events.push(ctx); });

      // Capture 3 feedback records with the same issue
      await pipeline.captureFeedback({
        agentId, issue: 'Rate limit hit', rootCause: 'Missing retry backoff',
        severity: 'medium', repeatable: true,
      });
      await pipeline.captureFeedback({
        agentId, issue: 'Rate limit hit', rootCause: 'Missing retry backoff',
        severity: 'medium', repeatable: true,
      });
      await pipeline.captureFeedback({
        agentId, issue: 'Rate limit hit', rootCause: 'Missing retry backoff',
        severity: 'medium', repeatable: true,
      });

      // Should have auto-promoted
      expect(events).toHaveLength(1);
      expect(events[0]!['pattern']).toBe('Rate limit hit');

      const playbooks = await pipeline.listPlaybooks();
      expect(playbooks).toHaveLength(1);
      expect(playbooks[0]!['pattern']).toBe('Rate limit hit');
    });

    it('persists clientId on playbook', async () => {
      const playbookId = await pipeline.promoteToPlaybook({
        pattern: 'Client-scoped pattern',
        rule: 'Rule for client',
        feedbackIds: ['f1'],
        projectScoped: true,
        clientId: 'client-acme',
      });

      const row = await db.get('playbooks', { id: playbookId });
      expect(row!['client_id']).toBe('client-acme');
    });

    it('does not duplicate playbooks for the same pattern', async () => {
      const agentId = await createAgent('dedup-agent');

      // Capture 6 feedback records (should create only 1 playbook)
      for (let i = 0; i < 6; i++) {
        await pipeline.captureFeedback({
          agentId, issue: 'Duplicate pattern', severity: 'low', repeatable: true,
        });
      }

      const playbooks = await pipeline.listPlaybooks();
      expect(playbooks).toHaveLength(1);
    });
  });

  describe('skill promotion', () => {
    it('promotes playbook to skill when used by enough agents', async () => {
      const events: Record<string, unknown>[] = [];
      hooks.register('learning.skill_promoted', (ctx) => { events.push(ctx); });

      // Create a playbook
      const playbookId = await pipeline.promoteToPlaybook({
        pattern: 'Handle rate limits',
        rule: 'Always implement exponential backoff',
        feedbackIds: ['f1', 'f2', 'f3'],
        projectScoped: false,
      });

      // Link to 3 agents (meeting the threshold)
      const agents = await Promise.all([
        createAgent('agent-a'),
        createAgent('agent-b'),
        createAgent('agent-c'),
      ]);

      for (const agentId of agents) {
        await db.insert('agent_playbooks', {
          agent_id: agentId,
          playbook_id: playbookId,
        });
      }

      // Check for promotion
      const skillId = await pipeline.checkSkillPromotion(playbookId);

      expect(skillId).toBeDefined();
      expect(events).toHaveLength(1);

      const skill = await db.get('skills', { id: skillId });
      expect(skill!['name']).toBe('Handle rate limits');
      expect(skill!['category']).toBe('learned');
    });

    it('does not promote when below agent threshold', async () => {
      const playbookId = await pipeline.promoteToPlaybook({
        pattern: 'Not enough agents',
        rule: 'Some rule',
        feedbackIds: ['f1'],
        projectScoped: true,
      });

      const agentId = await createAgent('solo-agent');
      await db.insert('agent_playbooks', {
        agent_id: agentId,
        playbook_id: playbookId,
      });

      const skillId = await pipeline.checkSkillPromotion(playbookId);
      expect(skillId).toBeUndefined();
    });
  });

  describe('skill assignment', () => {
    it('assigns a skill to an agent', async () => {
      const agentId = await createAgent('skill-agent');
      const skillRow = await db.insert('skills', {
        slug: 'test-skill',
        name: 'Test Skill',
        category: 'learned',
      });
      const skillId = skillRow['id'] as string;

      const events: Record<string, unknown>[] = [];
      hooks.register('learning.skill_assigned', (ctx) => { events.push(ctx); });

      await pipeline.assignSkill(agentId, skillId);

      expect(events).toHaveLength(1);

      const links = await db.query('agent_skills', { where: { agent_id: agentId } });
      expect(links).toHaveLength(1);
      expect(links[0]!['skill_id']).toBe(skillId);
    });
  });

  describe('metrics', () => {
    it('returns learning metrics for an agent', async () => {
      const agentId = await createAgent('metrics-agent');

      await pipeline.captureFeedback({
        agentId, issue: 'A', severity: 'low', repeatable: false,
        accuracyScore: 0.9, efficiencyScore: 0.7,
      });
      await pipeline.captureFeedback({
        agentId, issue: 'B', severity: 'medium', repeatable: true,
        accuracyScore: 0.5, efficiencyScore: 0.3,
      });

      const metrics = await pipeline.getMetrics(agentId);

      expect(metrics.feedbackCount).toBe(2);
      expect(metrics.avgAccuracy).toBeCloseTo(0.7, 1);
      expect(metrics.avgEfficiency).toBeCloseTo(0.5, 1);
    });
  });
});
