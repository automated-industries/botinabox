import { describe, it, expect, beforeEach } from 'vitest';
import { HookBus } from '../../hooks/hook-bus.js';
import {
  QAGate,
  QualityGate,
  DriftGate,
  GateRunner,
  type GateInput,
  type GateFinding,
} from '../governance-gate.js';

let hooks: HookBus;

beforeEach(() => {
  hooks = new HookBus();
});

function makeInput(output: string, overrides: Partial<GateInput> = {}): GateInput {
  return {
    agentId: 'agent-1',
    taskId: 'task-1',
    output,
    ...overrides,
  };
}

describe('GovernanceGates — Story 6.7', () => {
  describe('QAGate', () => {
    it('passes when no validators find issues', async () => {
      const gate = new QAGate([]);
      const result = await gate.check(makeInput('all good'));
      expect(result.verdict).toBe('pass');
      expect(result.findings).toHaveLength(0);
    });

    it('fails when a validator reports an error', async () => {
      const gate = new QAGate([
        {
          name: 'non-empty',
          validate: (output): GateFinding[] => {
            if (!output.trim()) {
              return [{ severity: 'error', message: 'Output is empty' }];
            }
            return [];
          },
        },
      ]);

      const result = await gate.check(makeInput(''));
      expect(result.verdict).toBe('fail');
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.severity).toBe('error');
    });

    it('warns when a validator reports a warning', async () => {
      const gate = new QAGate([
        {
          name: 'length-check',
          validate: (output): GateFinding[] => {
            if (output.length < 10) {
              return [{ severity: 'warning', message: 'Output is suspiciously short' }];
            }
            return [];
          },
        },
      ]);

      const result = await gate.check(makeInput('short'));
      expect(result.verdict).toBe('warn');
    });
  });

  describe('QualityGate', () => {
    it('runs async checks', async () => {
      const gate = new QualityGate([
        {
          name: 'async-check',
          check: async (output): Promise<GateFinding[]> => {
            await new Promise((r) => setTimeout(r, 5));
            if (output.includes('TODO')) {
              return [{ severity: 'warning', message: 'Contains TODO' }];
            }
            return [];
          },
        },
      ]);

      const result = await gate.check(makeInput('implement TODO'));
      expect(result.verdict).toBe('warn');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('DriftGate', () => {
    it('detects architectural drift patterns', async () => {
      const gate = new DriftGate([
        {
          name: 'no-new-databases',
          detect: (output): GateFinding[] => {
            if (/CREATE\s+DATABASE/i.test(output)) {
              return [{
                severity: 'error',
                message: 'New database creation detected — is this intentional?',
                suggestion: 'Review architectural guidelines before adding databases',
              }];
            }
            return [];
          },
        },
      ]);

      const result = await gate.check(makeInput('CREATE DATABASE new_service'));
      expect(result.verdict).toBe('fail');
      expect(result.findings[0]!.suggestion).toBeDefined();
    });
  });

  describe('GateRunner', () => {
    it('runs all gates independently and aggregates results', async () => {
      const events: Record<string, unknown>[] = [];
      hooks.register('governance.gate_completed', (ctx) => { events.push(ctx); });

      const runner = new GateRunner([
        new QAGate([{
          name: 'always-pass',
          validate: (): GateFinding[] => [],
        }]),
        new QualityGate([{
          name: 'always-warn',
          check: async (): Promise<GateFinding[]> =>
            [{ severity: 'warning', message: 'Style issue' }],
        }]),
      ], hooks);

      const { passed, results } = await runner.runAll(makeInput('test'));

      expect(passed).toBe(true); // warn doesn't block
      expect(results).toHaveLength(2);
      expect(events).toHaveLength(2);
    });

    it('fails when any gate returns fail verdict', async () => {
      const runner = new GateRunner([
        new QAGate([{
          name: 'always-pass',
          validate: (): GateFinding[] => [],
        }]),
        new QAGate([{
          name: 'always-fail',
          validate: (): GateFinding[] =>
            [{ severity: 'error', message: 'Critical data error' }],
        }]),
      ], hooks);

      const { passed } = await runner.runAll(makeInput('test'));
      expect(passed).toBe(false);
    });

    it('emits governance.review_completed with summary', async () => {
      const events: Record<string, unknown>[] = [];
      hooks.register('governance.review_completed', (ctx) => { events.push(ctx); });

      const runner = new GateRunner([
        new QAGate([]),
      ], hooks);

      await runner.runAll(makeInput('test'));

      expect(events).toHaveLength(1);
      expect(events[0]!['passed']).toBe(true);
      expect(events[0]!['agentId']).toBe('agent-1');
    });

    it('handles gate errors gracefully', async () => {
      const errorGate = new QualityGate([{
        name: 'throws',
        check: async () => { throw new Error('Gate crashed'); },
      }]);

      const runner = new GateRunner([errorGate], hooks);
      const { passed, results } = await runner.runAll(makeInput('test'));

      expect(passed).toBe(false);
      expect(results[0]!.verdict).toBe('fail');
      expect(results[0]!.findings[0]!.message).toContain('Gate crashed');
    });
  });
});
