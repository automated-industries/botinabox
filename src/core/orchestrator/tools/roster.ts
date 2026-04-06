/**
 * Built-in tools: Entity lookup — agents, projects, details.
 */
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const listAgentsTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'list_agents',
    description: 'List all agents with their roles, status, and capabilities. Use when asking "who can do this?" or "what agents do we have?"',
    input_schema: { type: 'object', properties: {} },
  },
  handler: async (_input, ctx) => {
    const agents = await ctx.db.query('agents');
    if (agents.length === 0) return 'No agents registered.';
    return agents.filter(a => !a.deleted_at).map(a => `- **${a.name}** (${a.role}) — ${a.status}`).join('\n');
  },
};

export const listProjectsTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'list_projects',
    description: 'List all projects with status and description. Use when asking about company projects or work.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: async (_input, ctx) => {
    const projects = await ctx.db.query('project').catch(() => []);
    if (projects.length === 0) return 'No projects found.';
    return projects.filter(p => !p.deleted_at).map(p => `- **${p.name}** (${p.status ?? 'unknown'})${p.description ? ` — ${(p.description as string).slice(0, 80)}` : ''}`).join('\n');
  },
};

export const getAgentDetailTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'get_agent_detail',
    description: "Get full details about an agent: role, projects, skills, recent messages. Use when you need to know an agent's capabilities or history.",
    input_schema: {
      type: 'object',
      properties: {
        agent_slug: { type: 'string', description: 'Agent slug' },
      },
      required: ['agent_slug'],
    },
  },
  handler: async (input, ctx) => {
    const agents = await ctx.db.query('agents', { where: { slug: input.agent_slug } });
    const agent = agents[0];
    if (!agent) return `Agent "${input.agent_slug}" not found.`;

    const skills = await ctx.db.query('agent_skills', { where: { agent_id: agent.id as string } }).catch(() => []);
    const skillNames: string[] = [];
    for (const link of skills) {
      const skill = await ctx.db.get('skills', { id: link.skill_id as string });
      if (skill) skillNames.push(skill.name as string);
    }

    return [
      `# ${agent.name}`,
      `Role: ${agent.role}`,
      `Status: ${agent.status}`,
      `Adapter: ${agent.adapter}`,
      skillNames.length > 0 ? `Skills: ${skillNames.join(', ')}` : 'No skills assigned',
    ].join('\n');
  },
};
