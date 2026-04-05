/**
 * GovernanceGate — independent validation gates for agent output.
 * Story 6.7
 *
 * Key principle: gates report to the HUMAN, not to each other
 * or to a project manager agent. Structural independence prevents capture.
 *
 * Gate dimensions:
 *   QA       — data correctness (schema, row counts, format)
 *   Quality  — code quality (lint, coverage, patterns)
 *   Drift    — architectural drift (unintended dependencies, scope creep)
 */

import type { HookBus } from '../hooks/hook-bus.js';

export type GateVerdict = 'pass' | 'fail' | 'warn';

export interface GateResult {
  gateId: string;
  verdict: GateVerdict;
  findings: GateFinding[];
  checkedAt: string;
  durationMs: number;
}

export interface GateFinding {
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  location?: string;  // file path, table name, etc.
  suggestion?: string;
}

export interface GateInput {
  agentId: string;
  taskId: string;
  output: string;
  metadata?: Record<string, unknown>;
}

/**
 * Base class for governance gates. Each gate checks a different dimension.
 * Gates are structurally independent — they report to the human operator,
 * not to each other or to any agent.
 */
export abstract class GovernanceGate {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly dimension: string;

  /**
   * Run the gate check on agent output.
   * Must return a verdict and any findings.
   */
  abstract check(input: GateInput): Promise<GateResult>;
}

/**
 * QA Gate — validates data correctness.
 * Checks: schema conformance, row counts, format validation.
 */
export class QAGate extends GovernanceGate {
  readonly id = 'qa';
  readonly name = 'Quality Assurance';
  readonly dimension = 'data_correctness';

  constructor(
    private validators: Array<{
      name: string;
      validate: (output: string, metadata?: Record<string, unknown>) => GateFinding[];
    }> = [],
  ) {
    super();
  }

  async check(input: GateInput): Promise<GateResult> {
    const start = Date.now();
    const findings: GateFinding[] = [];

    for (const validator of this.validators) {
      const results = validator.validate(input.output, input.metadata);
      findings.push(...results);
    }

    const hasErrors = findings.some((f) => f.severity === 'error' || f.severity === 'critical');
    const hasWarnings = findings.some((f) => f.severity === 'warning');

    return {
      gateId: this.id,
      verdict: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
      findings,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Quality Gate — validates code quality.
 * Checks: lint results, test coverage, review patterns.
 */
export class QualityGate extends GovernanceGate {
  readonly id = 'quality';
  readonly name = 'Code Quality';
  readonly dimension = 'code_quality';

  constructor(
    private checks: Array<{
      name: string;
      check: (output: string, metadata?: Record<string, unknown>) => Promise<GateFinding[]>;
    }> = [],
  ) {
    super();
  }

  async check(input: GateInput): Promise<GateResult> {
    const start = Date.now();
    const findings: GateFinding[] = [];

    for (const chk of this.checks) {
      const results = await chk.check(input.output, input.metadata);
      findings.push(...results);
    }

    const hasErrors = findings.some((f) => f.severity === 'error' || f.severity === 'critical');
    const hasWarnings = findings.some((f) => f.severity === 'warning');

    return {
      gateId: this.id,
      verdict: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
      findings,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Drift Gate — detects architectural drift.
 * Checks: unintended dependencies, scope creep, pattern violations.
 */
export class DriftGate extends GovernanceGate {
  readonly id = 'drift';
  readonly name = 'Architectural Drift';
  readonly dimension = 'architecture';

  constructor(
    private rules: Array<{
      name: string;
      detect: (output: string, metadata?: Record<string, unknown>) => GateFinding[];
    }> = [],
  ) {
    super();
  }

  async check(input: GateInput): Promise<GateResult> {
    const start = Date.now();
    const findings: GateFinding[] = [];

    for (const rule of this.rules) {
      const results = rule.detect(input.output, input.metadata);
      findings.push(...results);
    }

    const hasErrors = findings.some((f) => f.severity === 'error' || f.severity === 'critical');
    const hasWarnings = findings.some((f) => f.severity === 'warning');

    return {
      gateId: this.id,
      verdict: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
      findings,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * GateRunner — orchestrates multiple independent gates on agent output.
 * Each gate runs independently. Results are reported to the human, not to agents.
 */
export class GateRunner {
  constructor(
    private gates: GovernanceGate[],
    private hooks: HookBus,
  ) {}

  /**
   * Run all gates on the given input.
   * Gates run independently — one failure doesn't block others.
   */
  async runAll(input: GateInput): Promise<{
    passed: boolean;
    results: GateResult[];
  }> {
    const results: GateResult[] = [];

    for (const gate of this.gates) {
      try {
        const result = await gate.check(input);
        results.push(result);

        await this.hooks.emit('governance.gate_completed', {
          gateId: gate.id,
          gateName: gate.name,
          verdict: result.verdict,
          findingCount: result.findings.length,
          agentId: input.agentId,
          taskId: input.taskId,
        });
      } catch (err) {
        // Gate error — report but don't block others
        results.push({
          gateId: gate.id,
          verdict: 'fail',
          findings: [{
            severity: 'error',
            message: `Gate error: ${err instanceof Error ? err.message : String(err)}`,
          }],
          checkedAt: new Date().toISOString(),
          durationMs: 0,
        });
      }
    }

    const passed = results.every((r) => r.verdict !== 'fail');

    await this.hooks.emit('governance.review_completed', {
      passed,
      agentId: input.agentId,
      taskId: input.taskId,
      results: results.map((r) => ({
        gateId: r.gateId,
        verdict: r.verdict,
        findingCount: r.findings.length,
      })),
    });

    return { passed, results };
  }
}
