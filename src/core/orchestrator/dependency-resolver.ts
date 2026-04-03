/**
 * Dependency resolution utilities for workflow steps and task deps.
 */

export interface StepRef {
  id: string;
  dependsOn?: string[];
}

/**
 * DFS cycle detection — returns true if cycle exists.
 */
export function detectCycle(steps: StepRef[]): boolean {
  const deps = new Map<string, string[]>();
  for (const s of steps) {
    deps.set(s.id, s.dependsOn ?? []);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const s of steps) color.set(s.id, WHITE);

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const dep of deps.get(node) ?? []) {
      const c = color.get(dep);
      if (c === GRAY) return true; // back edge = cycle
      if (c === WHITE && dfs(dep)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const s of steps) {
    if (color.get(s.id) === WHITE && dfs(s.id)) return true;
  }
  return false;
}

/**
 * Returns step IDs in topological (execution) order.
 * Throws if a cycle is detected.
 */
export function topologicalSort(steps: StepRef[]): string[] {
  if (detectCycle(steps)) {
    throw new Error('Cycle detected in step dependencies');
  }

  const deps = new Map<string, string[]>();
  for (const s of steps) {
    deps.set(s.id, s.dependsOn ?? []);
  }

  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of deps.get(id) ?? []) {
      visit(dep);
    }
    result.push(id);
  }

  for (const s of steps) {
    visit(s.id);
  }

  return result;
}

/**
 * Returns true if all dependencies are satisfied (present in completedTaskIds).
 */
export function areDependenciesMet(
  taskDepsJson: string | undefined,
  completedTaskIds: Set<string>,
): boolean {
  if (!taskDepsJson) return true;
  let deps: string[];
  try {
    deps = JSON.parse(taskDepsJson) as string[];
  } catch {
    return true;
  }
  if (!Array.isArray(deps) || deps.length === 0) return true;
  return deps.every((id) => completedTaskIds.has(id));
}
