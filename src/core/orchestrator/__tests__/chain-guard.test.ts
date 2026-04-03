import { describe, it, expect } from 'vitest';
import { checkChainDepth, buildChainOrigin, MAX_CHAIN_DEPTH } from '../chain-guard.js';

describe('ChainGuard — Story 3.2', () => {
  describe('checkChainDepth', () => {
    it('does not throw at max depth', () => {
      expect(() => checkChainDepth(MAX_CHAIN_DEPTH)).not.toThrow();
    });

    it('throws when depth exceeds max', () => {
      expect(() => checkChainDepth(MAX_CHAIN_DEPTH + 1)).toThrow(
        `Chain depth limit exceeded (max ${MAX_CHAIN_DEPTH})`
      );
    });

    it('supports custom max depth', () => {
      expect(() => checkChainDepth(3, 3)).not.toThrow();
      expect(() => checkChainDepth(4, 3)).toThrow('Chain depth limit exceeded (max 3)');
    });
  });

  describe('buildChainOrigin', () => {
    it('returns depth=0 with no parent', () => {
      const result = buildChainOrigin();
      expect(result.chain_depth).toBe(0);
      expect(result.chain_origin_id).toBeUndefined();
    });

    it('uses parentTaskId as origin when no parentOriginId', () => {
      const result = buildChainOrigin('task-1');
      expect(result.chain_origin_id).toBe('task-1');
      expect(result.chain_depth).toBe(1);
    });

    it('uses parentOriginId when provided', () => {
      const result = buildChainOrigin('task-2', 'origin-task');
      expect(result.chain_origin_id).toBe('origin-task');
      expect(result.chain_depth).toBe(1);
    });

    it('increments depth from parent depth', () => {
      const result = buildChainOrigin('task-3', 'origin-task', 3);
      expect(result.chain_depth).toBe(4);
    });
  });
});
