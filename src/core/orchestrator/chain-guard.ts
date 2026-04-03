export const MAX_CHAIN_DEPTH = 5;

/**
 * Throws if depth exceeds the maximum allowed chain depth.
 */
export function checkChainDepth(depth: number, max: number = MAX_CHAIN_DEPTH): void {
  if (depth > max) {
    throw new Error(`Chain depth limit exceeded (max ${max})`);
  }
}

/**
 * Build chain origin metadata for a new child task.
 * If parentTaskId is provided, sets chain_origin_id and increments depth.
 * Otherwise returns depth=0 with no origin.
 */
export function buildChainOrigin(
  parentTaskId?: string,
  parentOriginId?: string,
  parentDepth?: number,
): { chain_origin_id?: string; chain_depth: number } {
  if (!parentTaskId) {
    return { chain_depth: 0 };
  }

  return {
    chain_origin_id: parentOriginId ?? parentTaskId,
    chain_depth: (parentDepth ?? 0) + 1,
  };
}
