/**
 * Built-in tools: Task operations — dispatch, cancel, reassign.
 */
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const dispatchTaskTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'dispatch_task',
    description: 'Create a new task and assign it to an agent. The agent will automatically pick it up and execute. Use when work needs to be delegated to a specialist.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        description: { type: 'string', description: 'Detailed task description' },
        agent_slug: { type: 'string', description: 'Agent slug to assign to (e.g. "engineer", "qa")' },
        priority: { type: 'number', description: 'Priority 1-10 (lower = higher priority). Default: 5' },
      },
      required: ['title', 'agent_slug'],
    },
  },
  handler: async (input, ctx) => {
    const agents = await ctx.db.query('agents', { where: { slug: input.agent_slug } });
    const agent = agents[0];
    if (!agent) return `Error: agent "${input.agent_slug}" not found.`;
    const row = await ctx.db.insert('tasks', {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? input.title,
      assignee_id: agent.id,
      priority: input.priority ?? 5,
      status: 'todo',
    });
    return `Task "${input.title}" dispatched to ${agent.name} (ID: ${row.id}).`;
  },
};

export const cancelTaskTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'cancel_task',
    description: 'Cancel a task by ID. Use when a task is no longer needed.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to cancel' },
      },
      required: ['task_id'],
    },
  },
  handler: async (input, ctx) => {
    const task = await ctx.db.get('tasks', { id: input.task_id });
    if (!task) return `Error: task ${input.task_id} not found.`;
    await ctx.db.update('tasks', { id: input.task_id }, { status: 'cancelled' });
    return `Task "${task.title}" cancelled.`;
  },
};

export const reassignTaskTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'reassign_task',
    description: 'Reassign a task to a different agent. Cancels the original and creates a copy for the new agent.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to reassign' },
        new_agent_slug: { type: 'string', description: 'Agent slug to reassign to' },
      },
      required: ['task_id', 'new_agent_slug'],
    },
  },
  handler: async (input, ctx) => {
    const task = await ctx.db.get('tasks', { id: input.task_id });
    if (!task) return `Error: task ${input.task_id} not found.`;
    const agents = await ctx.db.query('agents', { where: { slug: input.new_agent_slug } });
    const newAgent = agents[0];
    if (!newAgent) return `Error: agent "${input.new_agent_slug}" not found.`;
    await ctx.db.update('tasks', { id: input.task_id }, { status: 'cancelled' });
    const row = await ctx.db.insert('tasks', {
      id: randomUUID(),
      title: task.title,
      description: task.description,
      assignee_id: newAgent.id,
      priority: task.priority,
      status: 'todo',
    });
    return `Task "${task.title}" reassigned from original to ${newAgent.name} (new ID: ${row.id}).`;
  },
};
