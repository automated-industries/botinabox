import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NdjsonLogger } from '../ndjson-logger.js';

let tmpDir: string;
let logPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ndjson-test-'));
  logPath = join(tmpDir, 'test.ndjson');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('NdjsonLogger — Story 3.3', () => {
  it('logs stdout line as NDJSON', () => {
    const logger = new NdjsonLogger(logPath);
    logger.log('stdout', 'hello world');
    const content = readFileSync(logPath, 'utf8');
    const line = JSON.parse(content.trim());
    expect(line.stream).toBe('stdout');
    expect(line.chunk).toBe('hello world');
    expect(typeof line.timestamp).toBe('string');
  });

  it('logs stderr line as NDJSON', () => {
    const logger = new NdjsonLogger(logPath);
    logger.log('stderr', 'error message');
    const content = readFileSync(logPath, 'utf8');
    const line = JSON.parse(content.trim());
    expect(line.stream).toBe('stderr');
    expect(line.chunk).toBe('error message');
  });

  it('appends multiple lines', () => {
    const logger = new NdjsonLogger(logPath);
    logger.log('stdout', 'line 1');
    logger.log('stdout', 'line 2');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).chunk).toBe('line 1');
    expect(JSON.parse(lines[1]!).chunk).toBe('line 2');
  });

  it('close is a no-op', () => {
    const logger = new NdjsonLogger(logPath);
    expect(() => logger.close()).not.toThrow();
  });
});
