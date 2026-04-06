/**
 * Built-in tools: Entity creation — agents, projects.
 */
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const createAgentTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'create_agent',
    description: 'Register a new agent in the system with a role and adapter. Use when the team needs a new specialist.',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Unique identifier (lowercase, no spaces)' },
        name: { type: 'string', description: 'Display name' },
        role: { type: 'string', description: 'Role (e.g. "engineer", "qa", "marketing")' },
        adapter: { type: 'string', description: 'Execution adapter: "api" or "cli". Default: "api"' },
      },
      required: ['slug', 'name', 'role'],
    },
  },
  handler: async (input, ctx) => {
    const existing = await ctx.db.query('agents', { where: { slug: input.slug } });
    if (existing.length > 0) return `Agent "${input.slug}" already exists.`;
    const row = await ctx.db.insert('agents', {
      slug: input.slug,
      name: input.name,
      role: input.role,
      adapter: input.adapter ?? 'api',
      status: 'idle',
      adapter_config: '{}',
      heartbeat_config: '{}',
    });
    return `Agent "${input.name}" (${input.role}) created with ID ${row.id}.`;
  },
};

export const createProjectTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'create_project',
    description: 'Register a new project with status and description. Use when a new initiative or product needs tracking.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        status: { type: 'string', description: 'Status: active_build, production, planning, etc.' },
        description: { type: 'string', description: 'Brief description' },
      },
      required: ['name'],
    },
  },
  handler: async (input, ctx) => {
    const orgs = await ctx.db.query('org');
    const orgId = orgs[0]?.id as string ?? '';
    const row = await ctx.db.insert('project', {
      org_id: orgId,
      name: input.name,
      status: input.status ?? 'planning',
      description: input.description ?? '',
    });
    return `Project "${input.name}" created with ID ${row.id}.`;
  },
};
