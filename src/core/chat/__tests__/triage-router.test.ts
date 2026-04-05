import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { TriageRouter } from '../triage-router.js';
import type { InboundMessage } from '../types.js';

let db: DataStore;
let hooks: HookBus;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
});

afterEach(() => {
  db.close();
});

function makeMessage(body: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    channel: 'slack',
    from: 'user-1',
    body,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TriageRouter — Story 6.3', () => {
  describe('keyword routing', () => {
    it('routes by keyword match', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'devops', keywords: ['deploy', 'infra', 'pipeline'] },
          { agentSlug: 'analyst', keywords: ['data', 'report', 'csv'] },
        ],
        persist: false,
      });

      const result = await router.route(makeMessage('please deploy the latest build'));

      expect(result.agentSlug).toBe('devops');
      expect(result.decision.method).toBe('deterministic');
      expect(result.decision.reason).toContain('deploy');
    });

    it('matches keywords case-insensitively', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'analyst', keywords: ['report'] },
        ],
        persist: false,
      });

      const result = await router.route(makeMessage('Generate a REPORT for Q1'));
      expect(result.agentSlug).toBe('analyst');
    });
  });

  describe('regex routing', () => {
    it('routes by regex pattern', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'security', patterns: ['CVE-\\d{4}-\\d+'] },
        ],
        persist: false,
      });

      const result = await router.route(makeMessage('Investigate CVE-2024-12345'));

      expect(result.agentSlug).toBe('security');
      expect(result.decision.method).toBe('deterministic');
      expect(result.decision.reason).toContain('pattern');
    });
  });

  describe('priority ordering', () => {
    it('higher priority rules match first', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'general', keywords: ['help'], priority: 50 },
          { agentSlug: 'urgent', keywords: ['help'], priority: 10 },
        ],
        persist: false,
      });

      const result = await router.route(makeMessage('I need help'));
      expect(result.agentSlug).toBe('urgent');
    });
  });

  describe('fallback', () => {
    it('uses fallback agent when no rules match', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'devops', keywords: ['deploy'] },
        ],
        fallbackAgent: 'general',
        llmFallback: false,
        persist: false,
      });

      const result = await router.route(makeMessage('how are you?'));

      expect(result.agentSlug).toBe('general');
      expect(result.decision.reason).toContain('fallback');
    });

    it('returns undefined agent when no fallback configured', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [],
        llmFallback: false,
        persist: false,
      });

      const result = await router.route(makeMessage('random message'));
      expect(result.agentSlug).toBeUndefined();
    });
  });

  describe('LLM classification', () => {
    it('falls back to LLM when no deterministic match', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'devops', keywords: ['deploy'] },
          { agentSlug: 'analyst', keywords: ['data'] },
        ],
        llmFallback: true,
        persist: false,
      });

      // Register a mock LLM classifier via hook
      hooks.register('triage.classify', (ctx) => {
        const respond = ctx['respond'] as (slug: string, reason: string) => void;
        respond('analyst', 'message appears to be about analytics');
      });

      const result = await router.route(makeMessage('show me the quarterly numbers'));

      expect(result.agentSlug).toBe('analyst');
      expect(result.decision.method).toBe('llm');
    });
  });

  describe('decision logging', () => {
    it('persists routing decisions to activity_log', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'devops', keywords: ['deploy'] },
        ],
        persist: true,
      });

      await router.route(makeMessage('deploy to staging'));

      const logs = await db.query('activity_log', {
        where: { event_type: 'triage_decision' },
      });
      expect(logs).toHaveLength(1);

      const decision = JSON.parse(logs[0]!['payload'] as string);
      expect(decision.target).toBe('devops');
      expect(decision.source).toBe('triage');
    });

    it('retrieves decision history', async () => {
      const router = new TriageRouter(db, hooks, {
        rules: [
          { agentSlug: 'devops', keywords: ['deploy'] },
        ],
        persist: true,
      });

      await router.route(makeMessage('deploy to staging'));
      await router.route(makeMessage('deploy to prod'));

      const history = await router.getDecisionHistory({ limit: 10 });
      expect(history).toHaveLength(2);
      expect(history[0]!.target).toBe('devops');
    });
  });
});
