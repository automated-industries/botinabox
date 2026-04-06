/**
 * Built-in tools: System awareness — task status, agent status, system health.
 */
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const getTaskStatusTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'get_task_status',
    description: 'Get the current status, result, and details of a specific task. Use when checking on work progress.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to check' },
      },
      required: ['task_id'],
    },
  },
  handler: async (input, ctx) => {
    const task = await ctx.db.get('tasks', { id: input.task_id });
    if (!task) return `Task ${input.task_id} not found.`;
    const agent = task.assignee_id ? await ctx.db.get('agents', { id: task.assignee_id as string }) : null;
    return [
      `**${task.title}**`,
      `Status: ${task.status}`,
      `Assigned to: ${(agent?.name as string) ?? 'unassigned'}`,
      `Priority: ${task.priority}`,
      task.result ? `Result: ${(task.result as string).slice(0, 500)}` : null,
    ].filter(Boolean).join('\n');
  },
};

export const getAgentStatusTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'get_agent_status',
    description: "Get an agent's current status, active tasks, and recent run history. Use when checking what an agent is doing.",
    input_schema: {
      type: 'object',
      properties: {
        agent_slug: { type: 'string', description: 'Agent slug (e.g. "engineer")' },
      },
      required: ['agent_slug'],
    },
  },
  handler: async (input, ctx) => {
    const agents = await ctx.db.query('agents', { where: { slug: input.agent_slug } });
    const agent = agents[0];
    if (!agent) return `Agent "${input.agent_slug}" not found.`;
    const tasks = await ctx.db.query('tasks', { where: { assignee_id: agent.id, status: 'todo' } });
    const runs = await ctx.db.query('runs', { where: { agent_id: agent.id as string }, limit: 5 });
    return [
      `**${agent.name}** (${agent.role})`,
      `Status: ${agent.status}`,
      `Pending tasks: ${tasks.length}`,
      runs.length > 0 ? `Recent runs: ${runs.map(r => `${r.status} (${r.exit_code})`).join(', ')}` : 'No recent runs',
    ].join('\n');
  },
};

export const getSystemStatusTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'get_system_status',
    description: 'Get overall system health: active agents, pending tasks, recent activity. Use for a quick system overview.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: async (_input, ctx) => {
    const agents = await ctx.db.query('agents');
    const todoTasks = await ctx.db.query('tasks', { where: { status: 'todo' } });
    const runningTasks = await ctx.db.query('tasks', { where: { status: 'in_progress' } });
    const recentRuns = await ctx.db.query('runs', { limit: 5 });
    return [
      `Agents: ${agents.length} (${agents.filter(a => a.status === 'running').length} running)`,
      `Pending tasks: ${todoTasks.length}`,
      `In-progress tasks: ${runningTasks.length}`,
      `Recent runs: ${recentRuns.length}`,
    ].join('\n');
  },
};

export const getActiveTasksTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'get_active_tasks',
    description: 'List all active (todo/in_progress) tasks across all agents. Use to see what work is pending.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: async (_input, ctx) => {
    const todo = await ctx.db.query('tasks', { where: { status: 'todo' } });
    const inProgress = await ctx.db.query('tasks', { where: { status: 'in_progress' } });
    const all = [...todo, ...inProgress];
    if (all.length === 0) return 'No active tasks.';
    return all.map(t => `- [${t.status}] ${t.title} (priority: ${t.priority})`).join('\n');
  },
};
